/*
 * T3 Code — Persian/Arabic bidi patch (chat messages and pending questions).
 *
 * Upstream has no RTL support for chat text: every attempt to land it
 * (pingdotgg/t3code#1320, #1484, #2128) was closed unmerged.
 *
 * Behaviour, per request:
 *   - A block goes dir="rtl" if it contains ANY Persian/Arabic character.
 *     Not "first strong character" — a single Persian word is enough.
 *   - Blocks with no Persian are left completely untouched.
 *   - Only chat message bodies, queued messages and the composer drawer that
 *     holds pending questions and approvals are scanned. The sidebar and the
 *     rest of the UI are never touched.
 *   - The composer input keeps the direction the editor gives it; the only
 *     change there is an explicit dir on attachment chips, so their Latin
 *     labels stop deciding the direction of a Persian message.
 *   - Code blocks, inline code, diffs and terminals are excluded from both the
 *     detection and the flip, and stay LTR even inside an RTL paragraph.
 */
(() => {
  "use strict";

  if (window.__t3codeRtlPatch) return;
  window.__t3codeRtlPatch = true;

  // Arabic, Arabic Supplement, Arabic Extended-A/B, Presentation Forms-A/B.
  // Hebrew is deliberately not included.
  const RTL_CHAR = /[؀-ۿݐ-ݿࡰ-࢟ࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

  // Regions that are scanned, each with its own notion of a "block".
  //
  //   root    — a container whose contents may be flipped.
  //   gate    — cheap ancestor/descendant test that keeps unrelated mutations
  //             (terminal output, file trees, menus) out of the scan entirely.
  //   blocks  — elements inside a root that get their own direction.
  //   isolate — elements that only get a direction of their own, so they stop
  //             taking part in the direction of the block around them.
  //   whole   — flip the root itself when no block matches inside it.
  const SCOPES = [
    {
      // Chat message bodies inside the conversation timeline.
      root: '.chat-markdown, [data-user-message-body="true"]',
      gate: "[data-timeline-root]",
      blocks:
        "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, summary, figcaption",
      align: "table",
      whole: true,
    },
    {
      // The composer drawer: pending question cards, approval requests and the
      // plan-ready strip. It lives in the composer form, outside the timeline,
      // so it needs a root of its own. Its text sits in generated markup with
      // no semantic block elements, hence the wider block list — the drawer is
      // small, so scanning it is cheap.
      root: '[data-chat-composer-top-drawer="true"]',
      gate: '[data-chat-composer-top-drawer="true"]',
      blocks: "p, button, span",
    },
    {
      // A message waiting in the queue. It is a timeline row, but not a chat
      // message body, so it needs its own root. Only the prompt text flips:
      // the status row under it ("Queued" and its two buttons) holds no
      // Persian and keeps the layout it has everywhere else.
      root: "[data-queued-message-id]",
      gate: "[data-timeline-root]",
      blocks: ".whitespace-pre-wrap",
    },
    {
      // The composer input. The editor marks every paragraph dir="auto", which
      // HTML resolves from the first strong character anywhere inside the
      // element — including the Latin label of an attachment or mention chip.
      // A Persian message that started with an attachment was therefore laid
      // out left to right. Giving a chip a direction of its own takes it out
      // of that scan, because HTML skips descendants that carry one, so the
      // typed text decides the direction again. The text itself is untouched.
      root: '[data-lexical-editor="true"]',
      gate: '[data-lexical-editor="true"]',
      isolate: '[data-lexical-decorator="true"]',
    },
    {
      // The thread title in the chat header. Only the title flips — it is the
      // one part of that bar the user wrote. The breadcrumb next to it keeps
      // its order, the same way a table keeps its columns. The rename field
      // has no text nodes to scan, so it follows its own value instead.
      root: "[data-chat-header]",
      gate: "[data-chat-header]",
      blocks: "h2",
      isolate: 'input[aria-label="Thread title"]',
    },
  ];

  // Anything under these never triggers RTL and never gets flipped.
  const SKIP = [
    "pre",
    "code",
    "kbd",
    "samp",
    ".chat-markdown-codeblock",
    ".chat-markdown-shiki",
    "[data-language]",
    "[data-diff]",
    "[data-diff-type]",
    ".diff-render-surface",
    ".diff-render-file",
    ".diff-panel-viewport",
    ".xterm",
  ].join(", ");

  const FLAG = "data-t3code-rtl";
  // Tables are aligned but never flipped: column order stays as authored,
  // while every cell of a table that holds Persian shares one edge, so a
  // single English cell does not leave the column ragged.
  const ALIGN_FLAG = "data-t3code-rtl-align";

  // Persian font. AradNL has no Latin glyphs at all, so putting it after the
  // app's DM Sans (whose @font-face is unicode-range-limited to Latin) makes the
  // split automatic: Latin keeps DM Sans, Persian falls through to Arad.
  // Mono stays untouched, so code blocks are unaffected.
  const SANS_STACK =
    '"DM Sans Variable", "DM Sans", "AradNL", -apple-system, BlinkMacSystemFont, ' +
    '"Segoe UI", system-ui, sans-serif';

  // The font below is embedded as a data URL by the patcher, so the notice the
  // OFL asks to travel with every copy travels here:
  //
  //   Arad (AradNL variable), version 2.4.0
  //   Copyright 2025 The Arad Project Authors
  //   https://github.com/MohamadDarvishi/Arad
  //   Licensed under the SIL Open Font License 1.1: https://scripts.sil.org/OFL
  //
  // The file is the upstream release, byte for byte, with no subsetting or
  // renaming, so the reserved font name clause is not in play.
  const style = document.createElement("style");
  style.id = "t3code-rtl-patch-style";
  // Unlayered on purpose: upstream Tailwind utilities live in @layer utilities,
  // so these rules win over `text-left` on a flipped button without !important.
  style.textContent = `
@font-face {
  font-family: "AradNL";
  src: url("__T3CODE_ARAD_FONT__") format("woff2");
  font-weight: 100 1000;
  font-style: normal;
  font-display: swap;
}
:root, :host {
  --font-sans: ${SANS_STACK};
  --default-font-family: ${SANS_STACK};
}
/* body carries a LITERAL stack upstream, not var(--font-sans), so redefining
   the variables alone changes nothing. Everything else inherits from body —
   including form controls, which upstream gives font:inherit. */
body, .font-sans {
  font-family: ${SANS_STACK};
}
[${FLAG}] {
  text-align: right;
}
/* Upstream aligns table cells left with a rule of the form
   ".chat-markdown th, .chat-markdown td", which outranks a bare attribute
   selector, so a flipped cell kept its right-to-left text but stayed
   left-aligned. Matching that specificity is enough, because this stylesheet
   is appended last and wins the tie. */
[${ALIGN_FLAG}] th, [${ALIGN_FLAG}] td {
  text-align: right;
}
[${FLAG}] code,
[${FLAG}] kbd,
[${FLAG}] samp,
[${FLAG}] pre,
[${FLAG}] .chat-markdown-codeblock,
[${FLAG}] .chat-markdown-shiki {
  direction: ltr;
  unicode-bidi: isolate;
  text-align: left;
}
`;
  document.head.appendChild(style);

  /** True if el holds a Persian/Arabic character outside any excluded subtree. */
  function hasPersian(el) {
    if (!RTL_CHAR.test(el.textContent || "")) return false; // cheap reject
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      if (RTL_CHAR.test(walker.currentNode.nodeValue || "")) return true;
    }
    return false;
  }

  function setDirection(el) {
    if (hasPersian(el)) {
      if (!el.hasAttribute(FLAG)) {
        el.setAttribute("dir", "rtl");
        el.setAttribute(FLAG, "");
      }
    } else if (el.hasAttribute(FLAG)) {
      el.removeAttribute("dir");
      el.removeAttribute(FLAG);
    }
  }

  /** Alignment only: no dir attribute, so column order is left alone. */
  function setAlignment(el) {
    if (hasPersian(el)) el.setAttribute(ALIGN_FLAG, "");
    else el.removeAttribute(ALIGN_FLAG);
  }

  /**
   * dir="auto" on an element makes it pick its own direction from its own text
   * and, per HTML, drops that text from the dir="auto" scan of every block
   * above it. A direction the app set itself is left alone.
   */
  function isolateDirection(el) {
    if (!el.hasAttribute("dir")) el.setAttribute("dir", "auto");
  }

  function applyToRoot(root, scope) {
    if (root.closest(SKIP)) return;
    if (scope.blocks) {
      const blocks = root.querySelectorAll(scope.blocks);
      // User messages are plain text with no block children — flip the root
      // itself. Scopes that surround their text with other controls must not
      // do this: an empty match there means "nothing to flip", not "flip all".
      const targets = blocks.length > 0 ? blocks : scope.whole ? [root] : [];
      for (const el of targets) {
        if (el !== root && el.closest(SKIP)) continue;
        setDirection(el);
      }
    }
    if (scope.align) {
      for (const el of root.querySelectorAll(scope.align)) {
        if (!el.closest(SKIP)) setAlignment(el);
      }
    }
    if (scope.isolate) {
      for (const el of root.querySelectorAll(scope.isolate)) isolateDirection(el);
    }
  }

  const pending = new Map(); // root element -> scope
  let scheduled = false;

  function flush() {
    if (!scheduled) return;
    scheduled = false;
    const roots = [...pending];
    pending.clear();
    for (const [root, scope] of roots) {
      if (root.isConnected) applyToRoot(root, scope);
    }
  }

  // rAF keeps streaming updates to one pass per frame, but it never fires while
  // the window is hidden — the timeout makes sure a backgrounded agent run still
  // gets its text flipped.
  function schedule(root, scope) {
    pending.set(root, scope);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
    setTimeout(flush, 100);
  }

  function collect(node) {
    if (!(node instanceof Element)) {
      const parent = node.parentElement;
      if (parent) collect(parent);
      return;
    }
    for (const scope of SCOPES) {
      // closest() only walks up. Switching threads replaces a container ABOVE
      // [data-timeline-root], so an up-only gate drops the whole incoming thread
      // and it stays LTR until some unrelated mutation lands inside it. Check
      // downwards too, then verify the gate per root.
      if (!node.closest(scope.gate) && !node.querySelector(scope.gate)) continue;
      const own = node.closest(scope.root);
      if (own && own.closest(scope.gate)) schedule(own, scope);
      for (const root of node.querySelectorAll(scope.root)) {
        if (root.closest(scope.gate)) schedule(root, scope);
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        collect(mutation.target);
        continue;
      }
      collect(mutation.target);
      for (const added of mutation.addedNodes) collect(added);
    }
  });

  function start() {
    // Synchronous first pass so nothing is ever painted left-aligned first.
    for (const scope of SCOPES) {
      for (const root of document.querySelectorAll(scope.root)) {
        if (root.closest(scope.gate)) applyToRoot(root, scope);
      }
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
