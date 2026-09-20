---
name: design-fallback-chain
description: >-
  Use ONLY when designing subscription-aware presets and fallback chains for
  opencode-model-router, including /design-fallback-chain, subscription-first
  routing, preserving subscription quota, tier assignment, and router overrides.
  Discovers providers and models dynamically from the live opencode session
  (config, auth store, `opencode models` output, and @slkiser/opencode-quota
  data when installed); hardcodes none.
  Rechecks live pricing, benchmark data, and — via the opencode-quota CLI —
  remaining-quota telemetry before every tier pick. Offers to install missing
  prerequisites (router plugin, opencode-quota, provider auth) with user
  consent. Does NOT modify micode.json or silently provision credentials.
---

<!-- routing-optimizer:version=0.2.3 -->

# Design a subscription-aware routing config

Produces a complete `~/.config/opencode/opencode-model-router.overrides.jsonc` that defines a new `presets.<name>` block plus the corresponding `fallback.global` chains, given the user's mix of subscriptions. Sibling of `optimize-micode-models` — that skill handles static per-agent `model` picks, this skill handles dynamic tier routing across subscriptions.

## What this skill is for

The user has **at least one bundled subscription** routed through opencode — any provider where they pay a flat fee for a quota window (monthly pool, 5-hour window, weekly cap, per-day cap) rather than per-token. They may also have pay-per-token providers and free-tier endpoints. The goal is:

- **Reserve the most-expensive subscription** for work that genuinely needs it (heavy tier: architecture, repeated-failure debug, security audit).
- **Route routine work** through a cheaper bundled route (medium tier: implementation, refactor; fast tier: read-only lookup).
- **When a subscription exhausts**, fall back to the next configured provider — terminating at an explicitly free endpoint when one exists.
- **Keep the orchestrator** (the lead agent that runs on every message) on the cheapest route so it doesn't itself burn the heavy subscription.

This skill is **fully provider- and model-agnostic**. It contains no alias tables, no preferred providers, and no model IDs. Everything is resolved at runtime from four live sources (below). Providers that appear in prose here are illustrative placeholders, not defaults.

## What the plugin can and cannot do (the gap)

`opencode-model-router` v1.11+ is the target plugin. Its capabilities and gaps must be stated honestly:

| Capability                                                    | Status                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tier-based delegation (`@fast`, `@medium`, `@heavy`)          | ✅ Core feature — orchestrator picks the tier per task via `taskPatterns` + rules          |
| Cross-provider fallback on task **failure**                   | ✅ `fallback.global` chains try the next provider when a subagent dispatch errors         |
| Cross-provider fallback on **quota exhaustion**               | ⚠️ Partial — only if the provider returns an HTTP error the plugin can match. A silent rate-limit that returns degraded responses is **not** detected. |
| Quota-window awareness (5h window, monthly cap, per-day cap)  | ❌ Not implemented — the plugin has no clock, no quota counter, no reset tracking |
| Automatic lead-model swap when the lead's quota exhausts      | ❌ Not implemented — the orchestrator stays broken until the user manually switches preset or restarts. |
| Read-only call caps + cumulative ceilings                     | ✅ Documented and enforced — see `tierCaps` and the per-resume `cap × 3` ceiling           |
| Verification / grading / escalation ladder                    | ✅ `enforcement` block — advisory by default, enforced with explicit opt-in |

**Bottom line**: the plugin can route work intelligently across subscriptions and can fail over per-task on hard errors, but it CANNOT auto-recover the lead when the lead's quota exhausts. Design around this — keep the lead on the cheapest route so the heavy subscription is never at risk of leading.

## Two-tier architecture

| Tier (router)      | What runs here                                                              | Subscription strategy                                       |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Orchestrator (lead)| Runs on every message — short, frequent, often trivial                      | Cheapest configured subscription                            |
| `@fast`            | Read-only lookups — single-shot, low-token                                  | Same as orchestrator (often the same model)                 |
| `@medium`          | Implementation, refactor, tests                                             | Mid-tier bundled or pay-per-token (cheapest capable)        |
| `@heavy`           | Architecture, debug-after-multiple-failures, security audit                 | The user's largest/most-capable subscription                |

The orchestrator is **deliberately not** on the heavy subscription — that protects the heavy quota from routine coordination traffic, regardless of which provider is heavy.

## Workflow

### 1. Inventory current state — four live sources

