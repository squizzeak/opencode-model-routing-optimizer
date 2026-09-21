#!/usr/bin/env bun
/**
 * Lightweight unit tests for the pure-function parts of `installer.ts` plus the
 * retired-asset machinery:
 *  - `compareSemver`
 *  - `needsInstall`
 *  - `readVersion` (against the real shipped assets)
 *  - `sha256Hex`
 *  - `retireOne` / `RETIRED_TARGETS` / `RETIRED_ASSET_HASHES`
 *
 * Run with `bun test`. The retirement tests exercise real filesystem I/O in a
 * throwaway temp directory — never the user's real config root.
 */
import { test, expect, describe } from "bun:test";
import {
  compareSemver,
  needsInstall,
  readVersion,
  INSTALL_TARGETS,
  RETIRED_TARGETS,
  RETIRED_ASSET_HASHES,
  sha256Hex,
  retireOne,
  type RetiredTarget,
} from "../src/installer.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";

const REPO = fileURLToPath(new URL("..", import.meta.url));

const SKILL_DST = "skills/design-fallback-chain/SKILL.md";
const COMMAND_DST = "command/design-fallback-chain.md";
const SKILL_PRUNE_DIR = "skills/design-fallback-chain";

/** Build a retired target whose only allowlisted hash is `content`'s. */
function targetFor(
  content: string,
  dstRel: string,
  pruneDirRel?: string,
): RetiredTarget {
  const target: RetiredTarget = {
    dstRel,
    knownHashes: [sha256Hex(Buffer.from(content, "utf8"))],
  };
  if (pruneDirRel !== undefined) target.pruneDirRel = pruneDirRel;
  return target;
}

