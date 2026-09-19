---
description: Audit and Pareto-optimize the `model` field for every agent in `~/.config/opencode/micode.json`. Compares against every candidate `(provider, model)` tuple in scope, swaps strictly-dominated assignments, leaves frontier models alone.
agent: commander
---

<!-- routing-optimizer:version=0.1.0 -->

# /optimize-micode

You are running the `/optimize-micode` slash command. Your job is to audit and optimize the `model` assignments in `~/.config/opencode/micode.json` using Pareto dominance across all configured providers.

## Step 1 — Load the skill

Load and follow the **`optimize-micode-models`** skill in its entirety. That skill contains the Pareto-dominance logic, the per-provider fetch recipe, the markup/discount handling, the provider latency overhead table, the two-tier architecture mapping, the output format, and the refusal rules. Do not duplicate any of that here — the skill is the source of truth.

After loading, **return briefly to the user** with one line confirming the skill loaded, then proceed.

## Step 2 — Parse `$ARGUMENTS`

`$ARGUMENTS` is the full text the user typed after `/optimize-micode`. It may be empty. Parse it into:

| Slot | Recognized values                                                                 | Default            |
| ---- | --------------------------------------------------------------------------------- | ------------------ |
| Constraint   | `quality` / `cost` / `ttft` / `two-tier` / `speed` / `interactive` / `free`    | `two-tier`         |
| Provider scope | `opencode-go` / `direct` / `3rd-party` / `all` / a comma-separated provider list | `all` (i.e., `all configured`) |

Rules for parsing:

- Empty `$ARGUMENTS` → both defaults.
- One token → constraint if it matches a known value, else treat as provider scope.
- Two or more tokens → first is constraint, rest is provider scope (or comma-separated list).
- Provider lists like `openai,anthropic` are valid for scope; expand them to the `provider.*` keys in `~/.config/opencode/opencode.json`.
- `free` constraint: maximize quality at strictly $0 marginal cost per token. Only candidates where the effective `$/1M = 0` AND no quota cap binds qualify. This is a narrow set — typically only truly free open-weight inference tiers (Hugging Face, etc.) or fully-unlimited subscription tiers. Subscription routes like opencode-go or GitHub Copilot do **NOT** qualify as `free` — they bundle quotas that may bind, and their effective cost is `monthly_fee / expected_monthly_tokens`, which the `cost` constraint evaluates via the markup table. If no candidate qualifies, `free` returns "no free routes in scope" and offers to fall back to `cost`.
- Unrecognized values: ask the user once with `pick_one` before proceeding. Do not guess.

If the user typed a free-form concern (e.g., "minimax retiring, find alternatives" or "deepseek quota is binding"), treat that as an extra constraint note to surface in step 3 alongside the standard constraint/scope.

## Step 3 — Run the skill workflow

Execute every step of the `optimize-micode-models` skill in order:

1. Read current state (`micode.json` + `opencode.json`).
2. Use the constraint and provider scope parsed in step 2 above (do not re-ask).
3. Fetch per-provider catalogs and pricing (TTL 24h).
4. Compute Pareto dominance across every `(provider, model)` tuple in scope.
5. Apply swaps in parallel via the `edit` tool.
6. Validate JSON and provider-coverage.

For each step, follow the skill's instructions exactly — including the **refuse-and-surface** rules for unverified benchmarks, unconfigured providers, and markup-uncertain cost axes.

## Step 4 — Render output

After validation, print the skill's full output format:

1. JSON validation result + provider-coverage check.
2. Swap summary table — agent, old `(provider/model)`, new `(provider/model)`, `←provider-switch` or `←same-provider` marker, dominance reason (one line).
3. Net count.
4. No-change agents (frontier under the user's constraint).
5. **Would-dominate-if-configured** notes — separate table, do NOT apply.
6. Restart reminder — "quit and restart opencode for changes to take effect".

If zero swaps are warranted, say so plainly: "config is Pareto-optimal under your constraint with the current catalog — no swaps recommended."

## Step 5 — Offer follow-ups

After rendering, briefly offer three next-step options via `pick_one`:

- **Apply + restart** — apply any would-dominate-if-configured candidates if the user wants to provision keys; otherwise just confirm the applied swaps and remind them to restart opencode.
- **Tighten scope** — re-run with a narrower provider scope or different constraint.
- **Done** — exit the command.

If the user picked "Done" or the conversation is wrapping, finish with a one-line summary of the net effect (e.g., "5 swaps applied across 23 agents — restart opencode for changes to take effect").

## Argument examples

- `/optimize-micode` — two-tier constraint, all configured providers.
- `/optimize-micode cost` — minimum-cost constraint, all providers.
- `/optimize-micode free` — maximize quality at strictly $0 marginal cost (rare; only unbundled free-tier routes). For bundled subscriptions (Copilot, opencode-go), use `cost` instead.
- `/optimize-micode quality opencode-go` — quality-only constraint, opencode-go only.
- `/optimize-micode direct` — two-tier constraint, direct first-party providers only.
- `/optimize-micode openai,anthropic` — two-tier constraint, just openai + anthropic.
- `/optimize-micode quality openai,anthropic,opencode-go` — explicit constraint + scope.

## What this command does NOT do

- Does not edit `~/.config/opencode/opencode.json` or any non-model field.
- Does not provision API keys or register new providers.
- Does not pick among trade-off frontier models unless the user explicitly stated a priority weighting in `$ARGUMENTS`.
- Does not silently apply provider-switches off opencode-go — every swap table row shows the provider change.

If `$ARGUMENTS` requests something outside the skill's scope (e.g., "rewrite my agent prompts" or "add a new subagent"), refuse and route the user back to the `customize-opencode` parent skill or to a fresh request.
