---
name: optimize-micode-models
description: >-
  Use ONLY when auditing or optimizing model assignments in
  ~/.config/opencode/micode.json, including /optimize-micode, Pareto-optimal
  model selection, provider pricing or latency comparisons, subscription
  quotas, agent model swaps, and lead-agent delegation reliability. Discovers
  providers and models dynamically
  from the live opencode session and rechecks live pricing, benchmark data,
  and — via @slkiser/opencode-quota when installed — remaining-quota
  telemetry on every run. Compares (provider, model) tuples and recommends
  swaps only when
  an alternative beats the current choice on every evaluated axis. NOT for
  first-time micode.json creation, application code, or non-model config.
---

<!-- routing-optimizer:version=0.2.4 -->

# Audit & Pareto-optimize micode model assignments

Computes Pareto dominance across every candidate `(provider, model)` tuple reachable from the user's **live** opencode session and swaps strictly-dominated assignments in `~/.config/opencode/micode.json`.

**This skill is fully provider- and model-agnostic.** It ships no dominance tables, no preferred-provider lists, and no model IDs. Providers are discovered from the live session; models from the live catalog; prices and benchmark claims from live sources, rechecked on every run. Anything that looks like a provider or model name below is a placeholder, not a default.

## Scope boundaries

- **This skill**: static per-agent `model` assignments in `micode.json`.
- **Not this skill**: `opencode-model-router.overrides.jsonc` tier presets, fallback chains, router config → `design-fallback-chain`.
- **Not this skill**: first-time `micode.json` creation or non-model fields (prompt, temperature, permissions).

## Inventory — live sources (never a static list)

1. **`~/.config/opencode/opencode.json`** — `plugin` array (normalize: strip npm scope and any `@version` suffix) + `provider.*` override keys.
2. **`~/.local/share/opencode/auth.json`** — credential-keyed providers. A provider can exist here with **zero** `provider.*` entry (OAuth subscriptions, proxy-service keys); it still counts as configured.
3. **The live catalog** — `opencode models` output. The provider prefixes here are the ground truth for "configured and working right now".
4. **`opencode-quota show --json`** — when `@slkiser/opencode-quota` is installed: live per-provider quota/budget telemetry (see the classification section for the schema). Read-only — it never adds a provider to `configured_providers`; it grades the providers already discovered.

`configured_providers` = union of the first three. If a provider appears in `auth.json` but not in `opencode models`, its auth or plugin is broken — surface that rather than optimizing around it.

**Prerequisite**: `micode.json` exists. If missing, the micode plugin isn't installed — show the exact edit and offer via `confirm` to add `"micode@latest"` to the `plugin` array (always `@latest`, never a pinned version), then stop and let the user restart and re-run. Do not scaffold a micode.json by hand — that's micode's own job.

**Recommended prerequisite (not a gate)**: `@slkiser/opencode-quota` upgrades quota claims from user-asserted to verified-live. Without it the skill still works — classification falls back to asking (below). If absent, offer via `confirm` to add `"@slkiser/opencode-quota@latest"` to the `plugin` array (companion auth plugins listed **before** it — ordering matters); optionally also `npm install -g @slkiser/opencode-quota@latest` (Node ≥ 22) for the terminal CLI. On decline, continue and label every quota claim **user-asserted**.

## Live data recheck — mandatory on every run

Model catalogs rotate weekly; pricing pages and benchmark rankings follow. **All pricing and quality data in this section is a hypothesis until re-verified against live sources during the run.** Nothing may be applied from memory, training data, or a previous session's output.

For each candidate `(provider, model)`:

1. **Catalog validity** (hard gate): the tuple must resolve in the live session —
   ```bash
   opencode models <provider> 2>&1 | grep -x "<provider>/<model>"
   ```
   The live `opencode models <provider>` output is the **only** validity test. models.dev and provider docs can list models the session's cached catalog rejects (config-loader then warns `Model not available` at startup). `--refresh` may still serve the stale cache; the raw cache is `~/.cache/opencode/models.json`. The same provider key can also expose **different models under different auth modes** (OAuth subscription vs API key) — the live session is the arbiter.
2. **Pricing**: fetch each provider's **current published pricing** (their pricing page or catalog endpoint). Record today's $/1M input and output. For subscriptions, record the quota mechanics (window length, pool size, throttle behavior, overage rules) — these matter more than list price.
3. **Quality**: websearch **recent** (≤ ~90 days) benchmark comparisons between candidates, anchored to the current date (`"<model-a> vs <model-b>" coding <current month> <current year>`). Older results are yellow flags, not evidence. With an active `focus` qualifier, scope these searches to the stated domain (e.g. `"<model-a> vs <model-b>" creative writing <current month> <current year>`) and record the lens in the provenance notes; without one, the default lens is general coding benchmarks.
4. **Quota telemetry** (when the quota plugin is installed): read `opencode-quota show --json` and record per-provider `percentRemaining`, `window`, and `resetAt` from `resultType: "rate_limit"` + `renderType: "percent"` entries; `resultType: "balance"` + `renderType: "value"` is money remaining, not a quota percentage. `authority: "provider_reported"` = verified-live; anything else is approximate. Fresh install or idle session → `unavailable` until opencode has run with the plugin active.
5. **Provenance**: in the output, mark each claim as verified-live-today vs. user-asserted. A future run must be able to spot drift.

