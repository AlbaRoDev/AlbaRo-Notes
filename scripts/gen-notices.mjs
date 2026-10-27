// Writes THIRD_PARTY_NOTICES.txt: the licences of everything that ships inside the app.
// Run with `npm run notices` after changing dependencies and commit the result; `npm run
// notices:check` (used by the CI) regenerates it in memory and fails if the file is out of date.
// Rust: `cargo metadata` (normal dependencies only, for each target we ship).
// npm: the production entries of package-lock.json, read from node_modules (so `npm ci` first).
// A package that publishes no licence file gets it from its repository, once, into
// scripts/notices-cache/ (committed), so generating the file needs no network afterwards.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The systems we ship. macOS is not distributed yet: add "aarch64-apple-darwin" with it.
const TARGETS = ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"];
const CHECK = process.argv.includes("--check");
const CACHE = join(root, "scripts/notices-cache");
// Crates that declare no repository: found by hand.
const REPOSITORIES = {
  "libappindicator-sys": "https://github.com/tauri-apps/libappindicator-rs",
};
// Where a repository keeps its licence, in the order we try.
const LICENSE_NAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENSE-MIT",
  "LICENSE-APACHE",
  "LICENSE-ZLIB",
  "LICENSE-2.0.txt",
  "LICENCE",
  "COPYING",
  "UNLICENSE",
];
// npm licences we accept in the interface bundle; anything else stops the script so someone looks
// at it. "BSD" is `duck`'s own label: its LICENSE is the 2-clause text (read on 2026-10-27).
const NPM_ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "OFL-1.1",
  "MPL-2.0",
  "Unlicense",
  "CC0-1.0",
  "Zlib",
]);
const LICENSE_FILE = /^(licen[cs]e|copying|unlicense|notice)/i;
const RULE = "=".repeat(80);

function clean(text) {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function licenseTexts(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => clean(readFileSync(join(dir, e.name), "utf8")))
    .filter(Boolean);
}

