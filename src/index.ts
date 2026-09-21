import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSTALL_TARGETS,
  installOne,
  RETIRED_TARGETS,
  retireOne,
  type InstallTarget,
  type RetiredTarget,
} from "./installer.js";

/**
 * `routing-optimizer` opencode plugin entry.
 *
 * This plugin is a pure installer plus a safe retirer: on every opencode
 * startup it checks the user's `~/.config/opencode/{skills,command}/` for the
 * **two** assets shipped by this package and copies any that are missing or
 * whose embedded `<!-- routing-optimizer:version=… -->` marker is older than
 * the bundled version. It then removes previously-installed assets that this
 * package no longer ships, but **only** when the destination bytes exactly
 * match a known shipped revision (see `RETIRED_TARGETS`); user-modified files
 * are preserved and logged.
 *
 * No interactive side effects, no commands, no keybindings — `opencode`
 * still starts even when every install or retirement fails.
 */
const PLUGIN_VERSION = "0.3.0";

/**
 * Resolve the user's opencode config root, honoring `XDG_CONFIG_HOME` when
 * present and defaulting to `~/.config/opencode` on every platform.
 */
function resolveConfigRoot(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "opencode");
  }
  return join(homedir(), ".config", "opencode");
}

/**
 * Resolve the absolute path to this plugin's bundled assets, walking up
 * from `import.meta.url` to find `dist/assets/`. Works in both ESM and
 * Bun-bundled contexts.
 */
function resolveAssetsDir(): string {
  // dist/index.js → dist/ → ./
  const here = fileURLToPath(import.meta.url);
  return join(here, "..", "assets");
}

interface InstallReport {
  installed: InstallTarget[];
  skipped: { target: InstallTarget; reason: string }[];
  failed: { target: InstallTarget; error: string }[];
  retired: RetiredTarget[];
  preserved: { target: RetiredTarget; reason: string }[];
  retireErrors: { target: RetiredTarget; error: string }[];
}

/** The result of running retirement across every retired target. */
export interface RetireOutcome {
  retired: RetiredTarget[];
  preserved: { target: RetiredTarget; reason: string }[];
  errors: { target: RetiredTarget; error: string }[];
}

/** Install-count subset produced by {@link installAll}. */
type InstallCounts = Pick<InstallReport, "installed" | "skipped" | "failed">;

