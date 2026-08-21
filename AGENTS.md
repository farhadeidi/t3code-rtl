# t3code-rtl Agent Guide

## Product

`t3code-rtl` is a TypeScript CLI that adds RTL rendering for Persian and
Arabic chat messages in the T3 Code desktop application. The public npm
package is `t3code-rtl`.

Keep all repository prose, user-facing CLI text, and source code in English.
The Unicode range in `rtl.js` is intentional: it detects RTL-script content
and is not user-facing prose.

## Sensitive changes

Get explicit user approval immediately before any action that:

- Modifies a T3 Code application bundle or `app.asar`.
- Creates, removes, or changes the LaunchAgent that controls
  `T3CODE_DISABLE_AUTO_UPDATE`.
- Publishes to npm, pushes to a remote, or changes repository visibility.

Describe the exact effect before requesting approval. Never treat an earlier
approval as permission for a later execution-time mutation.

## Change checklist

For changes affecting patching or updates, check every relevant surface:

- Unpacked and ASAR application layouts.
- ASAR integrity validation and rollback behavior.
- Managed and native update modes, including their confirmation prompts.
- README command examples and the npm package contents.

Do not add background watchers or scheduled jobs.

## Verification

Run the smallest relevant checks before handing off a change:

```sh
npm run check
npm run build
npm pack --dry-run
npm run test:smoke            # fake bundles only, fast
SMOKE_T3=1 npm run test:smoke # also installs the `t3` npm package and checks the served page
```

`scripts/smoke.sh` runs inside a temp directory with an isolated `HOME` and
removes everything on exit, including on failure or interruption. Any ad-hoc
test must follow the same rule: isolate with `T3CODE_APP_DIRS` and `HOME`,
and clean up temp files, installed packages, and background servers
afterwards. Never leave test artifacts behind.

Use a real macOS T3 Code installation for release validation when a change
touches app patching, updates, or LaunchAgent behavior. Do not modify a user's
installed app during routine automated checks.

If these instructions conflict with the requested task, explain the conflict
and get user sign-off before proceeding.
