/*
 * T3 Code — Persian/Arabic bidi patch (chat messages and pending questions).
 *
 * Upstream has no RTL support: pingdotgg/t3code#1771 is still open and every
 * attempt to land it (#1320, #1484, #2128) was closed unmerged.
 *
 * Behaviour, per request:
 *   - A block goes dir="rtl" if it contains ANY Persian/Arabic character.
 *     Not "first strong character" — a single Persian word is enough.
 *   - Blocks with no Persian are left completely untouched.
 *   - Only chat message bodies and the composer drawer that holds pending
 *     questions and approvals are scanned. The composer input, sidebar and the
 *     rest of the UI are never touched.
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
  //   root   — a container whose contents may be flipped.
  //   gate   — cheap ancestor/descendant test that keeps unrelated mutations
  //            (terminal output, file trees, menus) out of the scan entirely.
  //   blocks — elements inside a root that get their own direction.
  const SCOPES = [
    {
      // Chat message bodies inside the conversation timeline.
      root: '.chat-markdown, [data-user-message-body="true"]',
      gate: "[data-timeline-root]",
      blocks:
        "p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dt, dd, summary, figcaption",
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

  // Persian font. AradNL has no Latin glyphs at all, so putting it after the
  // app's DM Sans (whose @font-face is unicode-range-limited to Latin) makes the
  // split automatic: Latin keeps DM Sans, Persian falls through to Arad.
  // Mono stays untouched, so code blocks are unaffected.
  const SANS_STACK =
    '"DM Sans Variable", "DM Sans", "AradNL", -apple-system, BlinkMacSystemFont, ' +
    '"Segoe UI", system-ui, sans-serif';

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

  function applyToRoot(root, scope) {
    if (root.closest(SKIP)) return;
    const blocks = root.querySelectorAll(scope.blocks);
    // User messages are plain text with no block children — flip the root itself.
    const targets = blocks.length > 0 ? blocks : [root];
    for (const el of targets) {
      if (el !== root && el.closest(SKIP)) continue;
      setDirection(el);
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
