# AGENTS.md — opencode-model-routing-optimizer

Guidance for agents working on this repo. Read fully before editing.

## What this repo is

An opencode plugin that ships **two markdown files** and nothing else at
runtime — one skill and one slash command for intent-driven, cost/quota-aware
model optimization:

| Asset (under `assets/`)                  | Installs to                                          |
| ---------------------------------------- | ---------------------------------------------------- |
| `skills/optimize-micode-models/SKILL.md` | `~/.config/opencode/skills/optimize-micode-models/`  |
| `command/optimize-micode.md`             | `~/.config/opencode/command/`                        |

The TypeScript is a thin installer: on plugin load it copies the assets into
the user's config dir, overwriting only when the bundled version marker is
newer, then **retires** previously shipped assets — but only when a
destination file's bytes exactly match a known shipped revision. The
allowlist holds the sha256 of CRLF-normalized UTF-8 for every revision the
plugin ever shipped, enumerated across **all shipped source and built
revisions**. Anything that does not match is preserved and a warning is
logged; symlinked files (and paths under a symlinked parent) are preserved.
Only the retired skill's own now-empty directory is pruned — shared
`skills/`, `command/`, and the config root are never touched. No hooks, no
tools, no keybindings.

## Supersession

The old two-skill, all-axis Pareto product rules are **superseded** by the
user decision of 2026-09-20. History is preserved only for migration: the
retired assets `skills/design-fallback-chain/SKILL.md` and `command/design-fallback-chain.md` are named here once so their historical bytes can seed retirement fixtures, and the user-facing migration note lives in the README. Everything else in this document describes the single-skill, intent-driven product.

## Repo layout

```
src/index.ts        Plugin entry. Owns PLUGIN_VERSION.
src/installer.ts    Marker comparison + copy logic + hash-verified retirement.
scripts/build.ts    rm dist → tsc → cp -r assets dist/assets
assets/             The markdown source of truth (see table above).
dist/               BUILD OUTPUT — committed to git on purpose (see below).
test/               bun test suite.
test/fixtures/      Retired-asset historical fixtures (real shipped bytes,
                    including CRLF-normalization cases).
```

## The version-marker system (critical)

Three places must always move **together** in one commit:

1. `package.json` → `"version"`
2. `src/index.ts` → `const PLUGIN_VERSION`
3. Every shipped markdown file → `<!-- routing-optimizer:version=X.Y.Z -->`
   marker directly under the YAML frontmatter (2 files: 1 SKILL.md + 1
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

All four values must match.

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
- Keep `package.json`, `src/index.ts`, and both asset markers at the tag's
  version **before** tagging.

## Non-negotiable design rules for the skill

These are product decisions, not style. Do not regress them.

1. **One skill, fully dynamic — hardcode nothing.** The skill must never
   contain provider lists, model IDs, alias tables, price tables, or
   benchmark rankings. Providers are discovered at run time from three live
   sources: `~/.config/opencode/opencode.json`,
   `~/.local/share/opencode/auth.json`, and the `opencode models` session
   catalog. Quota telemetry via the optional `@slkiser/opencode-quota`
   plugin/CLI is a grading-only source — it never contributes providers.
   Model validity is judged **only** by the live catalog (models.dev/docs are
   research, not truth; catalogs differ by auth mode).
2. **Live rechecks every run.** Pricing, quota mechanics, benchmark claims,
   TTFT/TPS, and plan/overage terms must be re-fetched from current sources
   on every invocation, with provenance recorded (verified-live vs.
   user-asserted vs. unknown). Stale numbers from memory or prior sessions
   are bugs.
3. **Consent-gated changes.** The skill offers prerequisite installs (plugin
   stanza edits, credential registration) by showing the exact edit and
   waiting for explicit confirmation. Plugin entries are always added as
   `@latest` — never pinned versions. No silent config mutations, ever.
4. **Delegation hard gate.** `optimize-micode-models` disqualifies any lead
   candidate without positive evidence it invokes subagents under the
   orchestration prompt, regardless of wins on other axes. Keep this gate.
5. **Scope.** The skill touches only `model` fields in
   `~/.config/opencode/micode.json` — never
   prompt/temperature/permissions, and never router/fallback config. The old
   cross-skill scope separation is gone: there is one skill and one scope.
6. **Skill ↔ command sync.** The command `.md` is the user-facing wrapper of
   its `SKILL.md`. When you change behavior in one, mirror it in the
   other — intake rules, gates, validation canaries, output tables.
7. **Validation canary.** The skill treats zero `Model not available`
   warnings from the config loader as the acceptance test for any model
   reference it writes, and it inspects the command's exit status as well as
   its warnings — a CLI failure is never labeled success just because grep
   matched nothing. Preserve that check.
8. **Intent-driven priorities + expertise — no all-axis dominance.** Rank
   candidates per agent by the user's stated priorities in order
   (lexicographic only for explicitly ordered priorities; otherwise disclose
   equal importance), with domain-expertise evidence and each agent's actual
   responsibilities establishing suitability **before** ranking. Propose a
   swap whenever the pick beats the current assignment on the requested
   goals; keep when the current assignment is already the top pick. Do **not**
   require dominance on every axis, and do not bias toward free options.
9. **Billing nature is derived, never asked.** Determine a route's billing
   nature from fresh web research for the exact route/plan/auth mode,
   corroborated by quota telemetry. Never ask the user to classify billing or
   name their plan, and never infer free/available from a zero or missing
   price, or from absent credentials. Unknown stays unknown and must be
   reported as unknown — never asserted positive or `$0`.
10. **Eligibility modes classify routes/plans, not providers.** Modes are
    `unrestricted` (no billing filter), `avoid-paygo`, `paygo-only`, and
    `free-only`. `avoid-paygo` also excludes metered overage; `free-only`
    excludes paid subscriptions even when marginal request cost is zero.
    Classify routes/plans, never whole providers. A route whose
    classification is unknown is **excluded** from the three constrained
    modes (its qualification cannot be asserted). `unrestricted` removes
    billing restrictions, not capacity or competence requirements.
11. **Quota-pool spreading is static assignment, not runtime fallback.** When
    two routes are materially equivalent on every requested priority, prefer
    assigning them to different agents so load is spread across demonstrably
    independent quota pools — never at the expense of a stated priority.
    This is static `micode.json` assignment and must **not** be described as
    runtime smooth fallback: a quota-exhausted provider does not fail over at
    runtime.
12. **Fresh positive capacity required.** Independently require fresh
    positive remaining capacity or documented usable account entitlement
    before recommending a new assignment in **any** billing mode. Exclude
    exhausted routes and inspect all binding windows. Unknown/stale capacity
    cannot silently pass. Catalog presence and API keys do not establish
    usable funds, and public web pages cannot establish private balances.
    Offer supported telemetry refresh/setup with consent.
13. **Retirement only on exact content-hash match.** The installer removes a
    previously shipped asset only when the destination file's bytes exactly
    match a known shipped revision (sha256 of CRLF-normalized UTF-8,
    allowlisted across all shipped source **and** built revisions).
    Everything else — modified content, symlinks, paths under a symlinked
    parent — is preserved with a warning. Prune only the retired skill's own
    empty directory. Hashing alone never proves ownership: recheck
    identity/content immediately before removal, treat only `ENOENT` as
    absent, and report permission/read failures instead of swallowing them.

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
- When changing retirement behavior, add or refresh the historical fixtures
  under `test/fixtures/` and keep them byte-exact.

## Local verification loop

```sh
bun run build
# copy into a live config for manual testing:
cp -r dist/assets/skills/* ~/.config/opencode/skills/
cp    dist/assets/command/*.md ~/.config/opencode/command/
```

Restart opencode, then confirm the installed files carry the new marker and
the slash command appears. `grep routing-optimizer
~/.local/share/opencode/log/*.log` shows installer activity, including
`retired <path>` lines for hash-matched retired assets and warnings for
preserved (modified or symlinked) ones.
