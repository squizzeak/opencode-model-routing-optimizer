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
 * The four assets shipped by this plugin. Keep in sync with `assets/` and the
 * npm package's `files: ["dist", ...]` field.
 */
export declare const INSTALL_TARGETS: ReadonlyArray<InstallTarget>;
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
 * Semver string comparison is intentionally simple: we use the `>` operator
 * on the version strings. Both versions are expected to follow semver; the
 * fallback (string) comparison handles `0.1.0` < `0.1.2` correctly because
 * numeric components compare longer-than-alpha via string compare of zero-
 * padded values, and identical-length strings like `0.1.0` vs `0.1.20`
 * would otherwise compare wrong. We mitigate that by falling back to
 * `compareSemver` — see the implementation.
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
