---
name: optimize-micode-models
description: >-
  Use ONLY when auditing or optimizing model assignments in
  ~/.config/opencode/micode.json, including /optimize-micode, intent-driven
  model selection by stated priorities and domain expertise, provider
  pricing/plan and TTFT/TPS research, subscription quotas, and lead-agent
  delegation reliability. Discovers configured providers and models
  dynamically from the live opencode session (opencode.json, the auth store,
  and the opencode models catalog) and rechecks current pricing, plan/quota
  mechanics, and domain capability evidence on every run; when
  @slkiser/opencode-quota is installed it also reads remaining-quota telemetry
  as a read-only grading source. Ranks candidates by the requested priorities
  and expertise, enforces the lead delegation gate, and applies only the
  requested model-field edits in micode.json. NOT for first-time micode.json
  creation, application code, router or fallback config, or non-model fields.
---
<!-- routing-optimizer:version=0.3.0 -->

# Intent-driven optimization of micode model assignments

Rank every reachable `(provider, model)` route against the **priorities** and **domain expertise** the user states, research them live, and apply swaps to the `model` fields in `~/.config/opencode/micode.json`.

**This skill is fully dynamic — it hardcodes nothing.** It ships no provider lists, model IDs, aliases, price tables, or benchmark rankings. Everything that looks like a real name below is a placeholder (`<cheap-provider>`, `<fast-model>`); any illustrative example is explicitly marked. Providers, models, prices, plans, and billing nature are discovered and re-verified from live sources on every run.

## Scope boundaries

- **Single skill.** The former two-skill, all-axis-dominance product was superseded by the user decision of 2026-09-20; this is now the one and only skill, covering intent-driven model selection.
- **Only `model` fields** in `~/.config/opencode/micode.json`. Never prompt, temperature, permissions, or any other key.
- **Never** router config (`opencode-model-router.overrides.jsonc`), tier presets, or fallback chains — that product was removed.
- **Not** first-time `micode.json` creation or scaffolding; that is micode's own job.

## Inventory — live sources (never a static list)

1. **`~/.config/opencode/opencode.json`** — the `plugin` array (normalize: strip npm scope and any `@version` suffix) plus `provider.*` override keys.
2. **`~/.local/share/opencode/auth.json`** — credential-keyed providers. A provider can appear here with **zero** `provider.*` entry (OAuth subscriptions, proxy keys) and still counts as configured.
3. **`opencode models`** — the live session catalog. This is the **only** model-validity test; the same provider key can expose different models under different auth modes, and catalogs rotate.
4. **`opencode-quota show --json`** — only when `@slkiser/opencode-quota` is installed. A **read-only grading source**: it never contributes a provider and never adds one to `configured_providers`.

`configured_providers` = union of sources 1–3. If a provider appears in `auth.json` but not in `opencode models`, surface the broken auth or plugin rather than optimizing around it.

**Prerequisite:** `micode.json` must exist. If it is missing, show the exact edit and offer, with explicit consent, to add `"micode@latest"` to the `plugin` array (always `@latest`, never pinned), then stop and let the user restart and re-run.

**Recommended (not a gate):** `@slkiser/opencode-quota` upgrades quota claims from user-asserted to verified-live. If absent, offer with consent to add `"@slkiser/opencode-quota@latest"` (companion auth plugins ordered **before** it); on decline, continue and label every quota claim **user-asserted**.

## Intake — natural language first

Accept natural-language requests, **arbitrary** optimization dimensions, explicit weights or order, and natural-language billing restrictions. Flags are conveniences, not required syntax, and you must not ask anything the request already supplies.

- **Dimensions missing:** ask exactly: What dimensions should we be optimizing for (e.g., TTFT, quality, cost, TPS), and in what priority order or weighting?
- **Expertise missing:** ask exactly: What area of expertise should we focus on (e.g., report writing, creative writing, Python programming, Java programming, spreadsheet generation, technical documents, or freeform)?
- **Both missing:** exactly those two intake questions, dimensions first, then expertise. There is no mandatory rank-tool UI — natural language is the primary interface.
- Do **not** silently interpret the incidental order in which dimensions were mentioned as a strict priority. Use explicit weights/order when supplied; otherwise **disclose equal importance** across the requested dimensions. Lexicographic ranking is appropriate **only** for explicitly ordered priorities.
- **Never** ask the user to classify billing nature, and **never** ask which plan they own. Billing is derived (see *Billing nature*).

