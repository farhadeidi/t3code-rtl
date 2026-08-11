# t3code-rtl

Persian and Arabic right-to-left support for T3 Code chat messages.

`t3code-rtl` patches T3 Code locally. Persian and Arabic message blocks become RTL and use the bundled Arad font; code blocks, terminals, diffs, the composer, and the sidebar remain LTR.

> [!WARNING]
> This unofficial tool modifies files inside the T3 Code application bundle. Reapply the patch after every T3 Code update.

## Run

Requires Node.js 20 or later.

```sh
npx t3code-rtl
```

The first run detects T3 Code, asks how updates should work, applies the patch, and remembers the choice. It has two update modes only:

- **Managed (macOS, recommended):** disables T3 Code's internal updater for this tool and uses `t3code-rtl update` to upgrade via Homebrew and reapply the patch.
- **Native:** leaves T3 Code automatic updates enabled. After an update, run `npx t3code-rtl patch` and restart the app.

No background watcher is installed.

## Commands

```sh
npx t3code-rtl                 # interactive menu
npx t3code-rtl setup           # choose update strategy and patch
npx t3code-rtl patch           # apply the patch
npx t3code-rtl status          # show detected apps and update mode
npx t3code-rtl doctor          # show basic diagnostics
npx t3code-rtl update          # Homebrew update + patch on macOS
```

To install a permanent command instead:

```sh
npm install -g t3code-rtl
t3code-rtl
```

## Safety

The patch is idempotent: each application replaces the prior injected block. Current ASAR layouts are changed in place and receive an unpacked `index.html` override. Reinstall T3 Code through its package manager to roll back the bundle.

## License

The code is [MIT licensed](LICENSE). The bundled Arad font is available under the [SIL Open Font License 1.1](fonts/OFL.txt).
