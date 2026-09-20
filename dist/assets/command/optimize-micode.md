---
description: Audit and Pareto-optimize micode.json model assignments across all configured providers. Fully dynamic — providers, models, prices, and benchmarks are pulled live at run time; nothing is hardcoded. Usage: /optimize-micode [quality|cost|ttft|two-tier|free] [scope]
agent: commander
---

<!-- routing-optimizer:version=0.1.4 -->

Pareto-optimize the `model` field of every agent in `~/.config/opencode/micode.json` against every `(provider, model)` tuple reachable from the **live** opencode session. This command ships no provider lists, no model IDs, and no price tables — everything is discovered and re-verified at run time.

## Prerequisites — check and offer, never silently refuse

- `~/.config/opencode/micode.json` must exist. If not, micode isn't installed: show the exact edit and offer via `confirm` to add `"micode@latest"` to the `plugin` array in `~/.config/opencode/opencode.json` (always `@latest`, never pinned), then stop for a restart. Do not scaffold micode.json by hand.

## Inventory — three live sources

1. `~/.config/opencode/opencode.json` → `plugin` array (normalize: strip scope/`@version`) + `provider.*` keys.
2. `~/.local/share/opencode/auth.json` → credential-keyed providers (may have zero `provider.*` entries and still be configured).
3. `opencode models` → the session's resolved catalog; its provider prefixes are the ground truth for "configured and working".

`configured_providers` = union of the three. Providers in `auth.json` but absent from `opencode models` are broken auth — surface, don't optimize around them.

## Live recheck — mandatory, nothing from memory

For every candidate tuple:

1. **Validity (hard gate)**: must resolve in the live catalog — `opencode models <provider> | grep -x "<provider>/<model>"`. models.dev/docs are research, not validity; the session catalog wins. Same provider key can expose different models under different auth modes.
2. **Pricing**: fetch the provider's **current** published pricing page; record today's $/1M in/out plus subscription quota mechanics (window, pool, throttle, overage).
3. **Quality**: websearch recent (≤ ~90 days) benchmark comparisons, date-anchored to now.
4. **Classification**: ask via `pick_many` which configured providers are subscription / pay-per-token / free — config can't tell. Never guess fees.

## Constraint parsing from `$ARGUMENTS`

- `quality` — highest-benchmark-class picks within scope.
- `cost` — cheapest picks that clear each agent's quality floor.
- `ttft` — fastest-first-token picks for interactive agents.
- `two-tier` (default) — lead/interactive → speed-optimized; unattended fleet → cost-optimized.
- `free` — only $0 effective-cost tuples; verify each provider's free path with the user (true free vs. paid-overage fallback).
- **Scope** (second token): `all` (default), `subscription`, `direct`, `free`, or an explicit comma-separated provider list drawn from `configured_providers` only.

Unknown or unresolvable scope tokens → `pick_one` from the actual configured providers. No aliases, no guesses.

## Pareto test

Axes: `cost` (subscription-adjusted), `TTFT`, `quality class`, `context window`, `quota impact`, `delegation reliability`. A tuple dominates another iff ≥ on every axis and > on one. Per agent: current assignment dominated → propose swap; on the front → keep. Subscription tuples within ~20% on quality that win cost ≥3× after quota adjustment are preferred for unattended fleet agents.

**Delegation hard gate (lead only)**: micode is useless if the lead never spawns subagents. A candidate is disqualified for the commander slot without positive evidence it delegates under the orchestration prompt — observed sessions > live probe > recent community reports — regardless of wins on every other axis. For fleet agents, tool-use fidelity remains a plain axis.

## Apply + validate

`Edit` only the `model` fields in `micode.json` — never prompt/temperature/permissions. Then the canary:

```bash
opencode models 2>&1 | grep -i "not available" || echo "all models resolve"
```

Zero warnings required; a warned model gets reverted and re-picked from the provider's live list via `pick_one`.

## Output

One swap table per agent group: `Agent | Old tuple | New tuple | $/1M old | $/1M new | TTFT old | TTFT new | Quality class | Delegation (evidence) | Quota note | Verified live?` — then Pareto reasoning per swap, the applied diff summary, and a restart reminder.
