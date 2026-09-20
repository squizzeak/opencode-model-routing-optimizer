import type { Plugin } from "@opencode-ai/plugin";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INSTALL_TARGETS,
  installOne,
  type InstallTarget,
} from "./installer.js";

/**
 * `routing-optimizer` opencode plugin entry.
 *
 * This plugin is a pure installer: on every opencode startup it checks the
 * user's `~/.config/opencode/{skills,command}/` for the four assets shipped
 * by this package, and copies any that are missing or whose embedded
 * `<!-- routing-optimizer:version=… -->` marker is older than the bundled
 * version.
 *
 * No interactive side effects, no commands, no keybindings — `opencode`
 * still starts even when every install fails.
 */
const PLUGIN_VERSION = "0.2.4";

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
}

async function installAll(
  assetsDir: string,
  configRoot: string,
  client: Parameters<Plugin>[0]["client"],
): Promise<InstallReport> {
  const report: InstallReport = { installed: [], skipped: [], failed: [] };

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
    report = await installAll(assetsDir, configRoot, client);
  } catch (err) {
    // installAll already swallows per-target errors; this is a defensive
    // net for unexpected throwers (e.g. configRoot resolution races).
    const message = err instanceof Error ? err.message : String(err);
    await log(client, "error", `routing-optimizer installer crashed: ${message}`);
    return {};
  }

  const totalInstalled = report.installed.length;
  const totalSkipped = report.skipped.length;
  const totalFailed = report.failed.length;

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

  // The plugin's only behavior is installation. No hooks, no commands,
  // no tool registrations — return an empty hooks object so opencode still
  // starts cleanly.
  return {};
};

export default RoutingOptimizerPlugin;