## Convenience flags

Flags are shortcuts over the natural-language request; they never replace it.

| Form | Meaning |
| --- | --- |
| `[dimensions...]` | Case-insensitive dimension tokens: `ttft`, `tps`, `quality`, `cost`, `context`, `reliability`. Order counts only when the user explicitly states it is a priority order. |
| `--eligibility <mode>` | Also accepted as `eligible:<mode>`. One of `unrestricted`, `avoid-paygo`, `paygo-only`, `free-only`. |
| `expertise: <text>` | Free-text domain (e.g. `report writing`, `Python`, `spreadsheets`). `focus:` is accepted as a back-compat alias. |

A bare free-text tail that matches no token, flag, or mode is treated as `expertise`. An unknown token is never guessed: ask.

## Eligibility modes

| Mode | Meaning |
| --- | --- |
| `unrestricted` | **Default.** Removes billing restrictions only — it does **not** remove capacity or competence requirements. |
| `avoid-paygo` | Excludes metered overage **as well as** ordinary paygo. |
| `paygo-only` | Only pay-per-token routes. |
| `free-only` | Only research-confirmed free-as-in-beer routes with no paid overage fallback; excludes paid subscriptions even when the marginal request cost is zero. |

Classify **routes/plans, not whole providers** (one provider key can back several). A route whose classification is **unknown** is **excluded** from the three constrained modes — it cannot be asserted to qualify — and under `unrestricted` its cost is reported **unknown**.

## Live research — mandatory on every run

Research is re-done on **every** invocation, date-anchored, and applied from memory **never**. Screen candidates systematically first, then deeply research the viable shortlist per role/domain using **multiple** relevant sources:

- **(a) Catalog validity** — resolve the exact tuple against the live `opencode models` session (the only validity test).
- **(b) Provider economics** — current published pricing/plans and overage terms for the exact route, plan, and auth mode.
- **(c) Capability evidence** — evidence for the stated expertise domains **plus** general quality. Coding benchmarks cannot substitute for creative-writing evidence; match the evidence to the domain.
- **(d) TTFT and TPS** — distinct, provider-route-dependent measures. Never conflate first-token latency with sustained throughput.
- **(e) Freshness/availability** — whether the model and plan are currently offered; a model announced on a page but absent from the live catalog is not a candidate.

Record each claim's source, publication or measurement date, measurement conditions, exclusions, confidence, and gaps; never fabricate scores or present unsupported rankings.

Use **Context7** (`/slkiser/opencode-quota` and `/anomalyco/opencode`) to verify CLI flags and schema before citing them; never state an undocumented flag or field. Note that `opencode-quota show --json` is **cache-only** (no network) — refresh it via its own command, and record cache age.

## Billing nature — research + telemetry, never asked

Derive billing nature from **fresh web evidence for the exact route/plan/auth mode**, corroborated by quota telemetry. Never ask the user to classify it, and never infer free/available from a zero or missing price, or from absent credentials.

Rate limits exist on free, subscription, and paygo routes: a rate_limit entry does not by itself prove a subscription.

Also remember: provider-reported data read from a cache is **not automatically fresh/live**, and a `balance` value may be **promotional credits** rather than purchased funds.

Never assert an unknown billing nature or balance as positive or $0.

Unknown stays **unknown** — reported as unknown, never asserted positive and never asserted `$0`.

## Capacity gate

Independently require fresh positive remaining capacity or documented usable account entitlement before recommending a new assignment in any billing mode.

Unknown or stale capacity remains unverified and cannot silently pass unrestricted mode.

Exclude exhausted routes and inspect **all** binding windows (every active `rate_limit` window, not just the first). Catalog presence and the existence of an API key do **not** establish usable funds; public pricing pages cannot establish a **private** balance. Offer supported telemetry refresh/setup with consent — without asking the user to classify billing.

## Domain & role suitability

Expertise and each agent's actual responsibilities define suitability and quality evidence before ranking, not merely as tie-breakers.

Enforce role-specific **competence**, **tool-use**, and **context-window** requirements **before** any ranking. Cover **every** configured agent with a change / keep / blocked decision and a rationale. Never invent agent names — enumerate them from the live `micode.json`.

## Intent-driven selection

Hard filters, applied first:

