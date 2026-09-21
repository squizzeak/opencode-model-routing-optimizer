---
description: >-
  Audits and optimizes micode.json model assignments for the priorities and
  expertise the user names (TTFT, TPS, quality, cost, context, reliability;
  plus a domain such as report writing, Python, Java, spreadsheets, or
  technical documents). Fully dynamic — providers, models, prices,
  benchmarks, and billing nature are researched live each run; nothing is
  hardcoded. Usage: /optimize-micode [priorities...] [--eligibility
  unrestricted|avoid-paygo|paygo-only|free-only] [expertise: <text>]
agent: commander
---
<!-- routing-optimizer:version=0.3.0 -->

# Intent-driven audit of `micode.json` model assignments

Audit and optimize the `model` field of every agent in `~/.config/opencode/micode.json` for the optimization **priorities** and domain **expertise** the user names. Everything is discovered and re-verified **live on every run** — providers, models, prices, plans, benchmarks, latency/throughput, and billing nature. Nothing is hardcoded. This command drives the single `optimize-micode-models` skill.

**Supersession.** The earlier two-skill product — which swapped only on strict all-axis dominance — was superseded by the user decision of 2026-09-20. This command now wraps the single `optimize-micode-models` skill and ranks by the requested goals.

## Intake — natural language first, ask only what is missing

`$ARGUMENTS` holds the raw user input (opencode interpolates it). Natural language is first-class; the flags below are conveniences, not required syntax.

```
/optimize-micode [priorities...] [--eligibility <mode>] [expertise: <text>]
```

- **Priorities** (case-insensitive tokens, dedupe): `ttft`, `tps`, `quality`, `cost`, `context`, `reliability`. Treat the token order as an explicit priority order **only** when the request states one; otherwise treat the requested dimensions as equally important (see below).
- **Eligibility mode** (`--eligibility <mode>`, also accept `eligible:<mode>`): `unrestricted` (default), `avoid-paygo`, `paygo-only`, `free-only`.
- **Expertise** (`expertise: <free text>`; accept `focus: <text>` as a back-compat alias): e.g. report writing, creative writing, Python, Java, spreadsheets, technical documents, or freeform. A bare free-text tail that matches no priority token, flag, or mode is treated as expertise.

Unknown token → ask; never guess. Natural-language billing restrictions ("avoid pay-as-you-go", "free only") are parsed from the request.

Ask **only** for what the request is missing — do not ask redundant questions:

- Dimensions/priorities missing → ask exactly: What dimensions should we be optimizing for (e.g., TTFT, quality, cost, TPS), and in what priority order or weighting?
- Expertise missing → ask exactly: What area of expertise should we focus on (e.g., report writing, creative writing, Python programming, Java programming, spreadsheet generation, technical documents, or freeform)?
- Both missing → ask these two questions, in that order; no mandatory rank-tool UI.

Never silently treat incidental mention order as strict priority. Use explicit order or weights; otherwise **disclose that the requested dimensions are treated as equally important**. Never ask the user to classify billing nature, and never ask which plan they own.

**Zero intake questions does not bypass edit consent** — see Apply + validate below.

## Prerequisites — offer, never silently refuse

- `~/.config/opencode/micode.json` must exist. If it does not, micode is not installed: show the exact edit and offer via `confirm` to add `"micode@latest"` to the `plugin` array in `~/.config/opencode/opencode.json` (always `@latest`, never pinned), then **stop** for a restart. Do not scaffold `micode.json`.
- `@slkiser/opencode-quota` (recommended, not a gate): upgrades quota claims from user-asserted to verified-live. If absent, offer via `confirm` to add `"@slkiser/opencode-quota@latest"` to the `plugin` array (companion auth plugins listed **before** it — ordering matters); optionally also `npm install -g @slkiser/opencode-quota@latest` (Node ≥ 22) for the CLI. On decline, continue and label every quota claim **user-asserted**.

## Inventory — the four live sources

1. `~/.config/opencode/opencode.json` → `plugin` array (normalize: strip scope and any `@version`) + `provider.*` keys.
2. `~/.local/share/opencode/auth.json` → credential-keyed providers (may have zero `provider.*` entries and still be configured).
3. `opencode models` → the session's resolved catalog. The live catalog is the **sole validity test**; models.dev and provider docs are research, not truth. The same provider key can expose different models under different auth modes.
4. `opencode-quota show --json` → read-only grading when the quota plugin is installed. It never adds a provider; it grades the providers already discovered.

`configured_providers` = union of the first three. A provider present in `auth.json` but absent from `opencode models` is broken auth — surface it, don't optimize around it.

## Eligibility modes

| Mode | Classification rule |
| --- | --- |
| `unrestricted` | No billing filter. Capacity and competence requirements still apply. |
| `avoid-paygo` | Exclude pay-per-token-only routes and metered overage. |
| `paygo-only` | Only pay-per-token routes. |
| `free-only` | Only research-confirmed free-as-in-beer routes with **no** paid overage fallback; excludes paid subscriptions even when the marginal request cost is zero. |

Classify **routes/plans**, not whole providers. A route whose classification is **unknown is excluded** from the three constrained modes (`avoid-paygo`, `paygo-only`, `free-only`) — it cannot be asserted to qualify. Under `unrestricted`, an unknown-classification route stays eligible but its cost/billing is reported **unknown**.

