import type { Plugin } from "@opencode-ai/plugin";
import { type InstallTarget, type RetiredTarget } from "./installer.js";
interface InstallReport {
    installed: InstallTarget[];
    skipped: {
        target: InstallTarget;
        reason: string;
    }[];
    failed: {
        target: InstallTarget;
        error: string;
    }[];
    retired: RetiredTarget[];
    preserved: {
        target: RetiredTarget;
        reason: string;
    }[];
    retireErrors: {
        target: RetiredTarget;
        error: string;
    }[];
}
/** The result of running retirement across every retired target. */
export interface RetireOutcome {
    retired: RetiredTarget[];
    preserved: {
        target: RetiredTarget;
        reason: string;
    }[];
    errors: {
        target: RetiredTarget;
        error: string;
    }[];
}
/**
 * Remove previously-shipped assets that this version no longer installs.
 *
 * Deletion happens **only** when the destination bytes fingerprint-match a
 * revision this plugin actually shipped ({@link RETIRED_TARGETS}); anything
 * else is left in place and reported. Never throws — a failed retirement is
 * logged and surfaced in the outcome so opencode startup is unaffected.
 */
export declare function retireAll(configRoot: string, client: Parameters<Plugin>[0]["client"]): Promise<RetireOutcome>;
/**
 * Install the current assets, then retire superseded ones. Exported so the
 * wiring (not just the individual units) can be exercised by integration
 * tests against a throwaway config root.
 */
export declare function installAndRetire(assetsDir: string, configRoot: string, client: Parameters<Plugin>[0]["client"]): Promise<InstallReport>;
export declare const RoutingOptimizerPlugin: Plugin;
export default RoutingOptimizerPlugin;
