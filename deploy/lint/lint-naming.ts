/**
 * pi-coding-master naming convention linter
 * Checks files/dirs against 003-naming-convention.NORM
 *
 * Usage: bun Codebase/test/lint-naming.ts
 *   Run from pi-coding-master.DEV/ directory
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, dirname } from "node:path";

// --- Configuration ---

const SKIP_NAMES = new Set([".git", "node_modules", "__pycache__", ".DS_Store", ".vscode"]);

const KNOWN_TYPED_SUFFIXES = new Set([
  "SPEC", "README", "CHANGELOG", "LESSON", "ISSUE", "NORM",
  "VERSION", "BLUEPRINT", "PAPER", "INDEX", "COMMENT", "TRUST",
]);

const LIFECYCLE_SUFFIXES = new Set(["DEV", "RELEASE", "FUTURE", "HISTORICAL"]);

// All known ALLCAPS suffixes (typed + lifecycle)
const ALL_KNOWN_UPPER = new Set([...KNOWN_TYPED_SUFFIXES, ...LIFECYCLE_SUFFIXES]);

const OLD_PREFIX_RE = /(?:^|[/\\])(HumaN|AgenT)\b/;

// --- Helpers ---

const ROOT = process.cwd();
const issues: string[] = [];
let fileCount = 0;

function relPath(abs: string): string {
  return relative(ROOT, abs);
}

/** Extract the final .ALLCAPS suffix from a name, if any. */
function extractUpperSuffix(name: string): string | null {
  const m = name.match(/\.([A-Z]{2,})$/);
  return m ? m[1] : null;
}

/** Check if a name has a typed suffix followed by .md */
function hasMdAfterTypedSuffix(name: string): { suffix: string; clean: string } | null {
  for (const suf of KNOWN_TYPED_SUFFIXES) {
    const pattern = `.${suf}.md`;
    if (name.endsWith(pattern)) {
      return { suffix: suf, clean: name.slice(0, -3) }; // remove trailing .md
    }
  }
  return null;
}

/** Check if a Codebase/core/ directory name has uppercase letters (excluding lifecycle suffix) */
function hasUpperInCodeDir(dirName: string): boolean {
  // Strip lifecycle suffix if present (e.g. ".DEV")
  let base = dirName;
  for (const ls of LIFECYCLE_SUFFIXES) {
    if (base.endsWith(`.${ls}`)) {
      base = base.slice(0, -(ls.length + 1));
      break;
    }
  }
  // Strip #human. / #agent. / @human. / @agent. prefixes
  base = base.replace(/^[#@](?:human|agent)\./, "");
  return /[A-Z]/.test(base);
}

// --- Walk ---

function walk(dir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  // Collect names for stale-js check (per directory)
  const tsFiles = new Set<string>();
  const jsFiles = new Set<string>();

  for (const name of entries) {
    if (SKIP_NAMES.has(name)) continue;

    const full = join(dir, name);
    const rel = relPath(full);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }

    fileCount++;

    // --- Rule 1: .md after typed suffix ---
    const mdHit = hasMdAfterTypedSuffix(name);
    if (mdHit) {
      issues.push(`[SUFFIX] ${rel} — has .md after typed suffix, should be ${mdHit.clean}`);
    }

    // --- Rule 5: unknown ALLCAPS suffix ---
    const upperSuf = extractUpperSuffix(name);
    if (upperSuf && !ALL_KNOWN_UPPER.has(upperSuf)) {
      // Ignore known lowercase extensions that happen to be uppercase (shouldn't exist but be safe)
      issues.push(`[UNKNOWN] ${rel} — .${upperSuf} is not a known suffix (typo?)`);
    }

    // --- Rule 4: old HumaN / AgenT prefix ---
    if (OLD_PREFIX_RE.test(name)) {
      const match = name.match(OLD_PREFIX_RE)!;
      const oldPfx = match[1];
      const replacement = oldPfx === "HumaN" ? "#human." : "#agent.";
      issues.push(`[PREFIX] ${rel} — old ${oldPfx} convention, use ${replacement} prefix`);
    }

    if (isDir) {
      // --- Rule 2: code directory case (Codebase/core/ children) ---
      const parentRel = relPath(dir);
      const isCoreChild = parentRel === "Codebase/core"
        || parentRel.startsWith("Codebase/core/");
      if (isCoreChild && hasUpperInCodeDir(name)) {
        issues.push(`[CASE] ${rel} — code directory should be lowercase`);
      }

      // --- Rule 3: top-level org dirs should start uppercase ---
      const isTopLevel = relPath(dir) === ".";
      if (isTopLevel && /^[a-z]/.test(name) && !name.startsWith(".") && !name.startsWith("#") && !name.startsWith("@")) {
        issues.push(`[CASE] ${rel} — top-level directory should start with uppercase`);
      }

      walk(full);
    } else {
      // Track .ts / .js for stale check
      if (name.endsWith(".ts") && !name.includes(".ts.")) tsFiles.add(name.replace(/\.ts$/, ""));
      if (name.endsWith(".js") && !name.includes(".js.")) jsFiles.add(name.replace(/\.js$/, ""));
    }
  }

  // --- Rule 6: stale .js alongside .ts ---
  for (const stem of jsFiles) {
    if (tsFiles.has(stem)) {
      issues.push(`[STALE] ${relPath(join(dir, stem + ".js"))} — stale .js exists alongside ${stem}.ts`);
    }
  }
}

// --- Rule 7: SPEC source hash staleness ---
function checkSpecHashes(root: string) {
  const specs: string[] = [];
  function findSpecs(dir: string) {
    for (const name of readdirSync(dir)) {
      if (SKIP_NAMES.has(name)) continue;
      const full = join(dir, name);
      try {
        const st = statSync(full);
        if (st.isDirectory()) findSpecs(full);
        else if (name.endsWith(".SPEC")) specs.push(full);
      } catch {}
    }
  }
  findSpecs(root);

  for (const specPath of specs) {
    try {
      const content = readFileSync(specPath, "utf8");
      const firstLine = content.split("\n")[0];
      const m = firstLine.match(/^source:\s*(\S+)\s*@\s*([a-f0-9]+)/);
      if (!m) continue;
      const [, srcName, expectedHash] = m;
      const srcPath = join(dirname(specPath), srcName);
      try {
        const srcContent = readFileSync(srcPath);
        const actualHash = createHash("sha256").update(srcContent).digest("hex").slice(0, 8);
        if (actualHash !== expectedHash) {
          issues.push(`[STALE] ${relPath(specPath)} — source hash mismatch (expected ${expectedHash}, got ${actualHash}), SPEC may be outdated`);
        }
      } catch {
        issues.push(`[STALE] ${relPath(specPath)} — source file "${srcName}" not found`);
      }
    } catch {}
  }
}

// --- Main ---

walk(ROOT);
checkSpecHashes(ROOT);

if (issues.length > 0) {
  for (const msg of issues) {
    console.log(msg);
  }
  console.log();
}

const mark = issues.length === 0 ? "✓" : "✗";
console.log(`${mark} ${fileCount} files checked, ${issues.length} issues found`);
process.exit(issues.length > 0 ? 1 : 0);