## Provider classification — telemetry first, per-provider lookup, then two taps

Config files don't record whether a provider is a subscription or pay-per-token — the same provider key can back either. The quota plugin can, when it covers the provider. Classify in this order:

1. **Telemetry first** (plugin installed): a provider with `status: "ok"` and a `rate_limit`/`percent` entry is a **quota-window subscription — verified-live** (`percentRemaining`, `window`, `resetAt`); a `balance`/`value` entry is **pay-per-token balance** (real money, not a percentage). Record `authority` as provenance. Map quota-plugin provider keys to configured provider keys with the same dynamic resolution rules (exact → unique substring → ask).
2. **Per-provider web lookup for the gap**: before asking the user anything, look each unclassified provider up on the internet — one provider at a time. For every provider the telemetry cannot classify (absent, `unavailable`, or ambiguous) — and every presumed subscription whose quota mechanics are unknown — fetch its **current published pricing/limits pages** and enumerate the subscription plans it currently sells: plan names, quota mechanics per plan, and overage behavior per plan. Don't generalize one plan's terms onto another, and never guess fees. Record findings with source + date.
3. **Confirm per provider — at most two taps**: still one provider at a time, never a bulk questionnaire. Ask only what the lookup left open: (a) `pick_one` — "which plan do you have on `<provider>`?" with the looked-up plan names as options (plus "pay-as-you-go only — no subscription" and "not sure"); skip entirely when the lookup found no subscription plans — the provider is pay-per-token or free, record and move on. If the user's real plan isn't listed, let them say so (free-text "other") and treat it as authoritative. (b) `pick_one` — "what happens when the limit is reached?" ("blocked/throttled until the window resets" vs. "falls back to pay-as-you-go / paid credits"); ask only when the research didn't already settle overage for that plan — otherwise state the finding (source + date) and skip. Every option is multiple choice; the user taps, never types. "Not sure" keeps the provider **unresolved** — never guessed, and excluded from cost/headroom math until resolved.

All cost math runs over the verified classification + the live pricing fetch.

Provider **classes** that shape the axes (identified from the live config, not a lookup table):

| Class                  | How to recognize it                                   | Axis notes                                                                 |
| ---------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Direct API             | Provider's own endpoint, per-token pricing            | True $/1M; typically lowest TTFT for its models                            |
| Bundled subscription   | Flat fee + quota window (user-confirmed)              | Effective $/1M ≈ $0 until the quota window trips; then throughput collapses |
| Aggregator             | One endpoint fronting many upstreams                  | Adds a proxy hop (~+100–300 ms TTFT typically); free tiers are aggregated upstreams and still quota-capped |
| Free tier              | No billing at all (user-confirmed)                    | $0 but daily rate-limited; quality varies by upstream                      |

Subscription quota math needs the billing context: pool size, window length, what happens on exhaustion (throttle vs. paid overage). Get it from telemetry or the scoped plan lookup above, confirm it with the user, and never guess.

## Pareto logic

Axes (all must be fetched live, per the recheck section): `cost` ($/1M, subscription-adjusted), `TTFT`, `quality` (reasoning benchmark class), `context window`, `quota impact` (live `percentRemaining`/`resetAt` via telemetry when `authority: "provider_reported"`, else user-asserted), `delegation reliability` (tool/subagent invocation fidelity — see the hard gate below). A tuple **dominates** another when it's at least as good on every axis and strictly better on one. Per agent:

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
- **`focus`** — optional free-text domain qualifier for the quality axis (e.g. `coding effectiveness`, `creative writing`, `python specifically`). It scopes the quality axis's live benchmark research (step 3) to that domain, so a model that is generic-benchmark-mediocre but strong on the focused domain can reach the Pareto front. Cost, TTFT, quota math, and the delegation gate are unaffected. Bare free text in `$ARGUMENTS` that matches no constraint token or scope is the focus. Too vague to steer search → one `ask_text`. No domain→benchmark table is shipped — the qualifier only steers this run's live searches, and the lens used is recorded in provenance.

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
- **Near-exhausted subscription**: a subscription tuple whose live `percentRemaining` is low or whose `resetAt` has just passed a heavy workload is a poor fleet target *until the window refills* — deprioritize it for unattended agents in this run and note when to re-run. Without telemetry, this case relies on the user's assertion.
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

…then the Pareto reasoning (which axis the swap wins), then the applied diff summary. The Quota note column cites live telemetry (`percentRemaining`/`resetAt`, marked verified-live) when available, and states user-asserted otherwise. The command layer renders this and restarts micode.

## What this skill does NOT do

- Does **not** design tier presets or fallback chains — that's `design-fallback-chain`.
- Does **not** create a first-time `micode.json` or scaffold micode.
- Does **not** install plugins or register credentials silently — prerequisite gaps surface as an exact edit + an explicit `confirm` first; plugin entries are always `@latest`.
- Does **not** hardcode providers, aliases, or model IDs, and never applies pricing/benchmark numbers from memory — live sources on every run, provenance recorded.
- Does **not** touch non-model fields in `micode.json`.