## Live research — mandatory every run, nothing from memory

Date-anchor every fetch to the current date. For every candidate route, using multiple relevant sources:

1. Current published pricing/plans and overage terms for the **exact** route/plan/auth mode.
2. Domain capability evidence for the stated expertise (domain benchmarks/evals), plus general quality.
3. **TTFT and TPS as distinct** provider-route-dependent measures — never conflated.
4. Validity in the live catalog only (see Inventory).
5. `opencode-quota show --json` account telemetry.

Screen all candidates systematically first, then deeply research the viable shortlist per role/domain. Record each claim's source, publication or measurement date, measurement conditions, exclusions, confidence, and gaps; never fabricate scores or present unsupported rankings.

Use Context7 to verify CLI flags and JSON schema against current docs before relying on them. `opencode-quota show --json` reads the **disk cache only — no network**; an uncached provider reports `unavailable`, and cache age/authority must be recorded separately from the claim.

## Billing nature — research + telemetry, never asked

Derive billing nature from fresh web evidence for the exact route/plan/auth mode, corroborated by quota telemetry (`rate_limit`/`percent` ⇒ quota-window subscription; `balance`/`value` ⇒ pay-per-token balance). **Never ask the user to classify billing.**

Rate limits exist on free, subscription, and paygo routes: a rate_limit entry does not by itself prove a subscription.

Never assert an unknown billing nature or balance as positive or $0.

Unknown quota/balance **stays unknown** — report it as unknown. Promotional credits and provider-reported cached data are not automatically fresh, and a zero or missing price does not imply free.

## Capacity gate

Independently require fresh positive remaining capacity or documented usable account entitlement before recommending a new assignment in any billing mode.

Unknown or stale capacity remains unverified and cannot silently pass unrestricted mode.

Exclude exhausted routes and inspect every binding window. Catalog presence and API keys do not establish usable funds; public web pages cannot establish private balances. Offer supported telemetry refresh/setup with consent — without asking the user to classify billing.

## Domain & role suitability

Expertise and each agent's actual responsibilities define suitability and quality evidence before ranking, not merely as tie-breakers.

Cover **every** configured agent with a `change` / `keep` / `blocked` decision and a rationale — never invent agent names. Enforce role-specific competence, tool-use, and context requirements: a coding benchmark cannot substitute for creative-writing evidence, and a fast but domain-incompetent model is not suitable.

## Intent-driven selection

No all-axis dominance requirement: propose a swap whenever the pick beats the current assignment on the requested goals; keep when the current assignment is already the top pick.

Hard filters first: live-catalog validity; delegation hard gate; eligibility mode; explicit scope; capacity gate. Then rank the surviving candidates per agent by the **requested priorities in order** (lexicographic only for explicitly ordered priorities; otherwise equal weighting), with domain expertise and agent responsibilities setting suitability **before** ranking. **No free-first bias**: build the pool to include frontier/most-capable models for execution, review, security, and other high-stakes roles when they are eligible — cost matters only as much as it was prioritized.

## Quota-pool spreading — static assignment, not runtime fallback

When two routes are materially equivalent on every requested priority, prefer assigning them to different agents so load is spread across independent quota pools. Never do this at the expense of a stated priority. Label it quota-pool spreading: static micode assignments are not runtime smooth fallback and must not be described as such (a quota-exhausted provider does not fail over at runtime).

Spread only across demonstrably independent quota pools, and never at the cost of a requested priority or domain suitability.

## Delegation hard gate

The lead/orchestrator is **disqualified** without positive evidence it invokes subagents under the orchestration prompt — regardless of wins on every other axis. Evidence, strongest first: observed behavior in the user's own sessions → a live probe → recent (≤ ~90 days) community reports. For fleet agents, tool-use fidelity (function-calling reliability, schema adherence, retry behavior) is a ranking signal. Re-verify every run — findings decay like prices.

## Preserved invariants + Apply / validate

1. The live `opencode models` catalog is the only model-validity test.
2. Acceptance canary — success requires **exit status 0 AND zero `Model not available` warnings**. Capture output and status separately; never treat "grep matched nothing" as success, because a failed CLI also matches nothing:

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

Never write `opencode models 2>&1 | grep -i "not available" || echo "all models resolve"`: on CLI failure `grep` matches nothing and the `||` branch prints a false success.

3. `Edit` **only** the `model` fields in `~/.config/opencode/micode.json` — never prompt, temperature, or permissions; never router config.
4. Exact-edit consent: show the exact `Edit` target and get explicit confirmation before writing.
5. If the canary warns on a swapped-in model, revert **only this run's** changes (preserving unrelated edits) and re-pick from the provider's live list.
6. Never read, log, or echo credentials; provider keys only.
7. Prerequisite plugin entries are offered as `@latest` with consent; no silent config mutations.

## Output

One table per agent group:

`Agent | Old | New | Priorities met (how) | TTFT | TPS | Quality (domain lens) | $/1M or quota impact | Eligibility | Delegation (evidence) | Quota-pool note | Verified live?`

Then per-swap reasoning tied to the requested priorities, provenance labels for every claim (`verified-live-today` vs `user-asserted` vs `unknown`), the applied diff summary, and a restart reminder.
