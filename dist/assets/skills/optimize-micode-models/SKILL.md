---
name: optimize-micode-models
description: >-
  Use ONLY when auditing or optimizing model assignments in
  ~/.config/opencode/micode.json, including /optimize-micode, Pareto-optimal
  model selection, provider pricing or latency comparisons, subscription
  quotas, agent model swaps, and lead-agent delegation reliability. Discovers
  providers and models dynamically
  from the live opencode session and rechecks live pricing/benchmark data on
  every run. Compares (provider, model) tuples and recommends swaps only when
  an alternative beats the current choice on every evaluated axis. NOT for
  first-time micode.json creation, application code, or non-model config.
---

<!-- routing-optimizer:version=0.2.0 -->

# Audit & Pareto-optimize micode model assignments

Computes Pareto dominance across every candidate `(provider, model)` tuple reachable from the user's **live** opencode session and swaps strictly-dominated assignments in `~/.config/opencode/micode.json`.

**This skill is fully provider- and model-agnostic.** It ships no dominance tables, no preferred-provider lists, and no model IDs. Providers are discovered from the live session; models from the live catalog; prices and benchmark claims from live sources, rechecked on every run. Anything that looks like a provider or model name below is a placeholder, not a default.

## Scope boundaries

- **This skill**: static per-agent `model` assignments in `micode.json`.
- **Not this skill**: `opencode-model-router.overrides.jsonc` tier presets, fallback chains, router config → `design-fallback-chain`.
- **Not this skill**: first-time `micode.json` creation or non-model fields (prompt, temperature, permissions).

## Inventory — three live sources (never a static list)

1. **`~/.config/opencode/opencode.json`** — `plugin` array (normalize: strip npm scope and any `@version` suffix) + `provider.*` override keys.
2. **`~/.local/share/opencode/auth.json`** — credential-keyed providers. A provider can exist here with **zero** `provider.*` entry (OAuth subscriptions, proxy-service keys); it still counts as configured.
3. **The live catalog** — `opencode models` output. The provider prefixes here are the ground truth for "configured and working right now".

`configured_providers` = union of the three. If a provider appears in `auth.json` but not in `opencode models`, its auth or plugin is broken — surface that rather than optimizing around it.

**Prerequisite**: `micode.json` exists. If missing, the micode plugin isn't installed — show the exact edit and offer via `confirm` to add `"micode@latest"` to the `plugin` array (always `@latest`, never a pinned version), then stop and let the user restart and re-run. Do not scaffold a micode.json by hand — that's micode's own job.

## Live data recheck — mandatory on every run

Model catalogs rotate weekly; pricing pages and benchmark rankings follow. **All pricing and quality data in this section is a hypothesis until re-verified against live sources during the run.** Nothing may be applied from memory, training data, or a previous session's output.

For each candidate `(provider, model)`:

1. **Catalog validity** (hard gate): the tuple must resolve in the live session —
   ```bash
   opencode models <provider> 2>&1 | grep -x "<provider>/<model>"
   ```
   The live `opencode models <provider>` output is the **only** validity test. models.dev and provider docs can list models the session's cached catalog rejects (config-loader then warns `Model not available` at startup). `--refresh` may still serve the stale cache; the raw cache is `~/.cache/opencode/models.json`. The same provider key can also expose **different models under different auth modes** (OAuth subscription vs API key) — the live session is the arbiter.
2. **Pricing**: fetch each provider's **current published pricing** (their pricing page or catalog endpoint). Record today's $/1M input and output. For subscriptions, record the quota mechanics (window length, pool size, throttle behavior, overage rules) — these matter more than list price.
3. **Quality**: websearch **recent** (≤ ~90 days) benchmark comparisons between candidates, anchored to the current date (`"<model-a> vs <model-b>" coding <current month> <current year>`). Older results are yellow flags, not evidence.
4. **Provenance**: in the output, mark each claim as verified-live-today vs. user-asserted. A future run must be able to spot drift.

## Provider classification — ask, never assume

Config files don't record whether a provider is a subscription or pay-per-token — the same provider key can back either. Ask once via `pick_many` over `configured_providers`: which are **subscription/bundled** (flat fee + quota), which **pay-per-token**, which **free** (no billing at all). All cost math runs over the user's classification + the live pricing fetch.

Provider **classes** that shape the axes (identified from the live config, not a lookup table):

| Class                  | How to recognize it                                   | Axis notes                                                                 |
| ---------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Direct API             | Provider's own endpoint, per-token pricing            | True $/1M; typically lowest TTFT for its models                            |
| Bundled subscription   | Flat fee + quota window (user-confirmed)              | Effective $/1M ≈ $0 until the quota window trips; then throughput collapses |
| Aggregator             | One endpoint fronting many upstreams                  | Adds a proxy hop (~+100–300 ms TTFT typically); free tiers are aggregated upstreams and still quota-capped |
| Free tier              | No billing at all (user-confirmed)                    | $0 but daily rate-limited; quality varies by upstream                      |

Subscription quota math needs the user's billing context: pool size, window length, what happens on exhaustion (throttle vs. paid overage). Ask; never guess.

## Pareto logic

