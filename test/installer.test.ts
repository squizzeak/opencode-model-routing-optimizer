#!/usr/bin/env bun
/**
 * Lightweight unit tests for the pure-function parts of `installer.ts`:
 *  - `compareSemver`
 *  - `needsInstall`
 *  - `readVersion` (against the real shipped assets)
 *
 * Run with `bun test`. There are intentionally no integration tests — the
 * installer's I/O path is exercised every time opencode loads the plugin.
 */
import { test, expect, describe } from "bun:test";
import { compareSemver, needsInstall, readVersion, INSTALL_TARGETS } from "../src/installer.ts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

describe("shipped skill metadata", () => {
  for (const target of INSTALL_TARGETS.filter((target) => target.srcRel.endsWith("/SKILL.md"))) {
    test(`${target.srcRel} has discoverable YAML frontmatter`, () => {
      const content = readFileSync(join(REPO, "assets", target.srcRel), "utf8");
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      expect(frontmatter).not.toBeNull();
      // Unquoted colon-space sequences in descriptions previously prevented discovery.
      const metadata = Bun.YAML.parse(frontmatter![1]) as Record<string, unknown>;
      expect(metadata.name).toBe(target.srcRel.split("/")[1]);
      expect(typeof metadata.description).toBe("string");
      expect((metadata.description as string).length).toBeGreaterThan(0);
      expect((metadata.description as string).length).toBeLessThanOrEqual(1024);
    });
  }
});

/**
 * Read the canonical plugin version straight from `package.json` so the
 * shipped-asset markers test stays in sync without hand-editing this
 * file every release. (Before this, the test was known to drift — every
 * release required updating this literal.)
 */
function loadPkgVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(REPO, "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

describe("compareSemver", () => {
  test("orders basic numbers", () => {
    expect(compareSemver("0.1.0", "0.1.1")).toBe(-1);
    expect(compareSemver("0.1.1", "0.1.0")).toBe(1);
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });
  test("handles unequal length numerically, not lexically", () => {
    // Lexicographic "0.1.10" < "0.1.9" — semver-correct is the opposite
    expect(compareSemver("0.1.10", "0.1.9")).toBe(1);
    expect(compareSemver("0.1.2", "0.1.10")).toBe(-1);
  });
  test("treats missing trailing components as 0", () => {
    expect(compareSemver("0.1", "0.1.0")).toBe(0);
    expect(compareSemver("0.1.1", "0.1")).toBe(1);
  });
  test("tolerates leading v", () => {
    expect(compareSemver("v0.1.0", "0.1.0")).toBe(0);
    expect(compareSemver("v0.1.0", "v0.1.1")).toBe(-1);
  });
});

describe("needsInstall", () => {
  test("installs when destination missing", () => {
    expect(needsInstall("0.1.0", undefined)).toBe(true);
  });
  test("installs when source newer than destination", () => {
    expect(needsInstall("0.1.1", "0.1.0")).toBe(true);
    expect(needsInstall("0.2.0", "0.1.9")).toBe(true);
  });
  test("skips when destination up to date", () => {
    expect(needsInstall("0.1.0", "0.1.0")).toBe(false);
  });
  test("refuses to overwrite when source lacks marker", () => {
    expect(needsInstall(undefined, "0.1.0")).toBe(false);
  });
});

describe("readVersion against shipped assets", () => {
  test("extracts version from each asset in assets/", async () => {
    const targets = [
      "skills/optimize-micode-models/SKILL.md",
      "skills/design-fallback-chain/SKILL.md",
      "command/optimize-micode.md",
      "command/design-fallback-chain.md",
    ];
    for (const rel of targets) {
      const path = join(REPO, "assets", rel);
      const v = await readVersion(path);
      expect(v).toBeDefined();
      expect(v).toMatch(/^\d+\.\d+\.\d+/);
      // Must match package.json's version field (auto-synced by loadPkgVersion)
      expect(v).toBe(loadPkgVersion());
    }
  });

  test("returns undefined for non-existent files", async () => {
    const v = await readVersion(join(REPO, "test", "does-not-exist.md"));
    expect(v).toBeUndefined();
  });
});