async function installAll(
  assetsDir: string,
  configRoot: string,
  client: Parameters<Plugin>[0]["client"],
): Promise<InstallCounts> {
  const report: InstallCounts = { installed: [], skipped: [], failed: [] };

  for (const target of INSTALL_TARGETS) {
    try {
      const result = await installOne(
        assetsDir,
        configRoot,
        target,
        PLUGIN_VERSION,
      );
      if (result.status === "installed") {
        report.installed.push(result.target);
        await log(client, "info", `installed ${target.dstRel}`);
      } else if (result.status === "skipped") {
        report.skipped.push({ target: result.target, reason: result.reason });
        await log(client, "debug", `skipped ${target.dstRel}: ${result.reason}`);
      } else {
        // missing-marker — a release-bug signal
        report.failed.push({
          target: result.target,
          error: `asset ${target.srcRel} is missing the routing-optimizer version marker`,
        });
        await log(
          client,
          "warn",
          `${target.srcRel} is missing the routing-optimizer version marker — refusing to install. Reinstall the plugin.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ target, error: message });
      // Don't throw — never break opencode startup because of an install failure.
      await log(client, "warn", `install failed for ${target.dstRel}: ${message}`);
    }
  }
  return report;
}

/**
 * Remove previously-shipped assets that this version no longer installs.
 *
 * Deletion happens **only** when the destination bytes fingerprint-match a
 * revision this plugin actually shipped ({@link RETIRED_TARGETS}); anything
 * else is left in place and reported. Never throws — a failed retirement is
 * logged and surfaced in the outcome so opencode startup is unaffected.
 */
export async function retireAll(
  configRoot: string,
  client: Parameters<Plugin>[0]["client"],
): Promise<RetireOutcome> {
  const outcome: RetireOutcome = { retired: [], preserved: [], errors: [] };
  for (const target of RETIRED_TARGETS) {
    try {
      const result = await retireOne(configRoot, target);
      if (result.status === "removed") {
        outcome.retired.push(target);
        await log(client, "info", `retired ${target.dstRel}`);
      } else if (result.status === "preserved") {
        outcome.preserved.push({ target, reason: result.reason });
        await log(
          client,
          "warn",
          `${target.dstRel} looks like our retired asset but was modified — leaving it in place. Remove it manually if unwanted.`,
        );
      } else if (result.status === "error") {
        // A read/permission failure is reported, never swallowed (§15).
        outcome.errors.push({ target, error: result.error });
        await log(client, "warn", `retire failed for ${target.dstRel}: ${result.error}`);
      }
      // "absent" is the steady state after the first successful retirement.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome.errors.push({ target, error: message });
      await log(client, "warn", `retire failed for ${target.dstRel}: ${message}`);
    }
  }
  return outcome;
}

/**
 * Install the current assets, then retire superseded ones. Exported so the
 * wiring (not just the individual units) can be exercised by integration
 * tests against a throwaway config root.
 */
export async function installAndRetire(
  assetsDir: string,
  configRoot: string,
  client: Parameters<Plugin>[0]["client"],
): Promise<InstallReport> {
  const counts = await installAll(assetsDir, configRoot, client);
  const outcome = await retireAll(configRoot, client);
  return {
    ...counts,
    retired: outcome.retired,
    preserved: outcome.preserved,
    retireErrors: outcome.errors,
  };
}

async function log(
  client: Parameters<Plugin>[0]["client"],
  level: "debug" | "info" | "warn" | "error",
  message: string,
): Promise<void> {
  try {
    await client.app.log({
      body: { service: "routing-optimizer", level, message },
    });
  } catch {
    // Logging must never throw out of the plugin.
  }
}

export const RoutingOptimizerPlugin: Plugin = async ({ client }) => {
  const assetsDir = resolveAssetsDir();
  const configRoot = resolveConfigRoot();

  let report: InstallReport;
  try {
    report = await installAndRetire(assetsDir, configRoot, client);
  } catch (err) {
    // installAll/retireAll already swallow per-target errors; this is a
    // defensive net for unexpected throwers (e.g. configRoot resolution races).
    const message = err instanceof Error ? err.message : String(err);
    await log(client, "error", `routing-optimizer installer crashed: ${message}`);
    return {};
  }

  const totalInstalled = report.installed.length;
  const totalSkipped = report.skipped.length;
  const totalFailed = report.failed.length;
  const totalRetired = report.retired.length;
  const totalPreserved = report.preserved.length;
  const totalRetireErrors = report.retireErrors.length;

  if (totalInstalled > 0) {
    const files = report.installed.map((t) => t.dstRel).join(", ");
    await log(
      client,
      "info",
      `routing-optimizer v${PLUGIN_VERSION} installed ${totalInstalled} asset(s) to ${configRoot}: ${files}`,
    );
  } else {
    await log(
      client,
      "debug",
      `routing-optimizer v${PLUGIN_VERSION} — ${totalSkipped} up to date, ${totalFailed} failed`,
    );
  }

  if (totalRetired > 0 || totalPreserved > 0 || totalRetireErrors > 0) {
    await log(
      client,
      "info",
      `routing-optimizer v${PLUGIN_VERSION} retirement: ${totalRetired} removed, ${totalPreserved} preserved (modified), ${totalRetireErrors} failed`,
    );
  }

  // The plugin's only behavior is installation. No hooks, no commands,
  // no tool registrations — return an empty hooks object so opencode still
  // starts cleanly.
  return {};
};

export default RoutingOptimizerPlugin;