Axes (all must be fetched live, per the recheck section): `cost` ($/1M, subscription-adjusted), `TTFT`, `quality` (reasoning benchmark class), `context window`, `quota impact`, `delegation reliability` (tool/subagent invocation fidelity — see the hard gate below). A tuple **dominates** another when it's at least as good on every axis and strictly better on one. Per agent:

1. Build the candidate set = every `(provider, model)` in `configured_providers` that clears the agent's constraint floor (next section).
2. Compute the Pareto front.
3. If the current assignment is dominated → propose swap.
4. If the current assignment is on the front → keep, even if a "better on one axis" alternative exists.

## Constraint semantics

Parsed from `$ARGUMENTS` or via `ask_text`/`pick_many`:

- **`quality floor`** — minimum benchmark class the agent needs (lead and heavy reasoning agents: highest class; trivial-read agents: any).
- **`cost ceiling`** — max $/1M (after subscription adjustment) the agent may draw.
- **`TTFT`** — max first-token latency for interactive agents; unattended agents may exceed it.
- **`two-tier`** (default) — interactive agents → speed-optimized pick; unattended agents → cost-optimized pick.
- **`free`** — only $0 effective-cost tuples (bundled quota remaining + free tiers); check whether each provider's free path is truly free or falls back to paid overage — verify with the user.
- **scope** — `all` (default), a class filter (`subscription` / `direct` / `free`), or an explicit provider list drawn from `configured_providers`.

## Two-tier doctrine (micode default)

The default micode architecture separates the lead/orchestrator (interactive, every message) from unattended fleet agents:

- The **lead** must clear the TTFT and quality floor — it's user-visible on every turn. It must also pass the **delegation hard gate** (next section) — a non-delegating lead is disqualified outright.
- The **fleet** can ride the cheapest adequate tuple, including subscription quota, since nobody watches its latency.

This is why two different tuples routinely coexist in a healthy `micode.json`.

## Delegation reliability — the micode hard gate

Micode's entire value is orchestration: the lead agent must reliably **invoke subagents** (spawn Task-tool agents per its system prompt) instead of answering everything inline. A model that benchmarks well but never delegates makes the fleet useless — no planner, no executor, no reviewer, regardless of what they're assigned. Treat this as a distinct evaluation dimension, not a footnote to "quality":

- **Hard gate for the lead/orchestrator**: a candidate is **disqualified for the commander slot** without positive evidence it delegates under the harness's orchestration prompt — no matter how far it wins on cost, TTFT, or benchmarks. This gate overrides the Pareto result.
- **Evidence, strongest first**: (1) observed behavior in the user's own sessions — did the lead spawn subagents when the task clearly called for delegation?; (2) a live probe — run the candidate as lead in a scratch session with a task that obviously demands delegation and watch whether it spawns; (3) recent (≤ ~90 days) community reports, date-anchored.
- **Fleet agents** are leaf workers, so subagent-spawning matters less — but **tool-use fidelity** (function-calling reliability, schema adherence, retry behavior) is still a Pareto axis for them: a fleet agent that fumbles tool calls fails its assignments.
- **Record findings** in the output's Delegation column + provenance notes, with the evidence class (observed / probed / reported). Findings decay like prices — a model update can fix or break delegation, so re-verify every run.

## Special cases

- **Subscription quota > sticker price**: when a subscription tuple is within ~20% on quality and wins cost by ≥3× after quota adjustment, prefer it for unattended fleet agents even if a pay-per-token tuple benchmarks higher.
- **Aggregators**: price at the upstream rate, but flag the added proxy hop and, for "free" tiers, the upstream quota cap.
- **OAuth vs API-key catalogs differ** for the same provider key — a tuple validated in this session is valid for *this auth mode* only. Note it in the output when relevant.
- **New-model lag**: a model announced on a pricing page but absent from the live catalog is not a candidate, period. Re-check on the next run.

## Application + validation

Apply swaps with `Edit` against `~/.config/opencode/micode.json`, exact-match the old model string. Touch **only** the `model` field — never prompt, temperature, or permissions.

Then run the canary — every model referenced anywhere in the merged config must resolve in the live session:

```bash
opencode models 2>&1 | grep -i "not available" || echo "all models resolve"
```

Zero warnings is the acceptance test. If a swapped-in model warns, it wasn't actually in the live catalog — revert that row and re-pick via `pick_one` from the provider's live list.

## Output format

Produce one swap table per agent group with columns:

`Agent | Old tuple | New tuple | $/1M old | $/1M new | TTFT old | TTFT new | Quality class | Delegation (evidence) | Quota note | Verified live?`

…then the Pareto reasoning (which axis the swap wins), then the applied diff summary. The command layer renders this and restarts micode.

## What this skill does NOT do

- Does **not** design tier presets or fallback chains — that's `design-fallback-chain`.
- Does **not** create a first-time `micode.json` or scaffold micode.
- Does **not** install plugins or register credentials silently — prerequisite gaps surface as an exact edit + an explicit `confirm` first; plugin entries are always `@latest`.
- Does **not** hardcode providers, aliases, or model IDs, and never applies pricing/benchmark numbers from memory — live sources on every run, provenance recorded.
- Does **not** touch non-model fields in `micode.json`.
