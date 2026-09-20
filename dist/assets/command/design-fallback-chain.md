---
description: Design a subscription-aware opencode-model-router preset + fallback chain. Fully dynamic — resolves providers and models from your live opencode config, auth store, and model catalog; hardcodes none. Usage: /design-fallback-chain <cheap> <heavy> | sub-<provider> | max-throughput | min-cost | custom
agent: commander
---

<!-- routing-optimizer:version=0.2.2 -->

Design a complete `opencode-model-router` override layer for the user's subscription mix. **Fully provider- and model-agnostic**: this command contains no alias table, no preferred provider, and no model IDs. Every provider token resolves against the user's live configuration; every model ID comes from the live `opencode models` catalog; every price or quality claim is rechecked against live sources at run time. `<cheap-provider>` and `<heavy-provider>` below are slots — the resolved canonical keys from the user's own setup.

## Prerequisite flow — check and offer, never silently refuse

1. **`opencode-model-router` installed**: it must appear in the `plugin` array of `~/.config/opencode/opencode.json` (normalize entries: strip npm scope and any `@version` suffix).
   - If missing, show the exact edit and ask via `confirm`:
     > Add `"opencode-model-router@latest"` to the `plugin` array in `~/.config/opencode/opencode.json`?
   - Always install plugins as `@latest` (or bare name). Never pin a version.
    - On yes: apply the edit, continue designing, and note that one restart activates both the plugin and the new overrides.
    - On no: stop — the overrides file is inert without the plugin.
