/**
 * Marker prefix used to version-tag each asset shipped by this plugin.
 * Format inside a shipped markdown file:
 *   <!-- routing-optimizer:version=0.1.2 -->
 * The installer extracts the `<version=` substring to decide whether the
 * destination file is stale.
 */
export declare const VERSION_MARKER_PREFIX = "routing-optimizer:version=";
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
export declare const INSTALL_TARGETS: ReadonlyArray<InstallTarget>;
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
export declare const RETIRED_ASSET_HASHES: Readonly<Record<string, readonly string[]>>;
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
export declare const RETIRED_TARGETS: ReadonlyArray<RetiredTarget>;
/** sha256 of CRLF-normalized UTF-8 bytes — the fingerprint used for ownership. */
export declare function sha256Hex(buf: Buffer): string;
export type RetireResult = {
    status: "absent";
    target: RetiredTarget;
} | {
    status: "removed";
    target: RetiredTarget;
} | {
    status: "preserved";
    target: RetiredTarget;
    reason: string;
} | {
    status: "error";
    target: RetiredTarget;
    error: string;
};
/**
 * Remove a retired asset only when its bytes are provably identical to a known
 * shipped revision. Never deletes user-modified content. Preserves symlinks and
 * paths with symlinked parents, rechecks identity immediately before removal,
 * and prunes only the retired asset's own empty directory.
 */
export declare function retireOne(absConfigRoot: string, target: RetiredTarget): Promise<RetireResult>;
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
export declare function readVersion(filePath: string): Promise<string | undefined>;
/**
 * Returns true if a destination file is missing OR its version marker is
 * older than the source's. Pure logic — does not touch the filesystem.
 *
 * Ordering is delegated to {@link compareSemver}: components are compared
 * numerically (so `0.1.9` < `0.1.10`, unlike a lexicographic string compare)
 * and a leading `v` is tolerated. Unparseable inputs fall back to a plain
 * string comparison inside `compareSemver`.
 */
export declare function needsInstall(srcVersion: string | undefined, dstVersion: string | undefined): boolean;
/**
 * Compare two semver-like version strings numerically. Returns -1, 0, or 1
 * following the standard `<`, `=`, `>` ordering. Tolerates a leading `v`.
 * Falls back to string compare if either input is not parseable.
 */
export declare function compareSemver(a: string, b: string): -1 | 0 | 1;
/**
 * Idempotently install a single file. Creates parent directories as needed.
 * No-op (and returns `installed: false`) when the destination is up to date.
 */
export declare function installOne(absPluginAssetsDir: string, absConfigRoot: string, target: InstallTarget, pluginVersion: string): Promise<{
    status: "installed";
    target: InstallTarget;
} | {
    status: "skipped";
    target: InstallTarget;
    reason: string;
} | {
    status: "missing-marker";
    target: InstallTarget;
}>;
