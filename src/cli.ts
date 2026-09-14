#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import * as p from "@clack/prompts";

type UpdateMode = "managed" | "native";
type Config = { updateMode?: UpdateMode; managedByPatch?: boolean };

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const BEGIN = "<!-- t3code-rtl:begin -->";
const END = "<!-- t3code-rtl:end -->";
const CLIENT_INDEX = "apps/server/dist/client/index.html";
const AGENT_LABEL = "io.github.farhadeidi.t3code-rtl-disable-auto-update";
const ENV_FLAG = "T3CODE_DISABLE_AUTO_UPDATE";
// Homebrew casks that ship T3 Code, with the app bundle each one installs.
const BREW_CASKS = [
  { cask: "t3-code", app: "T3 Code (Alpha).app" },
  { cask: "t3-code@nightly", app: "T3 Code (Nightly).app" },
];
const isMac = process.platform === "darwin";
const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

// ---------- Paths and configuration ----------

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function globDir(pattern: string): string[] {
  const dir = dirname(pattern);
  const re = new RegExp(`^${escapeRegExp(basename(pattern)).replace("\\*", ".*")}$`);
  try {
    return readdirSync(dir).filter((x) => re.test(x)).map((x) => join(dir, x)).sort();
  } catch {
    return [];
  }
}

/** Global npm install of the `t3` server package (`npm i -g t3`), if present. */
function globalNpmPackage(): string | undefined {
  const result = spawnSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const root = result.stdout?.trim();
  if (!root) return undefined;
  const dir = join(root, "t3");
  return existsSync(join(dir, "dist", "client", "index.html")) ? dir : undefined;
}

function appDirs(): string[] {
  const override = process.env.T3CODE_APP_DIRS?.split("\n").filter(Boolean);
  if (override?.length) return override;
  const dirs: string[] = [];
  if (isMac) dirs.push(...globDir("/Applications/T3 Code*.app"));
  else if (process.platform === "linux") dirs.push("/opt/t3code-bin", "/opt/t3code-nightly-bin");
  else if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    dirs.push(join(process.env.LOCALAPPDATA, "Programs", "T3 Code"));
  }
  const npmPackage = globalNpmPackage();
  if (npmPackage) dirs.push(npmPackage);
  return dirs;
}

function configPath(): string {
  if (isMac) return join(home, "Library", "Application Support", "t3code-rtl", "config.json");
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "t3code-rtl", "config.json");
}

function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(value: Config) {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(value, null, 2) + "\n");
}

function agentPath() {
  return join(home, "Library", "LaunchAgents", `${AGENT_LABEL}.plist`);
}

// ---------- Application bundle inspection ----------

type Layout = {
  app: string;
  resources: string;
  kind: "unpacked" | "asar" | "npm";
  html: string; // path of the index.html that is read/written
};

function findLayout(app: string): Layout | undefined {
  // `t3` npm package (npx t3 / npm i -g t3): the server serves dist/client directly.
  const npmIndex = join(app, "dist", "client", "index.html");
  if (existsSync(npmIndex)) return { app, resources: app, kind: "npm", html: npmIndex };
  for (const middle of ["resources", "Contents/Resources"]) {
    const resources = join(app, middle);
    const unpacked = join(resources, "app.asar.unpacked", CLIENT_INDEX);
    if (existsSync(join(resources, "app.asar"))) return { app, resources, kind: "asar", html: unpacked };
    if (existsSync(unpacked)) return { app, resources, kind: "unpacked", html: unpacked };
  }
  return undefined;
}

function isPatched(layout: Layout): boolean {
  try {
    return readFileSync(layout.html, "utf8").includes(BEGIN);
  } catch {
    return false;
  }
}

