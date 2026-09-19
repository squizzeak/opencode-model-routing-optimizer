# opencode-model-routing-optimizer

OpenCode plugin that installs two complementary skills and their slash commands
for cost- and quota-aware model routing:

| Slash command              | Skill                          | What it does                                                                                         |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `/optimize-micode`         | `optimize-micode-models`       | Audit and Pareto-optimize `model` assignments in `~/.config/opencode/micode.json` across all configured providers. |
| `/design-fallback-chain`   | `design-fallback-chain`        | Design subscription-aware tier routing (presets + fallback chains) for [`opencode-model-router`](https://github.com/marco-jardim/opencode-model-router). |

The plugin installs both assets into your opencode config directory on
startup; nothing else runs. No hooks, no commands, no keybindings.

## Why

Most users pick their `micode.json` once and never revisit it. But pricing,
quality, and quota caps shift every time a provider rotates a model. The
two skills cover that gap end-to-end:

- **`/optimize-micode`** handles **static per-agent assignment** — which
  `(provider, model)` tuple each opencode agent uses at startup.
- **`/design-fallback-chain`** handles **dynamic per-task routing** — a
  preset the `opencode-model-router` plugin selects from at runtime by
  task tier (`@fast`/`@medium`/`@heavy`).

The two are siblings. The Pareto skill does **not** touch routing config;
the routing skill does **not** touch `micode.json`. Together they keep
the lead cheap, the heavy work on a heavy subscription, and fall back
gracefully on quota exhaustion.

## Installation

This plugin ships via **npm** as a standard opencode plugin package and
is listed in the opencode ecosystem page.

### Path 1 — npm (recommended)

```sh
bun add -g opencode-model-routing-optimizer
```

Then add it to your opencode config (`~/.config/opencode/opencode.json`):

```jsonc
{
  "plugin": [
    ...,
    "opencode-model-routing-optimizer"
  ]
}
```

Restart opencode. The four files (`SKILL.md`s and `.md` commands) get
copied into `~/.config/opencode/skills/` and `~/.config/opencode/command/`
on first load — and re-copied automatically on every plugin upgrade.

### Path 2 — local checkout (for development / self-hosted)

```sh
git clone https://github.com/squizzeak/opencode-model-routing-optimizer
cd opencode-model-routing-optimizer
bun install
bun run build
```

Then point opencode at the local build (in `~/.config/opencode/opencode.json`):

```jsonc
{
  "plugin": [
    ...,
    "/absolute/path/to/opencode-model-routing-optimizer/dist/index.js"
  ]
}
```

Restart opencode. The local `dist/index.js` is loaded directly, so any
edit to `src/` followed by `bun run build` takes effect on next startup.

### Path 3 — GitHub release artifact

If you don't want to add npm to your environment, install straight from
the GitHub release tarball that `bun` understands natively:

```jsonc
{
  "plugin": [
    ...,
    "github:squizzeak/opencode-model-routing-optimizer#v0.1.0"
  ]
}
```

## Verifying the install

After restarting opencode you should see two new slash commands available:

- `/optimize-micode`
- `/design-fallback-chain`

…plus two new skills in your skill inventory:

- `optimize-micode-models`
- `design-fallback-chain`

The plugin logs to `client.app.log` under the `routing-optimizer` service.
Look in `~/.local/share/opencode/log/` if anything looks wrong:

```sh
grep routing-optimizer ~/.local/share/opencode/log/*.log
```

### Confirm what got installed

```sh
ls ~/.config/opencode/skills/optimize-micode-models/SKILL.md \
   ~/.config/opencode/skills/design-fallback-chain/SKILL.md \
   ~/.config/opencode/command/optimize-micode.md \
   ~/.config/opencode/command/design-fallback-chain.md
```

Each file should contain a line near the top:

```html
<!-- routing-optimizer:version=0.1.0 -->
```

That marker is what tells the plugin whether to overwrite on upgrade.

## Uninstallation

Remove the plugin entry from `~/.config/opencode/opencode.json`, restart
opencode, then optionally delete the assets it installed:

```sh
rm -rf ~/.config/opencode/skills/optimize-micode-models
rm -rf ~/.config/opencode/skills/design-fallback-chain
rm    ~/.config/opencode/command/optimize-micode.md
rm    ~/.config/opencode/command/design-fallback-chain.md
```

## How the two skills differ

**`optimize-micode-models`** (static, per-agent, every start)

- Operates on `~/.config/opencode/micode.json`.
- Computes Pareto dominance across every candidate `(provider, model)`
  tuple and swaps strictly-dominated assignments.
- Defaults to a two-tier constraint: speed-where-interactive,
  cost-where-unattended, all configured providers in scope.
- Refuses to silently substitute off opencode-go — every swap table row
  shows the provider change.

**`design-fallback-chain`** (dynamic, per-task, runtime routing)

- Operates on `~/.config/opencode/opencode-model-router.overrides.jsonc`.
- Composes a `presets.<name>` block + a `fallback.global` chain, with the
  `sub-<cheap>-<heavy>` shape as the default. Friendly provider aliases
  (`claude` → `anthropic`, `codex` → `openai`, `copilot` →
  `github-copilot`, etc.) resolve against the user's configured
  providers.
- Defaults to the cheapest bundled subscription as the `@fast` tier and
  the largest subscription as `@heavy`.
- Refuses — does not silently substitute — when a requested provider
  isn't in `opencode.json`. Surfaces the missing-credential recipe.

Both skills publish their full output (validation, swap/reasoning
tables, restart reminders) in the command's render and never apply
changes silently.

## Versioning & upgrades

The plugin version is the npm package version (`package.json` `"version"`).
Every shipped markdown file has a matching `<!-- routing-optimizer:version=X.Y.Z -->`
marker right under the YAML frontmatter. On plugin load, the installer
compares the destination marker against the source marker and copies
whenever the source is newer (or the destination is missing).

To force a reinstall, delete the destination file; the next plugin load
sees a missing destination and re-copies from the bundle.

## Marketplace / discoverability

This package is published to npm with the canonical opencode plugin
metadata:

- `name`: `opencode-model-routing-optimizer` (unscoped, matches the
  ecosystem convention `opencode-<thing>`)
- `keywords`: `opencode`, `opencode-plugin`, plus routing-specific terms
- `peerDependencies`: `@opencode-ai/plugin` (TypeScript types)
- `repository`, `bugs`, `homepage` pointing at this github repo

It is listed in the [opencode ecosystem page](https://opencode.ai/docs/ecosystem#plugins)
alongside the other community plugins. To suggest additions or removals,
open an issue or PR on the [opencode repo](https://github.com/anomalyco/opencode/edit/dev/packages/web/src/content/docs/ecosystem.mdx)
(`packages/web/src/content/docs/ecosystem.mdx`).

## Development

```sh
bun install              # install dev deps
bun run typecheck        # tsc --noEmit
bun run test             # bun test
bun run build            # cleans dist/, runs tsc, copies assets/
```

The build script (`scripts/build.ts`) is just `rm dist` → `tsc` → `cp -r assets dist/assets`.
The result of `bun run build` is the publishable artifact.

### Publishing

The repo includes a GitHub Actions workflow (`.github/workflows/publish.yml`)
that publishes to npm via OIDC trusted publishing on every tagged release.
For first-time setup:

1. Create the npm package: `npm publish --access public` (or trigger a
   tagged release once OIDC is configured).
2. In npm settings, add a Trusted Publisher that points to this GitHub
   repo + the `release.yml` workflow file. Subsequent releases publish
   without managing tokens.

Manual local publish:

```sh
npm login                # one-time
npm run build
npm publish --access public
```

## License

MIT — see [LICENSE](./LICENSE).
