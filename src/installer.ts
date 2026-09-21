import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  access,
  open,
  lstat,
  rmdir,
  unlink,
  constants,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Marker prefix used to version-tag each asset shipped by this plugin.
 * Format inside a shipped markdown file:
 *   <!-- routing-optimizer:version=0.1.2 -->
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
 * The two assets shipped by this plugin. Keep in sync with `assets/` and the
 * npm package's `files: ["dist", ...]` field.
 */
export const INSTALL_TARGETS: ReadonlyArray<InstallTarget> = [
  {
    srcRel: "skills/optimize-micode-models/SKILL.md",
    dstRel: "skills/optimize-micode-models/SKILL.md",
  },
  {
    srcRel: "command/optimize-micode.md",
    dstRel: "command/optimize-micode.md",
  },
];

/**
 * Content fingerprints of every byte this plugin ever shipped for now-retired
 * asset paths. Each value is the sha256 hex of the file's CRLF-normalized
 * UTF-8 bytes — the fingerprint of every byte this plugin ever shipped for the
 * path (source + built assets, across all refs). A destination file is deleted
 * ONLY when its fingerprint is in this set; marker presence alone is NOT
 * ownership proof (a user can edit the body while leaving the marker intact).
 *
 * These hashes were recomputed from BOTH `assets/...` and `dist/assets/...`
 * history across all refs; the union equals this list because dist content is a
 * subset of source content.
 */
export const RETIRED_ASSET_HASHES: Readonly<Record<string, readonly string[]>> = {
  "skills/design-fallback-chain/SKILL.md": [
    "2480b4c0f1433e45fbe6367135654359f2bfcf6ab2991386ef6a94dd96b1f96d",
    "43da608007bd6b76108a2e683399574796f2a6e431f67137b4eb77bbe8c93e37",
    "44b931b40f5c204e406f3ca31fd636d9bde923c247142211ca378ee8eac6ef3f",
    "6577caf8742f45e07bccbdacf805271665b37647ee83f934e1009cbe1fad2a8a",
    "6ff68c9ba11a0bee3b539b4a49940c6871092538a8c5dcb030187f79bce38454",
    "8ef1383b7632f45a13176386fa5bc52c6a1c245975890fb05456590aeb8f0570",
    "94d532ced761cbc74acd1f9e52efc363a9a58a431691f44866e297b8457e716d",
    "a5303c4714881bc10555565d160f63cb4434353876ecd0158babaa1f66d47b00",
    "b95a55bd9104cf8556dff2adcb8584d51bb31282e11c37a0b00a9b1a5c9146a6",
    "e2583d649e757a214323f961ddaae937f138bcbcc3b46ddd0c19d73dd8cc7453",
    "e3d1e89f8c80a95562c9d11a2d0e75fd9fe3b37e66e88a5f16606c7fc1ea5c42",
    "e47754b8f29726ee632446144d104f104aa5c8c62bdbb892acb4e50ea9689e9d",
  ],
  "command/design-fallback-chain.md": [
    "075fdcf93457e1025ccf420338d2d29eb8755a6274677ea2285c464e13ddae11",
    "10487adff4d4b48750ebdb3bc6362063884bb83bae2bc8b29ea77f6f119b2cc4",
    "466733b24fc165dd29bf434b1f9410e7e94b1922740292ee2082d03f246c3820",
    "4b6c998f0d68dad1ddcd12a96c83eae67a19caa739eaa1989735bae5ce721c91",
    "4d061b814b1584281fe1b4044982abd2f473979402435e2f53ea364a4a7e9c81",
    "61d3498149d4949ea38a7926db378154a154ad0e7927b8676ae6b633a9b5ec6b",
    "69e012722b4feb438a9bebbf4ecc106dae7d6ebc2a41693cee692693a5f19add",
    "8ff3ac2893113911ba737e934a0281c9b45e7435a79711c1b6a75127f131d504",
    "9fe632a06bf6d75593adb7da929df2f4046deba4e129f4704ead143aff5d5ad6",
    "d3f1418ba6da6614970b1a916ea77e9c6b3b7a717dfc6662e96a377bb352f57c",
    "dc02c9829d62430911e1dd6d3961fef6d286157dc22f30f643588a5af3049df5",
  ],
};