/** Create a fresh temp config root for one retirement test. */
async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "retire-"));
}

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
  test("extracts version from each remaining asset in assets/", async () => {
    const targets = [
      "skills/optimize-micode-models/SKILL.md",
      "command/optimize-micode.md",
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

describe("INSTALL_TARGETS regression", () => {
  test("ships exactly two assets and none is the retired path", () => {
    expect(INSTALL_TARGETS.length).toBe(2);
    for (const target of INSTALL_TARGETS) {
      expect(target.srcRel).not.toContain("design-fallback-chain");
      expect(target.dstRel).not.toContain("design-fallback-chain");
    }
  });
});

describe("retired asset allowlist", () => {
  test("is non-empty and every hash is a 64-char lowercase hex digest", () => {
    const entries = Object.entries(RETIRED_ASSET_HASHES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, hashes] of entries) {
      expect(hashes.length).toBeGreaterThan(0);
      for (const hash of hashes) {
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  test("RETIRED_TARGETS prunes only the skill's own directory", () => {
    expect(RETIRED_TARGETS.length).toBeGreaterThan(0);
    const skill = RETIRED_TARGETS.find((t) => t.dstRel === SKILL_DST);
    const command = RETIRED_TARGETS.find((t) => t.dstRel === COMMAND_DST);
    expect(skill).toBeDefined();
    expect(command).toBeDefined();
    expect(skill!.pruneDirRel).toBe(SKILL_PRUNE_DIR);
    // command/ is shared — the command target must never prune.
    expect(command!.pruneDirRel).toBeUndefined();
  });
});

describe("sha256Hex", () => {
  test("normalizes CRLF so LF and CRLF of the same text hash equal", () => {
    const lf = Buffer.from("alpha\nbeta\n", "utf8");
    const crlf = Buffer.from("alpha\r\nbeta\r\n", "utf8");
    expect(sha256Hex(lf)).toBe(sha256Hex(crlf));
  });

  test("different content hashes differently", () => {
    expect(sha256Hex(Buffer.from("alpha\n", "utf8"))).not.toBe(
      sha256Hex(Buffer.from("beta\n", "utf8")),
    );
  });
});

describe("retireOne", () => {
  test("removes exact known bytes and reports removed", async () => {
    const root = await tempRoot();
    const content = "# retired skill\n";
    const dstPath = join(root, SKILL_DST);
    await mkdir(dirname(dstPath), { recursive: true });
    await writeFile(dstPath, content);

    const result = await retireOne(root, targetFor(content, SKILL_DST));

    expect(result.status).toBe("removed");
    expect(existsSync(dstPath)).toBe(false);
  });

  test("preserves modified content even when the marker survived", async () => {
    const root = await tempRoot();
    const original = "<!-- routing-optimizer:version=0.2.4 -->\noriginal\n";
    const edited = "<!-- routing-optimizer:version=0.2.4 -->\nuser edited\n";
    const dstPath = join(root, SKILL_DST);
    await mkdir(dirname(dstPath), { recursive: true });
    await writeFile(dstPath, edited);

    const result = await retireOne(root, targetFor(original, SKILL_DST));

    expect(result.status).toBe("preserved");
    expect(existsSync(dstPath)).toBe(true);
    expect(readFileSync(dstPath, "utf8")).toBe(edited);
  });

  test("removes a CRLF variant because fingerprints are CRLF-normalized", async () => {
    const root = await tempRoot();
    const lf = "line one\nline two\n";
    const crlf = "line one\r\nline two\r\n";
    const dstPath = join(root, SKILL_DST);
    await mkdir(dirname(dstPath), { recursive: true });
    await writeFile(dstPath, crlf);

    const result = await retireOne(root, targetFor(lf, SKILL_DST));

    expect(result.status).toBe("removed");
    expect(existsSync(dstPath)).toBe(false);
  });

  test("reports absent when the destination is missing", async () => {
    const root = await tempRoot();
    const result = await retireOne(root, targetFor("anything\n", SKILL_DST));
    expect(result.status).toBe("absent");
  });

  test("prunes its own empty directory after removal", async () => {
    const root = await tempRoot();
    const content = "# skill\n";
    const dstPath = join(root, SKILL_DST);
    await mkdir(dirname(dstPath), { recursive: true });
    await writeFile(dstPath, content);

    const result = await retireOne(
      root,
      targetFor(content, SKILL_DST, SKILL_PRUNE_DIR),
    );

    expect(result.status).toBe("removed");
    expect(existsSync(join(root, SKILL_PRUNE_DIR))).toBe(false);
  });

  test("does not prune a non-empty directory but still removes the file", async () => {
    const root = await tempRoot();
    const content = "# skill\n";
    const dstPath = join(root, SKILL_DST);
    await mkdir(dirname(dstPath), { recursive: true });
    await writeFile(dstPath, content);
    const sibling = join(root, SKILL_PRUNE_DIR, "notes.md");
    await writeFile(sibling, "user notes\n");

    const result = await retireOne(
      root,
      targetFor(content, SKILL_DST, SKILL_PRUNE_DIR),
    );

    expect(result.status).toBe("removed");
    expect(existsSync(dstPath)).toBe(false);
    expect(readFileSync(sibling, "utf8")).toBe("user notes\n");
  });

  test("never removes a shared skills/ dir that still holds other skills", async () => {
    const root = await tempRoot();
    const content = "# skill\n";
    const dstPath = join(root, SKILL_DST);
    await mkdir(dirname(dstPath), { recursive: true });
    await writeFile(dstPath, content);
    const other = join(root, "skills", "other-skill", "SKILL.md");
    await mkdir(dirname(other), { recursive: true });
    await writeFile(other, "other\n");

    const result = await retireOne(
      root,
      targetFor(content, SKILL_DST, SKILL_PRUNE_DIR),
    );

    expect(result.status).toBe("removed");
    expect(existsSync(join(root, "skills"))).toBe(true);
    expect(readFileSync(other, "utf8")).toBe("other\n");
  });

  test("preserves a symlinked destination and leaves its target untouched", async () => {
    const root = await tempRoot();
    const content = "real content\n";
    const dstPath = join(root, SKILL_DST);
    await mkdir(dirname(dstPath), { recursive: true });
    const linkTarget = join(root, "real-content.md");
    await writeFile(linkTarget, content);
    await symlink(linkTarget, dstPath);

    const result = await retireOne(root, targetFor(content, SKILL_DST));

    expect(result.status).toBe("preserved");
    expect(result.status === "preserved" && result.reason).toBe("is a symbolic link");
    expect(existsSync(dstPath)).toBe(true);
    expect(readFileSync(linkTarget, "utf8")).toBe(content);
  });

  test("preserves a destination under a symlinked parent directory", async () => {
    const root = await tempRoot();
    const external = await mkdtemp(join(tmpdir(), "retire-ext-"));
    const content = "# external skill\n";
    const externalDst = join(external, "design-fallback-chain", "SKILL.md");
    await mkdir(dirname(externalDst), { recursive: true });
    await writeFile(externalDst, content);
    await symlink(external, join(root, "skills"));

    const result = await retireOne(root, targetFor(content, SKILL_DST));

    expect(result.status).toBe("preserved");
    expect(result.status === "preserved" && result.reason).toBe(
      "path has a symlinked parent",
    );
    expect(readFileSync(externalDst, "utf8")).toBe(content);
  });

  test("reports an error when the destination path is a directory", async () => {
    const root = await tempRoot();
    const dstPath = join(root, SKILL_DST);
    await mkdir(dstPath, { recursive: true });

    const result = await retireOne(root, targetFor("n/a\n", SKILL_DST));

    expect(result.status).toBe("error");
    expect(existsSync(dstPath)).toBe(true);
  });
});

/**
 * Historical fixtures are exact historical shipped bytes captured from git
 * (`git show <commit>:<path>`). They must stay byte-exact — the allowlist is a
 * fingerprint of these very bytes, so any re-encoding breaks the coverage test.
 */
const HISTORICAL_FIXTURES: ReadonlyArray<{ file: string; dstRel: string }> = [
  { file: "retired-skill-v0.1.0.md", dstRel: SKILL_DST },
  { file: "retired-command-v0.1.0.md", dstRel: COMMAND_DST },
  { file: "retired-skill-dist-v0.1.4.md", dstRel: SKILL_DST },
];

describe("historical retired fixtures", () => {
  for (const { file, dstRel } of HISTORICAL_FIXTURES) {
    test(`${file} hashes into the allowlist for ${dstRel}`, () => {
      const bytes = readFileSync(join(REPO, "test", "fixtures", file));
      expect(RETIRED_ASSET_HASHES[dstRel]).toContain(sha256Hex(bytes));
    });

    test(`${file} is retired from a seeded temp config root`, async () => {
      const root = await tempRoot();
      const dstPath = join(root, dstRel);
      await mkdir(dirname(dstPath), { recursive: true });
      const bytes = readFileSync(join(REPO, "test", "fixtures", file));
      await writeFile(dstPath, bytes);

      const result = await retireOne(root, {
        dstRel,
        knownHashes: RETIRED_ASSET_HASHES[dstRel],
      });

      expect(result.status).toBe("removed");
      expect(existsSync(dstPath)).toBe(false);
    });
  }
});