Provider and plugin truth comes from **four sources**, never from a static list. Read them in parallel:

1. **`~/.config/opencode/opencode.json`** — the `plugin` array and any `provider.*` override blocks.
   - Build `configured_plugins`: normalize each `plugin` entry by stripping any npm scope (`@org/`) and any version/`@latest` suffix, so `opencode-model-router@latest` → `opencode-model-router`.
   - Build `provider_overrides`: the `provider.*` keys. Note: many valid providers have **no** entry here — they need no override.
2. **`~/.local/share/opencode/auth.json`** — every key in this file is a provider with credentials registered. A provider can exist here (e.g. an OAuth subscription or a proxy-service key) with zero `provider.*` entry in `opencode.json` — opencode resolves it from models.dev + the auth store alone.
3. **The live session catalog** — run `opencode models` and capture the full `provider/model-id` list. This is the **ground truth** for what each provider actually exposes in this session right now.
4. **`opencode-quota show --json`** — when `@slkiser/opencode-quota` is installed: live per-provider quota/budget data (schema v2). Providers reporting `status: "ok"` or `"partial"` with entries are quota-managed; `percentRemaining` + `resetAt` feed tier and chain decisions. The CLI reads **cached** data collected by the plugin during normal opencode activity — a fresh install or idle session reports `unavailable` until opencode has run with the plugin active.

```bash
opencode models 2>&1 | grep -v '^\[micode\]'   # strip unrelated plugin log lines
```

Build `configured_providers` = the set of provider prefixes in the live `opencode models` output, unioned with `auth.json` keys and `provider.*` keys. If a provider appears in `auth.json` but **not** in `opencode models`, its auth may be broken or its plugin missing — note it and verify with `opencode models <provider>`.

Important catalog facts (learned the hard way):

- **models.dev and provider docs can diverge from the session catalog.** A model listed on a pricing page or in models.dev may not resolve in the session (stale cache, catalog lag). The live `opencode models <provider>` output always wins.
- **`opencode models <provider> --refresh` may still serve the cached catalog.** The raw cache lives at `~/.cache/opencode/models.json` and can be inspected directly when output looks stale.
- **The same provider key can expose different models under different auth modes** (e.g. OAuth subscription vs API key). Never assume a model exists because it exists for someone else's auth — check the live output.
- micode's `config-loader` warns at startup about every configured model that fails to resolve (`Model not available`). Zero of those warnings is the acceptance test for any model reference this skill writes.

### 2. Check prerequisites — and OFFER to install what's missing

Never refuse on a missing prerequisite without first offering to fix it. Check in order:

1. **Router plugin installed**: `opencode-model-router` must appear in `configured_plugins`.
   - If missing → show the exact edit and ask via `confirm`:
     > Add `"opencode-model-router@latest"` to the `plugin` array in `~/.config/opencode/opencode.json`?
   - Always install plugins as `@latest` (or the bare package name, which resolves the same way). Never pin a version.
   - On yes: apply the edit. The plugin loads on the next opencode start. **Continue designing** — writing the overrides file now is harmless (it's inert without the plugin) and means one restart activates everything. Say so.
   - On no: stop. The overrides file is inert without the plugin.
2. **Live quota telemetry (recommended)**: `@slkiser/opencode-quota` turns quota classification from user-asserted into verified-live. The **opencode plugin** collects per-provider quota snapshots during normal opencode activity; the optional **`opencode-quota` CLI** (or the export file) reads that cache from scripts. The CLI alone never fills the cache — the plugin must be active in opencode. It is a **recommended** prerequisite, not a hard one — without it the skill falls back to asking the user to classify subscriptions (step 3), which still works. Check for it first:
   ```bash
   command -v opencode-quota && opencode-quota show --json >/dev/null 2>&1
   ```
   - If present → read `opencode-quota show --json` now and keep the parsed result for steps 3, 5, and 7. Note `fromCache`/`cacheAgeSeconds`; if the snapshot is stale, say so and treat the numbers as approximate.
   - If missing → show the exact install and ask via `confirm`:
     > Add `"@slkiser/opencode-quota@latest"` to the `plugin` array in `~/.config/opencode/opencode.json`? (List any companion auth plugins **before** it — ordering matters. The plugin collects quota snapshots while opencode runs. Optionally also `npm install -g @slkiser/opencode-quota@latest` — requires Node ≥ 22 — for a terminal CLI; the plugin alone is enough for this skill, which can read the export file directly.)
     - Always install as `@latest`. Never pin a version.
     - On yes: apply the edit, then read the export file at `~/.cache/opencode/quota-export.json` (written by the plugin; empty until opencode has run with it active — if absent, mark quota claims user-asserted for this run). (Optionally mention `opencode-quota init` for the TUI sidebar, but that interactive setup is out of this skill's scope — don't run it.)
     - On no: continue. Mark every quota claim in this run as **user-asserted**, not verified-live, and proceed to step 3's ask-the-user classification.
3. **Both strategy providers configured**: the `<cheap>` and `<heavy>` providers (named or inferred in step 3) must both appear in `configured_providers`.
   - If a provider is missing → offer the setup recipe matching its shape, via `confirm`:
     - **Plugin-backed provider** (a community plugin supplies the provider integration): offer to add the plugin's npm package to the `plugin` array as `"<package>@latest"` AND register its credential. Ask for the API key via `ask_text` (never invent one), then register it in `~/.local/share/opencode/auth.json` as `{ "type": "api", "key": "<key>" }` under the provider's key. Note that auth.json is read at startup.
     - **OAuth subscription provider**: offer to walk the user through `opencode auth login` for that provider. This is interactive — the user completes it in their terminal.
     - **Plain API-key provider**: offer to register the key in `auth.json` (same shape as above) or add a `provider.<name>.options.apiKey` entry referencing an env var, per the provider's docs.
   - On yes: apply, then re-run the step-1 inventory to confirm the provider now resolves (`opencode models <provider>` non-empty).
   - On no: stop and surface what remains. The skill does NOT silently substitute a different provider for one the user named.
4. **Optional free-tier fallback**: if any configured provider has a genuine $0 tier (no billing at all), record it for chain termination. If none, chains terminate at the cheapest configured route.

### 3. Confirm or extract the user's strategy

The strategy is **provider-pair-shaped**: the user names the `<cheap>` and `<heavy>` providers; the skill resolves them against `configured_providers` and designs accordingly.

#### Dynamic provider resolution (no alias table)

Resolve each token the user typed against `configured_providers` directly:

1. Lowercase the token; strip any `/<model>` suffix (`provider/model` → match `provider`, record `model` as a hint).
2. Exact match against `configured_providers` → use it.
3. Unique substring match against `configured_providers` (e.g. `copilot` matches `github-copilot` when that's the only hit) → use it, and say what it resolved to.
4. Multiple or zero matches → ask once with `pick_one` listing the actual configured providers. Do not guess, and do not resolve through any hardcoded alias — the configured set is the entire universe.

#### Strategy shapes

| Shape                                            | Meaning                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `sub-<cheap>-<heavy>`                            | Two-provider subscription-first preset, named with the resolved canonical provider keys. |
| `sub-<provider>`                                 | Single-provider preset — every tier on `<provider>`; fallback chain terminates at free endpoints. |
| `max-throughput`                                 | Reserved keyword. Spread work across configured subscriptions in parallel roles; ask per tier via `pick_one`. |
| `min-cost`                                       | Reserved keyword. Treat all quotas as precious; cheapest route with free-tier fallback. |
| `custom`                                         | Reserved keyword. Ask once via `pick_one` for each tier's `(provider, model)` before designing. |

If `$ARGUMENTS` is empty, infer `sub-<cheapest-bundled>-<largest-subscription>` as below.

#### Subscription classification — telemetry, per-provider lookup, then two taps

**Config files do not record whether a provider is a subscription.** An OAuth-backed subscription and a pay-per-token API key can produce the identical provider key. When the opencode-quota telemetry from step 2 is available, use it as the **verified-live** classification signal before asking:

- A provider whose entry has `status: "ok"` and an `entries[]` item with `resultType: "rate_limit"` + `renderType: "percent"` is a **quota-window subscription** — `percentRemaining`, `window`, and `resetAt` tell you its live headroom and reset time.
- An entry with `resultType: "balance"` + `renderType: "value"` is **pay-per-token balance** — real money remaining, but **not** a percentage, so it can't be ranked by threshold.
- `authority: "provider_reported"` marks the reading as verified-live (vs. inferred). Record that provenance.
- A provider that is `status != "ok"` or absent from the quota output has no live signal.

**Before asking the user anything, look each gap up on the internet — one provider at a time.** For every provider the telemetry cannot classify, fetch its **current published pricing/limits pages** and enumerate the subscription plans it currently sells: plan names, quota mechanics per plan, and overage behavior per plan. Don't generalize one plan's terms onto another, and never guess fees. Record findings with source + date.

Then — still one provider at a time, never a bulk questionnaire — ask the user **only what the lookup left open**, with at most two multiple-choice questions:

1. **Which plan?** (`pick_one`) — options are the plan names just found in the lookup (marked as looked-up today), plus "pay-as-you-go only — no subscription" and "not sure". This pick scopes everything downstream to that plan. If the lookup found no subscription plans at all, the provider is **pay-per-token or free — skip the questions entirely**, record, move on. If the user's real plan isn't in the list, let them say so (free-text "other") and treat their answer as authoritative.
2. **What happens at the limit?** (`pick_one`) — "requests are blocked/throttled until the window resets" vs. "usage falls back to pay-as-you-go / paid credits". Ask only when the research didn't already settle overage behavior for the picked plan; if it did, state the finding (source + date) and skip the question.

Every option is multiple choice — the user taps, never types. "Not sure" (or a plan that didn't match reality) keeps that provider **unresolved** — never guessed, and excluded from headroom math until it's resolved in a later question or a later run.

Then apply the heuristics over the combined live + user classification:

- **Cheapest bundled**: the subscription with the lowest expected effective `$/1M` at the user's workload (ask if unknown — do not guess fees).
- **Largest subscription**: the subscription with the most quota headroom and strongest models for `@heavy`. When opencode-quota data is available, headroom is the live `percentRemaining` per window (with `resetAt` for when it refills) — verified-live, not guessed. Without it, fall back to the user's classification + the live catalog, and let the user confirm which is largest.

Always surface the inferred pair (and the classification) for confirmation before writing anything.

### 4. Validate every model against the live catalog

For each `(provider, model)` tuple the skill is about to write into a preset:

```bash
opencode models <provider> 2>&1 | grep -x "<provider>/<model>"   # must print a line
```

- If the model resolves → proceed.
- If not → present the provider's live model list via `pick_one` and let the user choose. Never write a model ID the live session doesn't resolve — the config will warn (or fail) at startup.
- Cross-checking against models.dev or provider docs is fine for pricing/quality research, but the **live session output is the only acceptance test**.

### 5. Recheck live pricing and quality benchmarks — never design from memory

Pricing, plan quotas, and model rankings decay fast. Before assigning any model to a tier, re-verify from live sources. Baked-in numbers from training data or earlier sessions are **stale by default** — treat them as hypotheses to confirm, not facts.

For each candidate `(provider, model)`:

1. **Pricing**: fetch the provider's current published pricing page (webfetch or equivalent). Record today's `$ / 1M` input and output, plus any subscription mechanics (quota windows, pool sizes, throttles, overage rules).
2. **Quality**: websearch for recent comparisons between the candidates, anchored to the current date (e.g. `"<model-a> vs <model-b>" coding benchmark <current month> <current year>`). Prefer results from the last ~90 days; anything older is a yellow flag.
3. **Subscription facts**: when the step-2 telemetry is available, window length (`window`), reset time (`resetAt`), and current headroom (`percentRemaining`) come from opencode-quota — verified-live when `authority: "provider_reported"`. Without it, quota size, window length, and plan tier are user-asserted unless the provider exposes a verifiable usage endpoint. Fill unknowns via the classification section's per-provider flow (lookup enumerates plans → user picks the plan → overage question only if research left it open); never guess a fee. A `balance`-type reading (`renderType: "value"`) is money remaining, not a quota percentage — never rank subscription headroom by it.
4. **Record provenance**: note in the JSONC comments (or the summary output) what was verified live today vs. what the user asserted — a future run can spot drift instead of trusting a stale number.

Pricing and benchmark data **inform** tier choice; the live `opencode models` catalog (step 4) remains the only **validity** test for a model ID.

### 6. Design the preset

Compose a `presets.<name>` block. Naming: `sub-<resolved-cheap>-<resolved-heavy>` using canonical provider keys. Required field per tier: `model`. Optional: `costRatio`, `steps`, `effort`, `prompt`, `variant`, `whenToUse`, `description`.

**Cost ratios are the price signal.** Default ladder `fast=1`, `medium=5`, `heavy=20` — relative weights, provider-agnostic, not `$/1M`:

| Tier          | Model slot                              | costRatio | Rationale                                                         |
| ------------- | --------------------------------------- | --------- | ----------------------------------------------------------------- |
| `@fast`       | `<cheap-provider>/<fast-model>`         | 1         | Single-shot lookups; cost dominates; usually same as the lead     |
| `@medium`     | `<cheap-provider>/<mid-model>` (or `<heavy-provider>/<mid-model>` if cheap has no mid tier) | 5 | Implementation quality matters; bundled mid is the sweet spot |
| `@heavy`      | `<heavy-provider>/<strong-model>`       | 20        | Reserved for genuinely hard work; 20× discourages overuse         |

`<fast-model>` / `<mid-model>` / `<strong-model>` are concrete model IDs **chosen from each provider's live catalog** (step 4) using **today's pricing and benchmark data** (step 5) — never from any list in this skill. Pick per tier by capability class: fast = cheapest adequate; mid = best quality-per-quota in the mid band; strong = the provider's most capable model, with `variant: "high"` (or that provider's max-reasoning knob) when the heavy provider supports reasoning effort.

### 7. Design the fallback chain

`fallback.global` maps provider → ordered provider list. On a subagent dispatch failure, the plugin tries each fallback in order.

```jsonc
"fallback": {
  "global": {
    "<heavy-provider>": ["<cheap-provider>", "<other-configured-if-any>", "<free-if-any>"],
    "<cheap-provider>":  ["<other-configured-if-any>", "<free-if-any>"]
  }
}
```

Rules (provider-agnostic):

- **`<heavy-provider>` lists `<cheap-provider>` first** — the core subscription-first promise: heavy quota failure falls through to the cheap route immediately.
- **Use verified-live headroom for secondary entries when available**: among additional configured providers, prefer a route with higher `percentRemaining` and an earlier `resetAt` over one whose quota window is nearly exhausted. Do not override the required heavy → cheap order; without telemetry, mark headroom claims user-asserted.
- **Every chain terminates at an explicitly free endpoint** when one is configured. Some subscription proxies silently fall back to free models at their own limits — the router doesn't know that, so the explicit entry is still required. No free tier → terminate at the cheapest configured route.
- **Strip entries for providers that aren't configured.** Two configured providers → a two-entry chain.
- The chain is **per-provider, not per-tier** — the plugin has no tier-specific chains. Fine for subscription-first: the failure mode is "this provider is exhausted", not "this tier is exhausted".
- `max-throughput` inverts the rule: each chain starts with the *other* provider so work spreads; chains still terminate free.

### 8. Check the lead model (advisory — never edit micode.json)

The orchestrator is the `commander` agent in `micode.json`. This skill never edits that file (the Pareto sibling's scope) — but it must verify the lead isn't on the heavy provider:

- If `micode.json.agents.commander.model.split('/')[0] == <heavy-provider>` → **surface as a recommendation** (the command layer turns this into an explicit `pick_one` pause): the lead will burn heavy quota on every message. Recommend running `/optimize-micode` first.
- **Delegation check**: beyond provider, the lead model must demonstrably invoke subagents under the harness's orchestration prompt — a lead that answers inline instead of delegating makes both micode's fleet and the router's tier structure moot. If session history shows the current lead not delegating, surface that alongside any provider mismatch (same recommendation: `/optimize-micode`, whose delegation hard gate exists for exactly this).
- Otherwise the lead is safe — no note needed.

### 9. Apply the config

Write the new preset + fallback chain into `~/.config/opencode/opencode-model-router.overrides.jsonc`, deep-merging with existing content. Plugin merge semantics: objects merge recursively; arrays and scalars replace; a malformed override layer is dropped (one bad file never breaks startup). So a new `presets.<name>` block is safe beside existing presets.

Use `Write` for a new file, `Edit` against the smallest unique substring for an existing one.

### 10. Validate, then restart + post-restart verification

Validate the written file:

```bash
python3 - <<'PY'
import json, re, pathlib
p = pathlib.Path.home() / '.config/opencode/opencode-model-router.overrides.jsonc'
content = p.read_text()
stripped = re.sub(r'//.*', '', re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL))
stripped = re.sub(r',(\s*[}\]])', r'\1', stripped)
data = json.loads(stripped)
print('JSONC valid')
print('presets:', list(data.get('presets', {}).keys()))
print('fallback chains:', list(data.get('fallback', {}).get('global', {}).keys()))
PY
```

Plus the config-loader canary — every model the file references must resolve in the live session:

```bash
opencode models 2>&1 | grep -i "not available" || echo "all models resolve"
```

Then **tell the user to quit and restart opencode** — overrides and auth/plugin changes load once at startup.

After restart, verify **runtime state**: the router saves state, and a saved state wins over file defaults. Tell the user to run:

- `/router` — shows current preset/mode/enforcement
- `/tiers` — shows the resolved tier models
- `/router preset <name>` — if the active preset isn't the new one
- `/router mode <mode>` and `/router enforce advisory` — if mode/enforcement drifted from the file

## What this skill produces

For any strategy, the output is a complete `presets.<name>` block + a `fallback.global` chain, slots filled from the user's live catalogs. Shape:

```jsonc
{
  "presets": {
    "sub-<cheap>-<heavy>": {
      "fast":   { "model": "<cheap-provider>/<fast-model>",   "costRatio": 1,  "steps": 30 },
      "medium": { "model": "<cheap-provider>/<mid-model>",    "costRatio": 5,  "steps": 50 },
      "heavy":  { "model": "<heavy-provider>/<strong-model>", "costRatio": 20, "steps": 120, "variant": "high" }
    }
  },
  "fallback": {
    "global": {
      "<heavy-provider>": ["<cheap-provider>", "<free-if-any>"],
      "<cheap-provider>": ["<free-if-any>"]
    }
  },
  "activePreset": "sub-<cheap>-<heavy>"
}
```

Every `<…>` slot is filled from the live session — never from this file. The skill prints the actual model IDs it chose, the cost-ratio reasoning, and the fallback-chain reasoning; the user reads the rendered JSONC before saving.

## Output format

After applying, print:

1. **Validation result** — JSONC parse + provider-coverage check + config-loader canary (zero "not available" warnings).
2. **Rendered preset** — the full JSONC block, for visual confirmation.
3. **Reasoning table** — one line per tier + one per fallback entry, explaining model choice and ratio/order. When quota data is available, add each provider's live `percentRemaining`/`resetAt`.
4. **The lead-recovery gap** — reminder that the plugin cannot auto-recover the lead on quota exhaustion, with the manual `/preset <name>` recipe.
5. **Restart reminder + post-restart verification** — restart, then `/router` / `/tiers` (and `/router preset <name>` if state drifted).

## What this skill does NOT do

- Does **not** modify `~/.config/opencode/micode.json` (the Pareto skill's scope).
- Does **not** author a quota-watcher plugin (see "Engineering the gap closer").
- Does **not** require `opencode-quota` — it is a recommended telemetry source; without it, quota claims are labeled user-asserted and classification falls back to asking the user.
- Does **not** treat a `balance` reading (money remaining) as a quota-window percentage or use it to rank subscription headroom.
- Does **not** install plugins or register credentials **silently** — every prerequisite change is shown as the exact edit and applied only after explicit `confirm`/`ask_text` consent. Plugin entries are always added as `@latest`.
- Does **not** pick a model on a provider the user hasn't configured, and never substitutes a different provider for one the user named.
- Does **not** hardcode providers, aliases, or model IDs — everything resolves from the live session's config, auth store, and model catalog.
- Does **not** edit `tiers.json` inside the plugin's cache directory — always the overrides file (`tiers.json` is overwritten on plugin updates).

## Engineering the gap closer (optional, separate workflow)

Closing the lead-recovery gap requires a separate plugin that:

1. Polls or hooks the current lead provider's quota signal (account dashboards, `x-ratelimit-remaining-*` response headers, provider usage endpoints — whatever that provider exposes).
2. Writes a sentinel when a quota window opens/closes.
3. Triggers a `/preset` switch — or registers a provider-handoff hook opencode honors.

Non-trivial plugin engineering; this skill only points at the gap. The off-the-shelf workaround is a manual `/preset` switch on quota exhaustion.

## When to stop (not silently proceed)

Stop and surface when:

- The user declines a prerequisite install (router plugin or provider auth). Say exactly what's missing; don't write a config they can't use unless they explicitly want it staged for later.
- The named `<cheap>` or `<heavy>` doesn't resolve against `configured_providers` and the user declines to set it up or pick an alternative.
- No model in a target provider's live catalog fits a tier and the user declines the closest alternatives.
- The existing overrides file is malformed JSONC — surface the parse error; don't compound it.
- The user requests providers they haven't configured AND declines both setup and substitution.

Surface the conflict with evidence and let the user decide.