1. live-catalog validity;
2. the **lead delegation gate** (below);
3. eligibility mode;
4. explicit scope;
5. the capacity gate.

Then rank the surviving candidates **per agent** by the requested priorities. Rank lexicographically **only** when the user explicitly ordered them; otherwise weight them equally and **disclose that equal weighting**. Apply domain suitability **before** ranking. Use quota-pool spreading as the final tie-break.

No all-axis dominance requirement: propose a swap whenever the pick beats the current assignment on the requested goals; keep when the current assignment is already the top pick.

**No free-first bias.** Build the candidate pool to include frontier/most-capable models for execution, review, security, and other high-stakes roles whenever they are eligible; cost matters only as much as the user prioritized it.

## Quota-pool spreading

When two routes are materially equivalent on every requested priority, prefer assigning them to different agents so load is spread across independent quota pools. Never do this at the expense of a stated priority. Label it quota-pool spreading: static micode assignments are not runtime smooth fallback and must not be described as such (a quota-exhausted provider does not fail over at runtime).

Spread only across **demonstrably independent** pools, and only without sacrificing requested priorities or domain suitability. This remains static assignment — **not** runtime fallback.

## Delegation hard gate

Micode's value is orchestration: the lead must reliably **invoke subagents**. A candidate is **disqualified for the commander slot** without positive evidence it delegates under the orchestration prompt, regardless of wins on any other axis. This gate overrides the ranking result.

Evidence, strongest first: **(1)** observed behavior in the user's own sessions; **(2)** a live probe in a scratch session with a task that demands delegation; **(3)** recent (≤ ~90 days) date-anchored community reports. Fleet agents are leaf workers, so subagent-spawning matters less for them — but their **tool-use fidelity** (function-calling reliability, schema adherence, retry behavior) remains an evaluation dimension. Record the evidence class and re-verify every run; model updates can fix or break delegation.

## Preserved invariants (numbered)

1. The live `opencode models` catalog is the only model-validity test.
2. **Acceptance canary** — success requires **exit status 0 AND zero `Model not available` warnings**. Capture output and status separately; never treat "grep matched nothing" as success, because a failed CLI also matches nothing:
   ```bash
   out=$(opencode models 2>&1); status=$?
   if [ "$status" -ne 0 ]; then
     printf 'canary FAILED: opencode models exited %s\n%s\n' "$status" "$out"
   elif printf '%s\n' "$out" | grep -iq "not available"; then
     printf 'canary FAILED: warned model(s):\n'
     printf '%s\n' "$out" | grep -i "not available"
   else
     printf 'canary OK: exit 0, zero "not available" warnings\n'
   fi
   ```
   Do **not** write `opencode models 2>&1 | grep -i "not available" || echo "all models resolve"`: on CLI failure `grep` matches nothing and the `||` branch prints a false success. A warned model, or a non-zero exit, is a canary failure — revert that row and re-pick.
3. The lead **delegation hard gate** is preserved.
4. **Exact-edit consent** — show the exact `Edit` target and get explicit confirmation before writing.
5. **Scope** = only `model` fields in `~/.config/opencode/micode.json`.
6. **Never read, log, or echo credentials** — provider **keys** only.
7. Prerequisite plugin entries are offered as `@latest` with consent; there are no silent config mutations.

## Apply + validate

Edit **only** `model` fields, exact-matching the old model string. Then run the canary and require **zero** `Model not available` warnings **and** inspect the command exit status — a CLI failure must not be labeled success merely because `grep` matched nothing. Revert **only** this run's changes, preserving unrelated edits; if a swapped-in model warns, revert that row and re-pick from the provider's live list.

## Output format

One table:

`Agent | Old | New | Priorities met (how) | TTFT | TPS | Quality (domain lens) | $/1M or quota impact | Eligibility | Delegation (evidence) | Quota-pool note | Verified live?`

Then, per swap, the reasoning tied to the **requested priorities**, the provenance of each claim (**verified-live-today** vs **user-asserted** vs **unknown**), the applied diff summary, and a restart reminder.

## What this skill does NOT do

- Does **not** touch router or fallback config, tier presets, or fallback chains.
- Does **not** create a first-time `micode.json`.
- Does **not** hardcode providers, models, aliases, or prices, and never applies numbers from memory.
- Does **not** ask the user to classify billing nature or name their plan.
- Does **not** touch non-model fields in `micode.json`.
