---
description: Audit and Pareto-optimize micode.json model assignments across all configured providers. Fully dynamic — providers, models, prices, and benchmarks are pulled live at run time; nothing is hardcoded. Usage: /optimize-micode [quality|cost|ttft|two-tier|free] [scope]
agent: commander
---

<!-- routing-optimizer:version=0.2.1 -->

Pareto-optimize the `model` field of every agent in `~/.config/opencode/micode.json` against every `(provider, model)` tuple reachable from the **live** opencode session. This command ships no provider lists, no model IDs, and no price tables — everything is discovered and re-verified at run time.

## Prerequisites — check and offer, never silently refuse

- `~/.config/opencode/micode.json` must exist. If not, micode isn't installed: show the exact edit and offer via `confirm` to add `"micode@latest"` to the `plugin` array in `~/.config/opencode/opencode.json` (always `@latest`, never pinned), then stop for a restart. Do not scaffold micode.json by hand.
- `@slkiser/opencode-quota` (recommended, not a gate): upgrades quota claims from user-asserted to verified-live. If absent, offer via `confirm` to add `"@slkiser/opencode-quota@latest"` to the `plugin` array (companion auth plugins listed **before** it — ordering matters); optionally also `npm install -g @slkiser/opencode-quota@latest` (Node ≥ 22) for the terminal CLI. On decline, continue and label quota claims **user-asserted**.

## Inventory — live sources

1. `~/.config/opencode/opencode.json` → `plugin` array (normalize: strip scope/`@version`) + `provider.*` keys.
2. `~/.local/share/opencode/auth.json` → credential-keyed providers (may have zero `provider.*` entries and still be configured).
3. `opencode models` → the session's resolved catalog; its provider prefixes are the ground truth for "configured and working".
4. `opencode-quota show --json` → when `@slkiser/opencode-quota` is installed: live per-provider quota/budget telemetry (schema in the recheck section below). Read-only — it never adds a provider to `configured_providers`; it grades the providers already discovered.

`configured_providers` = union of the first three. Providers in `auth.json` but absent from `opencode models` are broken auth — surface, don't optimize around them.

## Live recheck — mandatory, nothing from memory

For every candidate tuple:

1. **Validity (hard gate)**: must resolve in the live catalog — `opencode models <provider> | grep -x "<provider>/<model>"`. models.dev/docs are research, not validity; the session catalog wins. Same provider key can expose different models under different auth modes.
2. **Pricing**: fetch the provider's **current** published pricing page; record today's $/1M in/out plus subscription quota mechanics (window, pool, throttle, overage).
3. **Quality**: websearch recent (≤ ~90 days) benchmark comparisons, date-anchored to now.
4. **Quota telemetry** (when the quota plugin is installed): read `opencode-quota show --json`; record `percentRemaining`, `window`, and `resetAt` from `resultType: "rate_limit"` + `renderType: "percent"` entries (`balance`/`value` is money remaining, not a quota percentage). `authority: "provider_reported"` = verified-live; fresh install or idle session → `unavailable` until opencode has run with the plugin active.
5. **Classification**: telemetry first — a provider with `status: "ok"` and a `rate_limit`/`percent` entry is a **quota-window subscription** (verified-live); a `balance`/`value` entry is **pay-per-token balance**. Providers the telemetry doesn't cover (or the plugin absent) are classified via one `pick_many` (subscription / pay-per-token / free). Never guess fees.

## Constraint parsing from `$ARGUMENTS`

- `quality` — highest-benchmark-class picks within scope.
- `cost` — cheapest picks that clear each agent's quality floor.
- `ttft` — fastest-first-token picks for interactive agents.
- `two-tier` (default) — lead/interactive → speed-optimized; unattended fleet → cost-optimized.
- `free` — only $0 effective-cost tuples; verify each provider's free path with the user (true free vs. paid-overage fallback).
- **Scope** (second token): `all` (default), `subscription`, `direct`, `free`, or an explicit comma-separated provider list drawn from `configured_providers` only.

Unknown or unresolvable scope tokens → `pick_one` from the actual configured providers. No aliases, no guesses.

## Pareto test

Axes: `cost` (subscription-adjusted), `TTFT`, `quality class`, `context window`, `quota impact` (live `percentRemaining`/`resetAt` when telemetry is `provider_reported`, else user-asserted), `delegation reliability`. A tuple dominates another iff ≥ on every axis and > on one. Per agent: current assignment dominated → propose swap; on the front → keep. Subscription tuples within ~20% on quality that win cost ≥3× after quota adjustment are preferred for unattended fleet agents; a subscription whose live `percentRemaining` is low — or whose `resetAt` just passed a heavy workload — is deprioritized for fleet agents until the window refills, noting when to re-run. Without telemetry this case relies on the user's assertion.

**Delegation hard gate (lead only)**: micode is useless if the lead never spawns subagents. A candidate is disqualified for the commander slot without positive evidence it delegates under the orchestration prompt — observed sessions > live probe > recent community reports — regardless of wins on every other axis. For fleet agents, tool-use fidelity remains a plain axis.

## Apply + validate

`Edit` only the `model` fields in `micode.json` — never prompt/temperature/permissions. Then the canary:

```bash
opencode models 2>&1 | grep -i "not available" || echo "all models resolve"
```

Zero warnings required; a warned model gets reverted and re-picked from the provider's live list via `pick_one`.

## Output

One swap table per agent group: `Agent | Old tuple | New tuple | $/1M old | $/1M new | TTFT old | TTFT new | Quality class | Delegation (evidence) | Quota note | Verified live?` — then Pareto reasoning per swap, the applied diff summary, and a restart reminder. The Quota note column cites live telemetry (`percentRemaining`/`resetAt`, marked verified-live) when available and states user-asserted otherwise.