/**
 * A retired asset whose already-installed copies should be removed on upgrade.
 */
export interface RetiredTarget {
  /** Destination path relative to the user's opencode config root. */
  dstRel: string;
  /** sha256 (CRLF-normalized) of every revision this plugin ever shipped. */
  knownHashes: readonly string[];
  /**
   * When set, the now-empty directory to prune after a successful removal.
   * Only ever the retired asset's own directory — never a shared `skills/`,
   * `command/`, or the config root.
   */
  pruneDirRel?: string;
}

/**
 * Retired targets derived from {@link RETIRED_ASSET_HASHES}. The SKILL entry
 * owns its own directory and may prune it; the command entry never prunes
 * because `command/` is shared.
 */
export const RETIRED_TARGETS: ReadonlyArray<RetiredTarget> = Object.entries(
  RETIRED_ASSET_HASHES,
).map(([dstRel, knownHashes]): RetiredTarget => {
  if (dstRel === "skills/design-fallback-chain/SKILL.md") {
    return { dstRel, knownHashes, pruneDirRel: "skills/design-fallback-chain" };
  }
  return { dstRel, knownHashes };
});

/**
 * The only directories this module is ever permitted to prune. Hard-coded so a
 * malformed target can never remove a shared directory or the config root.
 */
const PRUNE_ALLOWLIST: ReadonlySet<string> = new Set([
  "skills/design-fallback-chain",
]);

/** sha256 of CRLF-normalized UTF-8 bytes — the fingerprint used for ownership. */
export function sha256Hex(buf: Buffer): string {
  const normalized = Buffer.from(
    buf.toString("utf8").replace(/\r\n/g, "\n"),
    "utf8",
  );
  return createHash("sha256").update(normalized).digest("hex");
}

export type RetireResult =
  | { status: "absent"; target: RetiredTarget }
  | { status: "removed"; target: RetiredTarget }
  | { status: "preserved"; target: RetiredTarget; reason: string }
  | { status: "error"; target: RetiredTarget; error: string };

/** Errno code of a thrown value, if any. */
function errnoOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

/** Human-readable message of a thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Remove a retired asset only when its bytes are provably identical to a known
 * shipped revision. Never deletes user-modified content. Preserves symlinks and
 * paths with symlinked parents, rechecks identity immediately before removal,
 * and prunes only the retired asset's own empty directory.
 */
