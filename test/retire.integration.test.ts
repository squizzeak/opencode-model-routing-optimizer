#!/usr/bin/env bun
/**
 * Integration tests for the install + retirement wiring (plan §4.2, §15).
 *
 * Unlike `installer.test.ts` (which unit-tests `retireOne`), these exercise the
 * composed `installAndRetire` entry against a throwaway config root, and assert
 * the end-to-end invariants §15 calls out: retirement wiring, repeated startup
 * idempotence, modified-content preservation, historical fixtures, symlinks,
 * nonempty directories, and error handling — plus the four-value version
 * invariant. No user config is ever touched.
 */
import { test, expect, describe } from "bun:test";
import type { Plugin } from "@opencode-ai/plugin";
import {
  installAndRetire,
  type RetireOutcome,
} from "../src/index.ts";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const ASSETS = join(REPO, "assets");

const SKILL_DST = "skills/design-fallback-chain/SKILL.md";
const COMMAND_DST = "command/design-fallback-chain.md";
const SKILL_DIR = "skills/design-fallback-chain";

const FIXTURE_SKILL = join(REPO, "test", "fixtures", "retired-skill-v0.1.0.md");
const FIXTURE_COMMAND = join(REPO, "test", "fixtures", "retired-command-v0.1.0.md");

type Client = Parameters<Plugin>[0]["client"];

/** Minimal in-memory client capturing log calls. */
function fakeClient(): { client: Client; logs: { level: string; message: string }[] } {
  const logs: { level: string; message: string }[] = [];
  const client = {
    app: {
      log: async (arg: { body: { level: string; message: string } }) => {
        logs.push({ level: arg.body.level, message: arg.body.message });
      },
    },
  } as unknown as Client;
  return { client, logs };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "install-retire-"));
}

/** Seed a destination file (and its parents) under `root`. */
async function seed(root: string, dstRel: string, bytes: Buffer | string): Promise<void> {
  const dstPath = join(root, dstRel);
  await mkdir(dirname(dstPath), { recursive: true });
  await writeFile(dstPath, bytes);
}

describe("installAndRetire wiring", () => {
  test("fresh install: two assets installed, nothing retired", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();

    const report = await installAndRetire(ASSETS, root, client);

    expect(report.installed.length).toBe(2);
    expect(report.retired).toEqual([]);
    expect(report.preserved).toEqual([]);
    expect(report.retireErrors).toEqual([]);
    expect(existsSync(join(root, "skills/optimize-micode-models/SKILL.md"))).toBe(true);
    expect(existsSync(join(root, "command/optimize-micode.md"))).toBe(true);
  });

  test("upgrade over unmodified retired files: both removed, owned dir pruned", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();
    await seed(root, SKILL_DST, readFileSync(FIXTURE_SKILL));
    await seed(root, COMMAND_DST, readFileSync(FIXTURE_COMMAND));

    const report = await installAndRetire(ASSETS, root, client);

    const retiredPaths = report.retired.map((t) => t.dstRel).sort();
    expect(retiredPaths).toEqual([COMMAND_DST, SKILL_DST].sort());
    expect(report.preserved).toEqual([]);
    expect(report.retireErrors).toEqual([]);
    expect(existsSync(join(root, SKILL_DST))).toBe(false);
    expect(existsSync(join(root, COMMAND_DST))).toBe(false);
    // The retired skill's own directory is pruned …
    expect(existsSync(join(root, SKILL_DIR))).toBe(false);
    // … but the shared command/ dir (still holding the installed command) is not.
    expect(existsSync(join(root, "command"))).toBe(true);
  });

  test("modified retired content is preserved, never deleted (non-destructive)", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();
    await seed(root, SKILL_DST, "# my own edited skill\nuser changes\n");
    await seed(root, COMMAND_DST, readFileSync(FIXTURE_COMMAND));

    const report = await installAndRetire(ASSETS, root, client);

    expect(report.retired.map((t) => t.dstRel)).toEqual([COMMAND_DST]);
    expect(report.preserved.map((p) => p.target.dstRel)).toEqual([SKILL_DST]);
    // The user's edited file survives byte-for-byte.
    expect(existsSync(join(root, SKILL_DST))).toBe(true);
    expect(readFileSync(join(root, SKILL_DST), "utf8")).toBe(
      "# my own edited skill\nuser changes\n",
    );
    // A preserved file does NOT prune its directory.
    expect(existsSync(join(root, SKILL_DIR))).toBe(true);
  });

  test("repeated startup is idempotent and quiet", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();
    await seed(root, SKILL_DST, readFileSync(FIXTURE_SKILL));
    await seed(root, COMMAND_DST, readFileSync(FIXTURE_COMMAND));

    const first = await installAndRetire(ASSETS, root, client);
    expect(first.retired.length).toBe(2);

    const second = await installAndRetire(ASSETS, root, client);
    expect(second.installed).toEqual([]);
    expect(second.retired).toEqual([]);
    expect(second.preserved).toEqual([]);
    expect(second.retireErrors).toEqual([]);
  });

  test("nonempty retired dir is kept after its file is removed", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();
    await seed(root, SKILL_DST, readFileSync(FIXTURE_SKILL));
    // A sibling file the user placed in the same (shared-looking) dir.
    await seed(root, `${SKILL_DIR}/user-notes.md`, "keep me\n");

    const report = await installAndRetire(ASSETS, root, client);

    expect(report.retired.map((t) => t.dstRel)).toContain(SKILL_DST);
    expect(existsSync(join(root, SKILL_DST))).toBe(false);
    expect(existsSync(join(root, `${SKILL_DIR}/user-notes.md`))).toBe(true);
    expect(existsSync(join(root, SKILL_DIR))).toBe(true);
  });

  test("symlinked destination is preserved and its target untouched", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();
    const outside = join(await tempRoot(), "outside.md");
    await writeFile(outside, readFileSync(FIXTURE_SKILL));
    await mkdir(join(root, SKILL_DIR), { recursive: true });
    await symlink(outside, join(root, SKILL_DST));

    const report = await installAndRetire(ASSETS, root, client);

    expect(report.retired.map((t) => t.dstRel)).not.toContain(SKILL_DST);
    expect(report.preserved.map((p) => p.target.dstRel)).toContain(SKILL_DST);
    expect(existsSync(join(root, SKILL_DST))).toBe(true);
    expect(existsSync(outside)).toBe(true);
  });

  test("error handling: a directory at the retired path is reported, not swallowed", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();
    await mkdir(join(root, SKILL_DST), { recursive: true });

    const report = await installAndRetire(ASSETS, root, client);

    expect(report.retireErrors.map((e) => e.target.dstRel)).toContain(SKILL_DST);
    expect(report.retired.map((t) => t.dstRel)).not.toContain(SKILL_DST);
    expect(report.preserved.map((p) => p.target.dstRel)).not.toContain(SKILL_DST);
    // The anomalous directory is left in place, not removed.
    expect(existsSync(join(root, SKILL_DST))).toBe(true);
  });

  test("retirement never throws out of the entry point", async () => {
    const root = await tempRoot();
    const { client } = fakeClient();
    await seed(root, SKILL_DST, readFileSync(FIXTURE_SKILL));
    await seed(root, COMMAND_DST, readFileSync(FIXTURE_COMMAND));

    const report = await installAndRetire(ASSETS, root, client);
    // Sanity: it produced a well-formed outcome rather than throwing.
    expect(report).toHaveProperty("retired");
    expect(report).toHaveProperty("preserved");
    expect(report).toHaveProperty("retireErrors");
  });
});

