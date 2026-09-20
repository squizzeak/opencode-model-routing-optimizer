# AGENTS.md — opencode-model-routing-optimizer

Guidance for agents working on this repo. Read fully before editing.

## What this repo is

An opencode plugin that ships **four markdown files** and nothing else at
runtime — two skills and two slash commands for cost/quota-aware model
routing:

| Asset (under `assets/`)                              | Installs to                                              |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `skills/optimize-micode-models/SKILL.md`             | `~/.config/opencode/skills/optimize-micode-models/`      |
| `skills/design-fallback-chain/SKILL.md`              | `~/.config/opencode/skills/design-fallback-chain/`       |
| `command/optimize-micode.md`                         | `~/.config/opencode/command/`                            |
| `command/design-fallback-chain.md`                   | `~/.config/opencode/command/`                            |

The TypeScript is a thin installer: on plugin load it copies the assets into
the user's config dir, overwriting only when the bundled version marker is
newer. No hooks, no tools, no keybindings.

## Repo layout

```
src/index.ts        Plugin entry. Owns PLUGIN_VERSION.
src/installer.ts    Marker comparison + copy logic.
scripts/build.ts    rm dist → tsc → cp -r assets dist/assets
assets/             The markdown source of truth (see table above).
dist/               BUILD OUTPUT — committed to git on purpose (see below).
tests/              bun test suite.
```

## The version-marker system (critical)

Three places must always move **together** in one commit:

1. `package.json` → `"version"`
2. `src/index.ts` → `const PLUGIN_VERSION`
3. Every shipped markdown file → `<!-- routing-optimizer:version=X.Y.Z -->`
   marker directly under the YAML frontmatter (4 files: 2 SKILL.md + 2
   command .md)

The installer compares destination marker vs. bundled marker and copies when
the bundled one is newer. If you bump `package.json` but forget a marker,
that file silently won't update for users. If you edit skill text without
bumping anything, existing users never receive the edit. **Any content change
to a shipped markdown file requires a version bump.**

Verify after edits:

```sh
grep -rn "routing-optimizer:version" assets/ && grep -n "PLUGIN_VERSION" src/index.ts && grep '"version"' package.json
```

All six values must match.

## Build, test, publish

```sh
bun install
bun run typecheck   # tsc --noEmit
bun run test        # bun test
bun run build       # cleans dist/, tsc, copies assets/
```

- **`dist/` is committed.** Path-B installs (`github:owner/repo` in the
  plugin array) load the built output directly with no build step, so `dist/`
  in the repo must always reflect the current `assets/` + `src/`. Run
  `bun run build` and commit the result whenever you change either.
- **Publishing is tag-driven**: push `vX.Y.Z` → GitHub Actions
  (`publish.yml`) builds, tests, and publishes to npm via OIDC trusted
  publishing with provenance. Never `npm publish` locally except the one-time
  name-claim described in the README.
- Keep `package.json`, `src/index.ts`, and all four markers at the tag's
  version **before** tagging.

## Non-negotiable design rules for the skills

These are product decisions, not style. Do not regress them.

1. **Fully dynamic — hardcode nothing.** The skills must never contain
   provider lists, model IDs, alias tables, price tables, or benchmark
   rankings. Providers are discovered at run time from three live sources:
   `~/.config/opencode/opencode.json`, `~/.local/share/opencode/auth.json`,
   and the `opencode models` session catalog. Model validity is judged
   **only** by the live catalog (models.dev/docs are research, not truth;
   catalogs differ by auth mode).
2. **Live rechecks every run.** Pricing, quota mechanics, and benchmark
   claims must be re-fetched from current sources on every invocation, with
   provenance recorded (verified-live vs. user-asserted). Stale numbers from
   memory or prior sessions are bugs.
3. **Consent-gated changes.** Skills offer prerequisite installs (plugin
   stanza edits, credential registration) by showing the exact edit and
   waiting for explicit confirmation. Plugin entries are always added as
   `@latest` — never pinned versions. No silent config mutations, ever.
4. **Delegation hard gate.** `optimize-micode-models` disqualifies any lead
   candidate without positive evidence it invokes subagents under the
   orchestration prompt, regardless of wins on other axes. Keep this gate.
5. **Scope separation.** The Pareto skill touches only `micode.json` model
   fields; the routing skill touches only
   `opencode-model-router.overrides.jsonc`. Neither crosses over.
6. **Skill ↔ command sync.** Each command `.md` is the user-facing wrapper
   of its `SKILL.md`. When you change behavior in one, mirror it in the
   other — resolution rules, gates, validation canaries, output tables.
7. **Validation canary.** Both skills treat zero `Model not available`
   warnings from the config loader as the acceptance test for any model
   reference they write. Preserve that check.

## Editing conventions

- Markdown files use `---` YAML frontmatter + the version marker + body.
  Keep the marker format exact — the installer regex depends on it.
- In prose, refer to providers/models as placeholders
  (`<cheap-provider>`, `<fast-model>`); real names only in clearly-marked
  illustrative examples, and even then prefer slots.
- Indentation inside the markdown files is spaces; YAML frontmatter keys are
  case-sensitive (`name`, `description`, `agent`).
- When adding a new shipped asset: add it under `assets/`, give it a marker,
  register it in `src/installer.ts`'s asset list, and extend this table in
  the README/AGENTS docs.

## Local verification loop

```sh
bun run build
# copy into a live config for manual testing:
cp -r dist/assets/skills/* ~/.config/opencode/skills/
cp    dist/assets/command/*.md ~/.config/opencode/command/
```

Restart opencode, then confirm the installed files carry the new marker and
the slash commands appear. `grep routing-optimizer
~/.local/share/opencode/log/*.log` shows installer activity.