export async function retireOne(
  absConfigRoot: string,
  target: RetiredTarget,
): Promise<RetireResult> {
  const dstPath = join(absConfigRoot, target.dstRel);

  // (a) Symlinked-parent guard: walk each accumulated component of the
  // destination's parent path beneath the config root. A symlinked component
  // means the "destination" may actually live outside the config tree, so we
  // preserve it without following the link. A missing component ends the walk
  // (nothing exists yet => the destination is absent).
  const parentRel = dirname(target.dstRel);
  if (parentRel !== "." && parentRel !== "") {
    const components = parentRel.split("/").filter((c) => c.length > 0);
    let prefix = absConfigRoot;
    for (const component of components) {
      prefix = join(prefix, component);
      let parentStat;
      try {
        parentStat = await lstat(prefix);
      } catch (err) {
        if (errnoOf(err) === "ENOENT") break;
        return { status: "error", target, error: errorMessage(err) };
      }
      if (parentStat.isSymbolicLink()) {
        return {
          status: "preserved",
          target,
          reason: "path has a symlinked parent",
        };
      }
    }
  }

  // (b) Inspect the destination itself without following symlinks.
  let initialStat;
  try {
    initialStat = await lstat(dstPath);
  } catch (err) {
    if (errnoOf(err) === "ENOENT") return { status: "absent", target };
    return { status: "error", target, error: errorMessage(err) };
  }
  if (initialStat.isSymbolicLink()) {
    return { status: "preserved", target, reason: "is a symbolic link" };
  }
  if (initialStat.isDirectory()) {
    // A directory here is an anomalous destination (reading it would fail with
    // EISDIR); report it rather than silently treating it as content.
    return { status: "error", target, error: "destination is a directory" };
  }
  if (!initialStat.isFile()) {
    return { status: "preserved", target, reason: "not a regular file" };
  }

  // (c) Read and fingerprint. Any read failure is reported, not swallowed.
  let buf: Buffer;
  try {
    buf = await readFile(dstPath);
  } catch (err) {
    return { status: "error", target, error: errorMessage(err) };
  }
  const hash = sha256Hex(buf);
  if (!target.knownHashes.includes(hash)) {
    return {
      status: "preserved",
      target,
      reason:
        "content differs from every shipped revision — left untouched (may be user-edited)",
    };
  }

  // (d) Re-check identity and content immediately before removal. Requiring the
  // same inode, size, and mtime, plus an identical allowlisted hash, narrows
  // (but does not eliminate) concurrent-modification races between the check
  // and the unlink.
  let recheckStat;
  try {
    recheckStat = await lstat(dstPath);
  } catch (err) {
    if (errnoOf(err) === "ENOENT") return { status: "absent", target };
    return { status: "error", target, error: errorMessage(err) };
  }
  if (
    recheckStat.isSymbolicLink() ||
    !recheckStat.isFile() ||
    recheckStat.ino !== initialStat.ino ||
    recheckStat.size !== initialStat.size ||
    recheckStat.mtimeMs !== initialStat.mtimeMs
  ) {
    return { status: "preserved", target, reason: "content changed during check" };
  }
  let recheckBuf: Buffer;
  try {
    recheckBuf = await readFile(dstPath);
  } catch (err) {
    return { status: "error", target, error: errorMessage(err) };
  }
  const recheckHash = sha256Hex(recheckBuf);
  if (recheckHash !== hash || !target.knownHashes.includes(recheckHash)) {
    return { status: "preserved", target, reason: "content changed during check" };
  }

  // (e) Remove the file.
  try {
    await unlink(dstPath);
  } catch (err) {
    if (errnoOf(err) === "ENOENT") return { status: "absent", target };
    return { status: "error", target, error: errorMessage(err) };
  }

  // (f) Prune the retired asset's own now-empty directory. The allowlist and
  // the dirname match together guarantee we never rmdir `skills/`, `command/`,
  // or the config root. Prune failures are non-fatal — the file is already
  // removed — but we never fall back to a broader destructive operation.
  if (
    target.pruneDirRel &&
    target.pruneDirRel === dirname(target.dstRel) &&
    PRUNE_ALLOWLIST.has(target.pruneDirRel)
  ) {
    const prunePath = join(absConfigRoot, target.pruneDirRel);
    try {
      const pruneStat = await lstat(prunePath);
      if (!pruneStat.isSymbolicLink() && pruneStat.isDirectory()) {
        try {
          await rmdir(prunePath);
        } catch (err) {
          // ENOTEMPTY: the directory still holds user content (e.g. other
          // skills) — expected and intentionally non-fatal.
          // ENOENT: already gone.
          // Anything else: file removal already succeeded; do not fail.
          void errnoOf(err);
        }
      }
    } catch (err) {
      // lstat failure (including ENOENT): nothing to prune; non-fatal.
      void errnoOf(err);
    }
  }

  return { status: "removed", target };
}

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
 *     <!-- routing-optimizer:version=0.1.2 -->
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
 * Ordering is delegated to {@link compareSemver}: components are compared
 * numerically (so `0.1.9` < `0.1.10`, unlike a lexicographic string compare)
 * and a leading `v` is tolerated. Unparseable inputs fall back to a plain
 * string comparison inside `compareSemver`.
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