describe("version invariant — four values must match", () => {
  test("package.json == PLUGIN_VERSION == both asset markers", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      version: string;
    };
    const indexSrc = readFileSync(join(REPO, "src", "index.ts"), "utf8");
    const pluginVersion = indexSrc.match(/const PLUGIN_VERSION = "([^"]+)"/)?.[1];

    const markerOf = (rel: string): string | undefined =>
      readFileSync(join(REPO, "assets", rel), "utf8").match(
        /routing-optimizer:version=([0-9A-Za-z.+-]+)/,
      )?.[1];

    const skillMarker = markerOf("skills/optimize-micode-models/SKILL.md");
    const commandMarker = markerOf("command/optimize-micode.md");

    expect(pluginVersion).toBeDefined();
    expect(skillMarker).toBeDefined();
    expect(commandMarker).toBeDefined();

    const values = new Set([pkg.version, pluginVersion!, skillMarker!, commandMarker!]);
    expect(values.size).toBe(1);
    expect(pkg.version).toBe("0.3.0");
  });
});

describe("repo no longer ships the retired assets", () => {
  test("retired paths are gone from assets/", () => {
    expect(existsSync(join(REPO, "assets/skills/design-fallback-chain"))).toBe(false);
    expect(existsSync(join(REPO, "assets/command/design-fallback-chain.md"))).toBe(false);
  });

  test("retired paths are gone from the committed dist/ build output", () => {
    expect(existsSync(join(REPO, "dist/assets/skills/design-fallback-chain"))).toBe(false);
    expect(existsSync(join(REPO, "dist/assets/command/design-fallback-chain.md"))).toBe(false);
    // The two current assets are present in dist/ (Path B install source).
    expect(existsSync(join(REPO, "dist/assets/skills/optimize-micode-models/SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(join(REPO, "dist/assets/command/optimize-micode.md"))).toBe(true);
  });
});

// `RetireOutcome` is imported only to pin the exported shape the wiring returns.
test("RetireOutcome shape is exported and stable", () => {
  const outcome: RetireOutcome = { retired: [], preserved: [], errors: [] };
  expect(Object.keys(outcome).sort()).toEqual(["errors", "preserved", "retired"]);
});
