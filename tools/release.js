// Cut a release commit interactively:
//
//   npm run release
//
// Shows the current version, prompts for the new one (default: next patch),
// then writes it to module.json (with `download` pointed at the versioned
// asset URL) and package.json, and commits both as "Release <version>" — the
// shape the release workflow detects. Nothing is pushed or tagged here: push
// main and the workflow tags, builds and publishes the release.
import fs from "node:fs";
import process from "node:process";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

// Prompt for a line of input. Lines are queued as they arrive, so answers work
// the same whether typed at a terminal or piped in ("printf '1.0.9\ny\n' |
// npm run release"); end of input aborts.
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const pending = [];
let waiter = null;
let closed = false;
rl.on("line", (line) => {
  if (waiter) {
    const resolve = waiter;
    waiter = null;
    resolve(line);
  } else pending.push(line);
});
rl.on("close", () => {
  closed = true;
  if (waiter) {
    const resolve = waiter;
    waiter = null;
    resolve(null);
  }
});
async function ask(prompt) {
  process.stdout.write(prompt);
  if (pending.length) return pending.shift().trim();
  if (closed) return null;
  const line = await new Promise((resolve) => {
    waiter = resolve;
  });
  return line === null ? null : line.trim();
}

const MODULE = "module.json";
const PACKAGE = "package.json";
const SEMVER = /^\d+\.\d+\.\d+$/;

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function nextPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// Rewrite one top-level "key": "value" line in place, keeping the file's
// formatting untouched otherwise.
function setJsonField(file, key, value) {
  const text = fs.readFileSync(file, "utf8");
  const re = new RegExp(`^(\\s*"${key}":\\s*")([^"]*)(")`, "m");
  if (!re.test(text)) fail(`${file}: no "${key}" field to update.`);
  fs.writeFileSync(file, text.replace(re, `$1${value}$3`));
}

// The versioned asset URL, derived from the manifest's own repository URL so
// the script needs no configuration.
function downloadUrl(manifest, version) {
  const m = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\//.exec(
    manifest.download || manifest.manifest || "",
  );
  if (!m) fail(`${MODULE}: cannot derive the GitHub repository from its URLs.`);
  return `${m[1]}/releases/download/${version}/module.zip`;
}

const manifest = JSON.parse(fs.readFileSync(MODULE, "utf8"));
const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
const current = manifest.version;

// Preconditions: a clean tree on main, so the release commit holds only the
// version bump.
if (git("status", "--porcelain"))
  fail("Working tree is not clean — commit or stash first.");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") console.warn(`Note: on branch "${branch}", not main.`);

console.log(
  `Current version: ${current}` +
    (pkg.version !== current ? ` (package.json says ${pkg.version})` : ""),
);
const suggested = nextPatch(current);
const answer = await ask(`New version [${suggested}]: `);
if (answer === null) fail("Aborted.");
const version = answer || suggested;

if (!SEMVER.test(version))
  fail(`"${version}" is not a MAJOR.MINOR.PATCH version.`);
if (version === current) fail(`${version} is already the current version.`);
if (git("tag", "--list", version)) fail(`Tag ${version} already exists.`);
if (compareVersions(version, current) < 0) {
  const ok = await ask(`${version} is lower than ${current}. Continue? [y/N] `);
  if (!ok || !/^y(es)?$/i.test(ok)) fail("Aborted.");
}

const download = downloadUrl(manifest, version);
console.log(`\nWill commit "Release ${version}":`);
console.log(`  ${MODULE}: version ${current} -> ${version}`);
console.log(`  ${MODULE}: download -> ${download}`);
console.log(`  ${PACKAGE}: version ${pkg.version} -> ${version}`);
const go = await ask("Proceed? [y/N] ");
rl.close();
if (!go || !/^y(es)?$/i.test(go)) fail("Aborted.");

setJsonField(MODULE, "version", version);
setJsonField(MODULE, "download", download);
setJsonField(PACKAGE, "version", version);
git("add", MODULE, PACKAGE);
git("commit", "-q", "-m", `Release ${version}`);
console.log(`\n${git("log", "-1", "--format=%h %s")}`);
console.log(
  `Now push main: the release workflow tags ${version}, builds and publishes it.`,
);
