#!/usr/bin/env bun
/**
 * Build script: clean `dist/`, then run `tsc`, then copy `assets/` into
 * `dist/assets/`. Run with `bun run build` (invoked by `package.json`).
 *
 * Idempotent. Resolves the local `tsc` binary (installed by bun) directly
 * so it works the same whether invoked under bun or node.
 */
import { rm, cp, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";

async function main() {
  const distDir = join(ROOT, "dist");
  const assetsSrc = join(ROOT, "assets");
  const assetsDst = join(distDir, "assets");

  console.log("[build] cleaning dist/");
  await rm(distDir, { recursive: true, force: true });

  console.log("[build] running tsc");
  const tsc = spawnSync(
    join(ROOT, "node_modules", ".bin", "tsc"),
    [],
    { cwd: ROOT, stdio: "inherit" },
  );
  if (tsc.status !== 0) {
    console.error("[build] tsc failed");
    process.exit(tsc.status ?? 1);
  }

  if (!existsSync(assetsSrc)) {
    console.warn(`[build] no assets/ directory at ${assetsSrc} — skipping copy`);
    return;
  }

  console.log(`[build] copying assets → ${assetsDst}`);
  await mkdir(distDir, { recursive: true });
  await cp(assetsSrc, assetsDst, { recursive: true });

  console.log("[build] done");
}

main().catch((err) => {
  console.error("[build] fatal:", err);
  process.exit(1);
});