/** Returns true/false when the Electron binary states its ASAR integrity setting, undefined when unknown. */
function asarIntegrityEnforced(app: string): boolean | undefined {
  const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
  const framework = join(app, "Contents", "Frameworks", "Electron Framework.framework", "Versions");
  if (!existsSync(framework)) return undefined;
  for (const version of readdirSync(framework)) {
    try {
      const data = readFileSync(join(framework, version, "Electron Framework"));
      const at = data.indexOf(sentinel);
      if (at >= 0) return data[at + sentinel.length + 2 + 4] === 0x31;
    } catch {}
  }
  return undefined;
}

// ---------- Payload and HTML injection ----------

function supportFile(name: string): string {
  for (const path of [join(root, name), join(root, "fonts", name)]) if (existsSync(path)) return path;
  throw new Error(`${name} is missing from the package`);
}

function payload(): string {
  const js = readFileSync(supportFile("rtl.js"), "utf8");
  const font = readFileSync(supportFile("AradNLVF.woff2")).toString("base64");
  return js.replace("__T3CODE_ARAD_FONT__", `data:font/woff2;base64,${font}`);
}

const injectedBlock = new RegExp(`[ \\t]*${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n?`, "g");

function stripBlock(html: string): string {
  return html.replace(injectedBlock, "");
}

function inject(html: string, js: string): string {
  const clean = stripBlock(html);
  if (!clean.includes("</body>")) throw new Error("index.html has no </body>");
  return clean.replace("</body>", `${BEGIN}\n<script>\n${js}</script>\n${END}\n  </body>`);
}

// ---------- ASAR handling ----------

type AsarEntry = { offset?: string; size: number; unpacked?: boolean; integrity?: unknown };

function asarEntry(header: any): AsarEntry | undefined {
  let node = header;
  for (const part of CLIENT_INDEX.split("/")) node = node?.files?.[part];
  return node;
}

function integrity(data: Buffer) {
  const blockSize = 4 * 1024 * 1024;
  const hash = (x: Buffer) => createHash("sha256").update(x).digest("hex");
  const blocks: string[] = [];
  for (let i = 0; i < data.length; i += blockSize) blocks.push(hash(data.subarray(i, i + blockSize)));
  return { algorithm: "SHA256", hash: hash(data), blockSize, blocks };
}

function patchAsar(layout: Layout, js: string) {
  const asar = join(layout.resources, "app.asar");
  const raw = readFileSync(asar);
  const jsonLen = raw.readUInt32LE(12);
  const header = JSON.parse(raw.subarray(16, 16 + jsonLen).toString());
  const entry = asarEntry(header);
  if (!entry) throw new Error("client index was not found in app.asar");

  const target = layout.html;
  let html: string;
  if (entry.unpacked && existsSync(target)) {
    html = readFileSync(target, "utf8");
  } else {
    const base = 8 + raw.readUInt32LE(4) + Number(entry.offset);
    html = raw.subarray(base, base + Number(entry.size)).toString();
  }

  const patched = Buffer.from(inject(html, js));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, patched);
  chmodSync(target, 0o644);

  delete entry.offset;
  entry.size = patched.length;
  entry.unpacked = true;
  entry.integrity = integrity(patched);
  const encoded = Buffer.from(JSON.stringify(header));
  if (encoded.length > jsonLen) throw new Error("patched ASAR header would grow");
  encoded.copy(raw, 16);
  raw.fill(0x20, 16 + encoded.length, 16 + jsonLen);
  writeFileSync(asar, raw);
}

// ---------- Patch / unpatch ----------

function patchApp(layout: Layout, js: string) {
  if (existsSync(layout.html)) {
    // Either a plain unpacked layout or an ASAR layout whose override file already exists.
    writeFileSync(layout.html, inject(readFileSync(layout.html, "utf8"), js));
    return;
  }
  const enforced = asarIntegrityEnforced(layout.app);
  if (enforced !== false && !process.env.T3CODE_RTL_FORCE) {
    throw new Error(
      `ASAR integrity validation is ${enforced ? "enabled" : "unknown"}; refusing to patch. ` +
        `Set T3CODE_RTL_FORCE=1 to try anyway (the app may fail to start).`,
    );
  }
  patchAsar(layout, js);
}

