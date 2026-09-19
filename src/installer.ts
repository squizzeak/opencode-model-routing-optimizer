import {
  readFile,
  writeFile,
  mkdir,
  access,
  open,
  constants,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Marker prefix used to version-tag each asset shipped by this plugin.
 * Format inside a shipped markdown file:
 *   <!-- routing-optimizer:version=0.1.1 -->
 * The installer extracts the `<version=` substring to decide whether the
 * destination file is stale.
 */
export const VERSION_MARKER_PREFIX = "routing-optimizer:version=";

/**
 * The asset files that this plugin installs into the user's opencode config.
 * Each entry maps a relative asset path (`assets/...`) to its destination
 * under the user's opencode config directory.
 */
export interface InstallTarget {
  /** Path inside this plugin's `assets/` directory, e.g. `skills/foo/SKILL.md`. */
  srcRel: string;
  /**
   * Path inside the user's opencode config root, e.g.
   * `skills/foo/SKILL.md` or `command/foo.md`.
   */
  dstRel: string;
}

/**
 * The four assets shipped by this plugin. Keep in sync with `assets/` and the
 * npm package's `files: ["dist", ...]` field.
 */
export const INSTALL_TARGETS: ReadonlyArray<InstallTarget> = [
  {
    srcRel: "skills/optimize-micode-models/SKILL.md",
    dstRel: "skills/optimize-micode-models/SKILL.md",
  },
  {
    srcRel: "skills/design-fallback-chain/SKILL.md",
    dstRel: "skills/design-fallback-chain/SKILL.md",
  },
  {
    srcRel: "command/optimize-micode.md",
    dstRel: "command/optimize-micode.md",
  },
  {
    srcRel: "command/design-fallback-chain.md",
    dstRel: "command/design-fallback-chain.md",
  },
];

/**
 * Extracts the routing-optimizer version from a markdown file's contents.
 * Returns `undefined` if the marker is missing or the file is unreadable.
 *
 * The version line is expected to appear near the top of the file, after the
 * YAML frontmatter:
 *
 *     ---
 *     name: optimize-micode-models
 *     ...
 *     ---
 *
 *     <!-- routing-optimizer:version=0.1.1 -->
 *
 * Implementation: read the first ~1 KB, find the first occurrence of the
 * marker prefix, and parse the value after `=`.
 */
export async function readVersion(
  filePath: string,
): Promise<string | undefined> {
  let fd: FileHandle | undefined;
  try {
    fd = await open(filePath, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    const idx = head.indexOf(VERSION_MARKER_PREFIX);
    if (idx === -1) return undefined;
    const after = head.slice(idx + VERSION_MARKER_PREFIX.length);
    // Take the first semver-ish run
    const match = after.match(/^([0-9A-Za-z.+-]+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  } finally {
    await fd?.close().catch(() => {});
  }
}

/**
 * Returns true if a destination file is missing OR its version marker is
 * older than the source's. Pure logic — does not touch the filesystem.
 *
 * Semver string comparison is intentionally simple: we use the `>` operator
 * on the version strings. Both versions are expected to follow semver; the
 * fallback (string) comparison handles `0.1.0` < `0.1.1` correctly because
 * numeric components compare longer-than-alpha via string compare of zero-
 * padded values, and identical-length strings like `0.1.0` vs `0.1.10`
 * would otherwise compare wrong. We mitigate that by falling back to
 * `compareSemver` — see the implementation.
 */
export function needsInstall(
  srcVersion: string | undefined,
  dstVersion: string | undefined,
): boolean {
  // Destination missing → install
  if (dstVersion === undefined) return true;
  // Source missing its marker → don't overwrite a user's possibly-customized file
  if (srcVersion === undefined) return false;
  return compareSemver(srcVersion, dstVersion) > 0;
}

/**
 * Compare two semver-like version strings numerically. Returns -1, 0, or 1
 * following the standard `<`, `=`, `>` ordering. Tolerates a leading `v`.
 * Falls back to string compare if either input is not parseable.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (s: string): number[] | null => {
    const cleaned = s.replace(/^v/i, "");
    const parts = cleaned.split(/[.+-]/).map((p) => Number.parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n))) return null;
    return parts;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

/**
 * Idempotently install a single file. Creates parent directories as needed.
 * No-op (and returns `installed: false`) when the destination is up to date.
 */
export async function installOne(
  absPluginAssetsDir: string,
  absConfigRoot: string,
  target: InstallTarget,
  pluginVersion: string,
): Promise<
  | { status: "installed"; target: InstallTarget }
  | { status: "skipped"; target: InstallTarget; reason: string }
  | { status: "missing-marker"; target: InstallTarget }
> {
  const srcPath = join(absPluginAssetsDir, target.srcRel);
  const dstPath = join(absConfigRoot, target.dstRel);

  // Always read the source first — if it's missing the marker, refuse to
  // write it (a release would be invalid).
  const srcVersion = await readVersion(srcPath);
  if (srcVersion === undefined) {
    return { status: "missing-marker", target };
  }
  if (srcVersion !== pluginVersion) {
    // Plugin version and embedded marker disagree — refuse to install the
    // mismatched file rather than ship a version mismatch.
    return {
      status: "skipped",
      target,
      reason: `plugin version ${pluginVersion} ≠ embedded marker ${srcVersion}`,
    };
  }

  // Check destination version only if the file exists.
  let dstVersion: string | undefined;
  try {
    await access(dstPath, constants.F_OK);
    dstVersion = await readVersion(dstPath);
  } catch {
    dstVersion = undefined;
  }

  if (!needsInstall(srcVersion, dstVersion)) {
    return {
      status: "skipped",
      target,
      reason:
        dstVersion === undefined
          ? "destination unreadable or no marker"
          : "destination already at current version",
    };
  }

  // Ensure parent dir exists, then copy.
  await mkdir(dirname(dstPath), { recursive: true });
  const content = await readFile(srcPath, "utf8");
  await writeFile(dstPath, content, "utf8");
  return { status: "installed", target };
}