/** `https://github.com/o/r(.git)` (or `git+...`, `github.com:o/r`) -> `o/r`. */
function githubRepo(url) {
  const m = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[/#].*)?$/.exec(url ?? "");
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * A published package often leaves out the licence (a workspace keeps one at the repository root).
 * Fetches it from the repository at the commit (or tag) it was published from and keeps it in
 * scripts/notices-cache/<key>. Returns the cache folder when it holds something.
 */
async function cachedLicences(key, repoUrl, refs, subdir) {
  const dir = join(CACHE, key);
  const has = () => existsSync(dir) && licenseTexts(dir).length > 0;
  if (has() || CHECK) return has() ? dir : null;
  const repo = githubRepo(repoUrl);
  if (!repo) return null;
  const places = subdir ? [subdir, ""] : [""];
  for (const ref of refs) {
    for (const place of places) {
      let found = 0;
      for (const name of LICENSE_NAMES) {
        const path = place ? `${place}/${name}` : name;
        const res = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`).catch(
          () => null,
        );
        if (!res?.ok) continue;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, name), await res.text());
        found++;
      }
      if (found) return dir;
    }
  }
  return null;
}

/** Groups packages by identical licence text; those with no text go to `missing`. */
class Collector {
  byText = new Map();
  missing = [];

  add(label, dirs, spdx, url) {
    const texts =
      [dirs]
        .flat()
        .filter(Boolean)
        .map((d) => licenseTexts(d))
        .find((t) => t.length > 0) ?? [];
    if (texts.length === 0) {
      this.missing.push(`${label} - ${spdx || "no licence declared"}${url ? ` - ${url}` : ""}`);
      return;
    }
    const text = texts.join("\n\n");
    const key = createHash("sha256").update(text).digest("hex");
    const group = this.byText.get(key) ?? { text, labels: new Set() };
    group.labels.add(label);
    this.byText.set(key, group);
  }

  render() {
    const groups = [...this.byText.values()].sort((a, b) => b.labels.size - a.labels.size);
    const out = groups.map(
      (g) => `${wrap([...g.labels].sort().join(", "))}\n${"-".repeat(80)}\n${g.text}`,
    );
    if (this.missing.length) {
      out.push(
        `Packages that ship no licence file (licence as declared in their metadata)\n${"-".repeat(80)}\n${this.missing.sort().join("\n")}`,
      );
    }
    return out.join(`\n\n${RULE}\n\n`);
  }
}

function wrap(text, width = 100) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  return [...lines, line].join("\n");
}

function rustCrates() {
  const found = new Map();
  for (const target of TARGETS) {
    const json = execFileSync(
      "cargo",
      [
        "metadata",
        "--format-version",
        "1",
        "--locked",
        "--filter-platform",
        target,
        "--manifest-path",
        "src-tauri/Cargo.toml",
      ],
      { cwd: root, maxBuffer: 1 << 28, encoding: "utf8" },
    );
    const meta = JSON.parse(json);
    const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    const seen = new Set();
    const visit = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const pkg = pkgs.get(id);
      // A proc-macro runs at build time only: it is not in the binary, and neither are its dependencies.
      if (pkg.targets.some((t) => t.kind.includes("proc-macro"))) return;
      if (id !== meta.resolve.root) found.set(id, pkg);
      for (const dep of nodes.get(id).deps) {
        if (dep.dep_kinds.some((k) => k.kind === null)) visit(dep.pkg);
      }
    };
    visit(meta.resolve.root);
  }
  return [...found.values()];
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** Every package in the lockfile that is not development-only, with where it lives on disk. */
function npmPackages() {
  const lock = readJson(join(root, "package-lock.json"));
  return Object.entries(lock.packages ?? {})
    .filter(([path, p]) => path && !p.dev && !p.link)
    .map(([path, p]) => ({
      name: path.replace(/^.*node_modules\//, ""),
      version: p.version,
      license: p.license,
      path: join(root, path),
    }));
}

const rust = new Collector();
for (const p of rustCrates()) {
  const dir = dirname(p.manifest_path);
  let extra = null;
  if (licenseTexts(dir).length === 0) {
    // `.cargo_vcs_info.json` says which commit, and which folder of it, the crate was published from.
    const vcs = readJson(join(dir, ".cargo_vcs_info.json"));
    const refs = [vcs.git?.sha1, `v${p.version}`, p.version, "HEAD"].filter(Boolean);
    extra = await cachedLicences(
      `${p.name}-${p.version}`,
      p.repository ?? REPOSITORIES[p.name] ?? p.homepage,
      refs,
      vcs.path_in_vcs,
    );
  }
  rust.add(`${p.name} ${p.version}`, [dir, extra], p.license, p.repository);
}
const npm = new Collector();
const disallowed = [];
const notInstalled = [];
for (const p of npmPackages()) {
  if (!existsSync(p.path)) {
    notInstalled.push(`${p.name} ${p.version}`);
    continue;
  }
  // An SPDX expression: one alternative of `A OR B` is enough, every part of `A AND B` must be allowed.
  const allowed = String(p.license)
    .replace(/[()]/g, "")
    .split(/ OR /)
    .some((alt) => alt.split(/ AND /).every((l) => NPM_ALLOWED.has(l.trim())));
  if (!allowed) disallowed.push(`${p.name} ${p.version}: ${p.license}`);
  let extra = null;
  if (licenseTexts(p.path).length === 0) {
    const pkg = readJson(join(p.path, "package.json"));
    const repo = pkg.repository?.url ?? pkg.repository ?? pkg.homepage;
    extra = await cachedLicences(
      `${p.name.replace("/", "__")}-${p.version}`,
      repo,
      [pkg.gitHead, `v${p.version}`, p.version, "HEAD"].filter(Boolean),
      null,
    );
  }
  npm.add(`${p.name} ${p.version}`, [p.path, extra], p.license, undefined);
}
if (notInstalled.length) {
  console.error(`Run \`npm ci\` first: not in node_modules:\n  ${notInstalled.join("\n  ")}`);
  process.exit(1);
}
if (disallowed.length) {
  console.error(
    `npm packages with a licence that is not on the allowed list (NPM_ALLOWED):\n  ${disallowed.join("\n  ")}`,
  );
  process.exit(1);
}

const section = (title, body) => `${RULE}\n${title}\n${RULE}\n\n${body}\n`;

const header = `THIRD-PARTY NOTICES - AlbaRo Notes

AlbaRo Notes is released under the MIT licence (see LICENSE). It includes the third-party
software listed below. This file is generated by scripts/gen-notices.mjs; do not edit it by hand.

Where a package is offered under more than one licence ("MIT OR GPL-3.0-or-later"), AlbaRo Notes
uses it under the permissive one. Ollama, which the optional local AI uses, is installed by the
user and is not part of this application. Map tiles (OpenStreetMap contributors, ODbL) are
downloaded when a map is viewed and are not bundled.
`;

const output = [
  header,
  section("1. Rust libraries (linked into the application)", rust.render()),
  section(
    "2. JavaScript libraries and fonts (in the interface), including Playfair Display (SIL OFL 1.1)",
    npm.render(),
  ),
].join("\n");
const target = join(root, "THIRD_PARTY_NOTICES.txt");

if (CHECK) {
  const current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  if (current !== output) {
    console.error(
      "THIRD_PARTY_NOTICES.txt is out of date: run `npm run notices` and commit the result.",
    );
    process.exit(1);
  }
  console.log("THIRD_PARTY_NOTICES.txt is up to date");
} else {
  writeFileSync(target, output);
  console.log(
    `THIRD_PARTY_NOTICES.txt: ${rust.byText.size + rust.missing.length} Rust and ${npm.byText.size + npm.missing.length} npm entries`,
  );
}
