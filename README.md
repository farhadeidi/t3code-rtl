# t3code-rtl

Persian and Arabic right-to-left support for T3 Code chat messages and question prompts.

`t3code-rtl` patches T3 Code locally. Persian and Arabic message blocks become RTL and use the bundled Arad font; code blocks, terminals, diffs, the composer input, and the sidebar remain LTR.

## What it changes — and what it does not

**Only blocks that contain Persian or Arabic text are affected, and only inside chat messages and the drawer above the composer. Nothing else in T3 Code is changed.**

- A paragraph, list item, heading, or table cell inside a chat message gets `dir="rtl"` and the Arad font only if it contains at least one Persian or Arabic character.
- The drawer above the composer — the question card, its options, approval requests — is treated the same way: a question, an option label, or an option description with Persian or Arabic text becomes RTL. An option row with RTL text also mirrors, so its shortcut number sits on the left.
- Every block without such text is left exactly as it was — same direction, same font, same styling. A card with an English header and Persian options keeps the header LTR.
- Code blocks, inline code, diffs, terminal output, and keyboard shortcut badges are never flipped, even when they appear inside an RTL block.
- The composer input, sidebar, menus, settings, and the rest of the interface are never touched.

The patch is a single small script injected into the app's `index.html`. It does not change any application logic, settings, data, or network behavior.

> [!WARNING]
> This unofficial tool modifies files inside the T3 Code application bundle. Reapply the patch after every T3 Code update.

## Requirements

Node.js 20 or later, plus one of these T3 Code installations:

- **macOS desktop app:** any `T3 Code*.app` in `/Applications`. The managed update mode additionally requires the Homebrew cask `t3-code`.
- **Linux desktop app:** `/opt/t3code-bin` or `/opt/t3code-nightly-bin` (AUR packages).
- **`t3` npm package** (`npm install -g t3`, the same server that `npx t3` runs): detected automatically through `npm root -g`.
- **Windows desktop app:** `%LOCALAPPDATA%\Programs\T3 Code` (winget). Untested; report problems in the issue tracker.

Other locations can be supplied with `T3CODE_APP_DIRS` (one app or package directory per line).

`npx t3@latest` downloads a fresh copy into the npx cache on every run, so a patch applied there does not persist. Use `npm install -g t3` and run `t3` instead.

## Run

```sh
npx t3code-rtl
```

The first run detects T3 Code, asks how updates should work, applies the patch, and remembers the choice. Restart T3 Code afterwards. It has two update modes only:

- **Managed (macOS, recommended):** disables T3 Code's internal updater for this tool and uses `t3code-rtl update` to upgrade via Homebrew and reapply the patch. Only offered when T3 Code was installed with Homebrew.
- **Native:** leaves T3 Code automatic updates enabled. After an update, run `npx t3code-rtl patch` and restart the app.

No background watcher is installed.

## Commands

```sh
npx t3code-rtl                 # interactive menu
npx t3code-rtl setup           # choose update strategy and patch
npx t3code-rtl patch           # apply the patch
npx t3code-rtl unpatch         # remove the patch, LaunchAgent, and settings
npx t3code-rtl status          # show detected apps, patch state, and update mode
npx t3code-rtl doctor          # show detailed diagnostics
npx t3code-rtl update          # Homebrew update + patch on macOS
```

To install a permanent command instead:

```sh
npm install -g t3code-rtl
t3code-rtl
```

## Troubleshooting

Run `npx t3code-rtl status` to see whether each detected app is currently patched. After a T3 Code update the state returns to `not patched`; run `patch` again.

`npx t3code-rtl doctor` prints the platform, config path, Homebrew and LaunchAgent state, and the bundle layout and ASAR integrity setting for each app.

**"ASAR integrity validation is enabled; refusing to patch"** — the installed T3 Code build verifies its `app.asar` and would refuse to start after modification. The tool stops rather than break the app. If you want to try anyway, run with `T3CODE_RTL_FORCE=1`; reinstall T3 Code if it no longer starts.

## Testing without touching the desktop app

The `t3` npm package serves the same web client as the desktop app, so it is a safe way to try the patch:

```sh
mkdir t3-sandbox && cd t3-sandbox && npm install t3@latest
T3CODE_APP_DIRS="$PWD/node_modules/t3" npx t3code-rtl patch
npx t3 start --port 4711 --base-dir "$PWD/data"
```

Open the printed URL and send a Persian or Arabic message. `npx t3code-rtl unpatch` with the same `T3CODE_APP_DIRS` reverts it; delete the sandbox directory when done.

Contributors can run the automated version of this, which cleans up after itself: `npm run test:smoke` (fake bundles) or `SMOKE_T3=1 npm run test:smoke` (also the real `t3` package).

## Safety

The patch is idempotent: each application replaces the prior injected block. Current ASAR layouts are changed in place and receive an unpacked `index.html` override. `unpatch` removes the injected block and the LaunchAgent; reinstall T3 Code through its package manager to restore the original bundle byte for byte.

## License

The code is [MIT licensed](LICENSE). The bundled Arad font is available under the [SIL Open Font License 1.1](fonts/OFL.txt).