function patch() {
  const js = payload();
  let count = 0;
  for (const app of appDirs()) {
    const layout = findLayout(app);
    if (!layout) continue;
    try {
      patchApp(layout, js);
      count++;
      p.log.success(`Patched ${basename(app)}`);
    } catch (e) {
      p.log.error(`${basename(app)}: ${(e as Error).message}`);
    }
  }
  if (!count) throw new Error("No T3 Code installation was patched.");
  p.log.info("Restart T3 Code to see the change.");
}

function unpatch() {
  let count = 0;
  for (const app of appDirs()) {
    const layout = findLayout(app);
    if (!layout || !isPatched(layout)) continue;
    // For ASAR layouts the header keeps pointing at the unpacked override; a clean
    // override file is equivalent to the original page, so stripping is sufficient.
    writeFileSync(layout.html, stripBlock(readFileSync(layout.html, "utf8")));
    count++;
    p.log.success(`Removed patch from ${basename(app)}`);
  }
  if (!count) p.log.info("No patched T3 Code installation was found.");
  return count;
}

// ---------- Update mode / LaunchAgent ----------

function launchctl(args: string[], quiet = false) {
  return spawnSync("launchctl", args, { stdio: quiet ? "ignore" : "inherit" }).status === 0;
}

/** Installed T3 Code casks, or undefined when Homebrew itself is unavailable. */
function brewCasks(): string[] | undefined {
  const result = spawnSync("brew", ["list", "--cask", "-1"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.error || result.status !== 0) return undefined;
  const installed = new Set(result.stdout.split("\n").map((line) => line.trim()));
  return BREW_CASKS.map((x) => x.cask).filter((cask) => installed.has(cask));
}

/** Why `t3code-rtl update` cannot update an installation and what to do instead; undefined when a cask covers it. */
function manualUpdateHint(app: string, casks: string[]): string | undefined {
  const known = BREW_CASKS.find((x) => x.app === basename(app));
  if (known && casks.includes(known.cask)) return undefined;
  if (known) return `was not installed with Homebrew. Reinstall it with: brew install --cask --force ${known.cask}`;
  if (!app.endsWith(".app")) return "is the t3 npm package. Update it with: npm install -g t3@latest";
  return "does not match a known Homebrew cask. Update it manually";
}

/** Warns about every installation that Homebrew cannot update; returns how many there are. */
function warnManualUpdates(apps: string[], casks: string[]): number {
  let count = 0;
  for (const app of apps) {
    const hint = manualUpdateHint(app, casks);
    if (!hint) continue;
    p.log.warn(`${basename(app)} will not be updated by t3code-rtl update: it ${hint}, then run: t3code-rtl patch`);
    count++;
  }
  return count;
}

const caskNames = () => BREW_CASKS.map((x) => x.cask).join(", ");

function removeAgent(config: Config) {
  if (!isMac) return;
  launchctl(["bootout", `gui/${process.getuid?.()}/${AGENT_LABEL}`], true);
  try {
    unlinkSync(agentPath());
  } catch {}
  if (config.managedByPatch) launchctl(["unsetenv", ENV_FLAG], true);
}

function setMode(mode: UpdateMode) {
  const config = readConfig();
  if (!isMac) {
    saveConfig({ ...config, updateMode: "native" });
    return;
  }
  removeAgent(config);
  if (mode === "managed") {
    mkdirSync(dirname(agentPath()), { recursive: true });
    writeFileSync(
      agentPath(),
      `<?xml version="1.0"?><plist version="1.0"><dict>` +
        `<key>Label</key><string>${AGENT_LABEL}</string>` +
        `<key>ProgramArguments</key><array><string>/bin/launchctl</string><string>setenv</string>` +
        `<string>${ENV_FLAG}</string><string>true</string></array>` +
        `<key>RunAtLoad</key><true/></dict></plist>`,
    );
    launchctl(["bootstrap", `gui/${process.getuid?.()}`, agentPath()]);
    launchctl(["setenv", ENV_FLAG, "true"]);
    saveConfig({ ...config, updateMode: mode, managedByPatch: true });
  } else {
    saveConfig({ ...config, updateMode: mode, managedByPatch: false });
  }
}

// ---------- Commands ----------

async function approve(message: string) {
  const answer = await p.confirm({ message });
  if (p.isCancel(answer) || !answer) {
    p.cancel("No changes were made.");
    return false;
  }
  return true;
}

function requireSupportedPlatform() {
  if (isMac || process.platform === "linux" || process.platform === "win32") return;
  throw new Error(
    `${process.platform} is not supported. t3code-rtl works on macOS, Linux, and Windows.\n` +
      `You can still point it at an app directory with T3CODE_APP_DIRS.`,
  );
}

async function setup() {
  p.intro("T3 Code RTL Patch");
  const found = appDirs().filter(existsSync);
  if (!found.length) {
    p.outro("T3 Code was not found.");
    return;
  }
  p.log.success(`Found ${found.map((path) => basename(path)).join(", ")}`);

  let mode: UpdateMode = "native";
  if (isMac) {
    const casks = brewCasks();
    const viaBrew = !!casks?.length;
    if (!casks) p.log.warn("Homebrew is not installed; managed updates are unavailable.");
    else if (!viaBrew) p.log.warn(`No T3 Code Homebrew cask (${caskNames()}) is installed; managed updates are unavailable.`);
    const answer = await p.select({
      message: "How should updates work?",
      options: [
        ...(viaBrew ? [{ value: "managed", label: "Homebrew + automatic re-patch", hint: "recommended" }] : []),
        { value: "native", label: "Keep T3 Code automatic updates", hint: "patch manually afterward" },
      ],
    });
    if (p.isCancel(answer)) return p.cancel("Cancelled.");
    mode = answer as UpdateMode;
    if (mode === "managed" && warnManualUpdates(found, casks ?? [])) {
      p.log.warn("Managed updates also turn off the automatic updater of the apps listed above.");
    }
  }

  if (!(await approve(`This will configure ${mode} updates and modify ${found.length} T3 Code app bundle(s). Continue?`))) return;
  setMode(mode);
  patch();
  p.outro("Ready.");
}

function status() {
  const apps = appDirs().filter(existsSync);
  if (!apps.length) {
    console.log("T3 Code: not found");
  } else {
    for (const app of apps) {
      const layout = findLayout(app);
      const state = !layout ? "unrecognized layout" : isPatched(layout) ? "patched" : "not patched";
      console.log(`${basename(app)}: ${state}  (${app})`);
    }
  }
  console.log(`Update mode: ${readConfig().updateMode ?? "not configured"}`);
}

function doctor() {
  const config = readConfig();
  console.log(`Platform: ${process.platform} (${isMac || process.platform === "linux" ? "supported" : process.platform === "win32" ? "untested" : "unsupported"})`);
  console.log(`Node: ${process.version}`);
  console.log(`Config: ${configPath()} ${existsSync(configPath()) ? "" : "(missing)"}`);
  console.log(`Update mode: ${config.updateMode ?? "not configured"}`);
  if (isMac) {
    const casks = brewCasks();
    if (!casks) console.log("Homebrew: not installed");
    for (const { cask } of casks ? BREW_CASKS : []) {
      console.log(`Homebrew cask "${cask}": ${casks?.includes(cask) ? "installed" : "not installed"}`);
    }
    console.log(`LaunchAgent: ${existsSync(agentPath()) ? "present" : "absent"}`);
    const env = spawnSync("launchctl", ["getenv", ENV_FLAG], { encoding: "utf8" }).stdout?.trim();
    console.log(`${ENV_FLAG} (launchctl): ${env || "unset"}`);
  }
  const apps = appDirs().filter(existsSync);
  console.log(`Apps: ${apps.length ? "" : "none found"}`);
  for (const app of apps) {
    const layout = findLayout(app);
    console.log(`  ${app}`);
    if (!layout) {
      console.log("    layout: unrecognized");
      continue;
    }
    console.log(`    layout: ${layout.kind}`);
    console.log(`    patched: ${isPatched(layout) ? "yes" : "no"}`);
    if (layout.kind === "asar") {
      const enforced = asarIntegrityEnforced(app);
      console.log(`    asar integrity: ${enforced === undefined ? "unknown" : enforced ? "enabled" : "disabled"}`);
    }
  }
}

async function update() {
  if (!isMac) throw new Error("Update T3 Code through your package manager, then run: t3code-rtl patch");
  const casks = brewCasks();
  if (!casks) throw new Error("Homebrew is not installed. Update T3 Code manually, then run: t3code-rtl patch");
  warnManualUpdates(appDirs().filter(existsSync), casks);
  if (!casks.length) {
    throw new Error(`No T3 Code Homebrew cask (${caskNames()}) is installed. Update T3 Code manually, then run: t3code-rtl patch`);
  }
  if (!(await approve(`This will update ${casks.join(", ")} with Homebrew and modify the app bundle(s). Continue?`))) return;
  const failed: string[] = [];
  for (const cask of casks) {
    try {
      execFileSync("brew", ["upgrade", "--cask", "--greedy", cask], { stdio: "inherit" });
    } catch {
      failed.push(cask);
      p.log.error(`Homebrew could not upgrade ${cask} (see the output above). Fix the problem, then run: t3code-rtl update`);
    }
  }
  patch();
  if (failed.length) process.exitCode = 1;
}

async function uninstall() {
  const agent = isMac && existsSync(agentPath());
  const message = agent
    ? "This will remove the RTL patch, the LaunchAgent, and re-enable T3 Code automatic updates. Continue?"
    : "This will remove the RTL patch from T3 Code. Continue?";
  if (!(await approve(message))) return;
  unpatch();
  const config = readConfig();
  removeAgent(config);
  try {
    unlinkSync(configPath());
  } catch {}
  p.log.info("Restart T3 Code to finish.");
}

async function interactive() {
  if (!readConfig().updateMode) return setup();
  p.intro("T3 Code RTL Patch");
  const action = await p.select({
    message: "What do you want to do?",
    options: [
      { value: "patch", label: "Apply patch now" },
      { value: "status", label: "Check status" },
      { value: "setup", label: "Change update strategy" },
      ...(isMac ? [{ value: "update", label: "Update T3 Code now" }] : []),
      { value: "unpatch", label: "Remove patch and settings" },
    ],
  });
  if (p.isCancel(action)) return p.cancel("Cancelled.");
  if (action === "patch") {
    if (await approve("This will modify the T3 Code app bundle. Continue?")) patch();
  } else if (action === "status") status();
  else if (action === "setup") await setup();
  else if (action === "update") await update();
  else await uninstall();
  p.outro("Done.");
}

const USAGE = "Usage: t3code-rtl [setup|patch|unpatch|status|doctor|update]";

async function main() {
  const command = process.argv[2];
  try {
    if (command === "doctor") return doctor();
    requireSupportedPlatform();
    if (!command) await interactive();
    else if (command === "setup") await setup();
    else if (command === "patch") {
      if (await approve("This will modify the T3 Code app bundle. Continue?")) patch();
    } else if (command === "unpatch") await uninstall();
    else if (command === "status") status();
    else if (command === "update") await update();
    else if (command === "help" || command === "--help" || command === "-h") console.log(USAGE);
    else throw new Error(USAGE);
  } catch (e) {
    p.log.error((e as Error).message);
    process.exitCode = 1;
  }
}

void main();