2. **Live quota telemetry (recommended)**: check for `opencode-quota` and run `opencode-quota show --json` when available. If missing, offer via `confirm` to add `"@slkiser/opencode-quota@latest"` to the `plugin` array (companion auth plugins listed **before** it) — the plugin collects quota snapshots while opencode runs; an optional `npm install -g @slkiser/opencode-quota@latest` (Node ≥ 22) adds the terminal CLI, and `opencode-quota init` (interactive TUI setup) is out of scope. If the user declines, continue with quota claims labeled **user-asserted**, not verified-live.
3. **Both providers configured**: each resolved provider must be live in this session (see Inventory below). If not, offer the matching setup recipe via `confirm` — plugin-backed provider (add its package as `"<package>@latest"` + register the user's key in `~/.local/share/opencode/auth.json` as `{"type":"api","key":"<key>"}`, asking for the key via `ask_text` first), OAuth provider (`opencode auth login` guidance), or plain API-key provider (auth.json entry or env var reference). On decline: stop; never substitute a different provider for one the user named.

## Inventory — three live sources

Before resolving anything, read:

1. `~/.config/opencode/opencode.json` → `plugin` array + `provider.*` keys
2. `~/.local/share/opencode/auth.json` → credential-keyed providers (a provider may exist here with zero `provider.*` entry)
3. `opencode models` → the session's resolved catalog; the provider prefixes here are the ground truth for "configured and working"

`configured_providers` = union of the three. If a provider is in `auth.json` but absent from `opencode models`, its auth or plugin is broken — surface that instead of designing around it.

## Strategy parsing

Parse `$ARGUMENTS`:

| Shape                                | Action                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `<cheap> <heavy>`                    | `sub-<cheap>-<heavy>` preset with both providers resolved dynamically                      |
| `sub-<provider>`                     | Single-provider preset; every tier on `<provider>`; fallback terminates at a free endpoint |
| `max-throughput` / `min-cost`        | Reserved keywords — ask tier-by-tier via `pick_one`                                        |
| `custom`                             | Reserved keyword — ask `pick_one` per tier for `(provider, model)` before designing        |
| *(empty)*                            | Infer `sub-<cheapest-bundled>-<largest-subscription>` (classification below)               |

### Dynamic provider resolution (no alias table)

For each token: lowercase → strip any `/model` suffix → exact match against `configured_providers` → unique substring match → otherwise `pick_one` from the actual configured providers. Announce what each token resolved to. The configured set is the entire universe — there is no fallback alias list.

### Subscription classification — telemetry, scoped lookup, then confirm

Config files don't record whether a provider is a subscription or pay-per-token (the same provider key can back either). First use available quota telemetry: `status: "ok"` plus `resultType: "rate_limit"` / `renderType: "percent"` identifies a quota-window subscription; `percentRemaining`, `window`, and `resetAt` provide live headroom. `resultType: "balance"` / `renderType: "value"` is money remaining, not a percentage. `authority: "provider_reported"` is verified-live provenance; missing or unhealthy entries remain ambiguous.

**Before asking the user to classify anything blindly, look the gap up on the internet.** For every provider the telemetry cannot classify — and every presumed subscription whose quota mechanics are unknown — fetch the provider's current published pricing/limits pages, with every query scoped to **the plan the user is actually signed up for**, and determine exactly two things: (1) whether that plan carries a usage quota (quota windows/pools vs. pure pay-per-token) and its limits, and (2) the **overage behavior** on exhaustion — throttle, hard block, or automatic paid overage. Don't research other plans or tiers, don't generalize one plan's terms onto another, and never guess fees; record findings with source + date. Then confirm via one `pick_many` over the unresolved providers — subscription / pay-per-token / free — with the lookup findings preselected. If the lookup was inconclusive, that provider's classification is **user-asserted**.

Then: **cheapest-bundled** = lowest effective $/1M among the user's subscriptions (ask if unknown — never guess fees); **largest-subscription** = most quota headroom + strongest models for `@heavy`, using live `percentRemaining` when available. Surface the inferred pair and provenance for confirmation.

## Model validation — live catalog only

For every `(provider, model)` tuple about to be written:

```bash
opencode models <provider> 2>&1 | grep -x "<provider>/<model>"   # must print a line
```

If the model doesn't resolve in the live session, present that provider's live model list via `pick_one` — never write an ID the session can't resolve (config-loader will warn `Model not available` at startup; zero such warnings is the acceptance test). models.dev and provider docs are fine for research but are **not** the validity test — the session catalog wins, and the same provider key can expose different models under different auth modes.

## Live pricing + benchmark recheck — mandatory

Before assigning models to tiers, re-verify from live sources (training-data numbers are stale by default):

1. Fetch each target provider's **current published pricing** ($/1M in/out, subscription quota mechanics).
2. Websearch **recent** (≤ ~90 days) benchmark comparisons between the candidate models, anchored to the current date.
3. Use `opencode-quota` telemetry for live `window`, `resetAt`, and `percentRemaining` when `authority: "provider_reported"`; treat `balance` values as money, not quota percentages.
4. Record provenance: what was verified live today vs. user-asserted — put it in the JSONC comments and the final summary.

## Preset composition

| Tier      | Model slot                                  | costRatio | steps | variant |
| --------- | ------------------------------------------- | --------- | ----- | ------- |
| `@fast`   | `<cheap-provider>/<fast-model>`             | 1         | 30    | —       |
| `@medium` | `<cheap-provider>/<mid-model>`              | 5         | 50    | —       |
| `@heavy`  | `<heavy-provider>/<strong-model>`           | 20        | 120   | `high` (if the provider supports reasoning effort) |

`<fast-model>` / `<mid-model>` / `<strong-model>` = concrete IDs picked from each provider's **live catalog**, informed by the **live pricing/benchmark recheck**. Ratios 1/5/20 are provider-agnostic relative weights, not $/1M.

## Fallback chain construction

- `"<heavy-provider>": ["<cheap-provider>", "<other-configured>", "<free-if-any>"]` — cheap route first on heavy-quota failure; this is the subscription-first promise.
- Among additional configured entries, prefer verified-live quota headroom (`percentRemaining` and `resetAt`) over a nearly exhausted window. Do not override the required heavy → cheap order; without telemetry, mark headroom claims user-asserted.
- `"<cheap-provider>": ["<other-configured>", "<free-if-any>"]` — terminate at an explicitly free endpoint when one is configured; otherwise at the cheapest configured route.
- Strip entries for providers that aren't configured.
- Chains are per-provider, not per-tier (plugin limitation — note it in the output).
- `max-throughput` inverts the first rule (each chain starts with the *other* provider); chains still terminate free.

## Lead-model check (advisory)

If `micode.json` has `agents.commander.model` on the heavy provider, surface it as an explicit `pick_one` pause (recommend `/optimize-micode` first) — the lead burns heavy quota on every message otherwise. Never edit `micode.json` from this command.

## Apply, validate, restart

Deep-merge the new `presets.<name>` + `fallback.global` into `~/.config/opencode/opencode-model-router.overrides.jsonc` (objects merge, scalars/arrays replace — a new preset beside existing ones is safe). Validate JSONC parseability, then the config-loader canary:

```bash
opencode models 2>&1 | grep -i "not available" || echo "all models resolve"
```

Tell the user to restart opencode (auth, plugin, and overrides all load at startup), then verify **runtime state** — the router saves state and saved state wins over file defaults: `/router` and `/tiers` to inspect, `/router preset <name>` / `/router mode <mode>` / `/router enforce advisory` to correct drift.

## Output

Print: (1) validation result incl. zero-warning canary; (2) the rendered preset JSONC; (3) a reasoning table — one line per tier (model + why, citing today's live data) + one per fallback entry; (4) the lead-recovery gap note with the manual `/preset` recipe; (5) restart reminder + post-restart verification commands.
