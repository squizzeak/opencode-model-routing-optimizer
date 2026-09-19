---
name: optimize-micode-models
description: Use ONLY when auditing or optimizing `model` assignments in `~/.config/opencode/micode.json`. Triggers on phrases like "optimize micode models", "review model assignments", "pareto optimal micode", "swap agents to better models", "what models should each agent use", "audit my opencode config", "is my config optimal", "compare providers openai anthropic opencode-go", "which provider should I use for X model", "cheapest provider for X", "fastest provider for X", "should I switch off opencode-go", "3rd party markup", "openrouter pricing", or any request to evaluate the agent model map across providers with markups, discounts, and per-provider latency differences. Applies Pareto-dominance across **(provider, model)** tuples: drops strictly-dominated options, recommends swaps only when an alternative beats the current on every axis on every provider. NOT for first-time micode.json creation, NOT for application code, NOT for non-model config fields (permissions, plugins, MCP, agents, skills).
---

<!-- routing-optimizer:version=0.1.0 -->

# Optimize micode.json model assignments

Applies **Pareto-dominance analysis** to the `model` field across every agent in the user's global opencode config, comparing against every candidate **(provider, model)** tuple. Replaces strictly-dominated assignments with strictly-better ones, leaves frontier assignments alone.

## The Pareto test (the only logic this skill uses)

Each candidate is a **(provider, model)** tuple — the same model offered by two different providers counts as two candidates. Tuples are compared on **N axes** (default: quality, speed, cost, quota). Tuple A **Pareto-dominates** tuple B if A is strictly better on **every** axis the user cares about. If such an A exists, swap B → A. If no such A exists, leave B alone — it sits on the frontier under the user's stated constraint.

Why provider matters: the same underlying model can have different effective price, latency, and quota on different providers. Example: `opencode-go/deepseek-v4-flash` and `deepseek/deepseek-v4-flash` are two separate candidates — opencode-go may add proxy latency and bundle pricing, deepseek-direct may charge list price with no markup, and either can Pareto-dominate the other depending on which axes matter.

Three categories:

| Category                  | Action                                                                |
| ------------------------- | --------------------------------------------------------------------- |
| **Strictly-dominated** (loses on every axis)  | Swap to the dominant model immediately                                |
| **Trade-off** (wins some axes, loses others)  | Leave alone — only swap if the user's constraint shifts                |
| **Frontier** (no other model beats it on all axes)   | Leave alone                                                            |

The skill's job is to find and apply the first category. It does not pick among trade-off options unless the user has explicitly stated a priority weighting.

## Provider dimension

Every `model` value in `micode.json` carries a provider prefix: `provider/model-id`. The provider is a first-class variable in the Pareto calculation, not an implementation detail. A swap may change the model, the provider, or both — only the `(provider, model)` tuple matters.

### Default provider scope

Read `~/.config/opencode/opencode.json` and inventory every `provider.*` key with credentials configured. The default scope is **all configured providers** — the user usually wants to know "should I keep using opencode-go or switch to direct?". Narrowing happens only when the user explicitly asks.

### How the user can override scope

Interactive providers (the user picks at invocation time):

| Scope                              | When to use                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `opencode-go` only (default before) | User wants to optimize within the current provider only                      |
| `direct` only                      | User wants to evaluate direct providers (openai, anthropic, deepseek, etc.)  |
| `3rd-party` only                   | User wants to evaluate aggregators (OpenRouter, AnyScale, etc.)              |
| `all configured`                   | User wants the global Pareto frontier across every provider they have creds for |

When the user does not state a scope, default to **`all configured`**. Always confirm before fetching catalogs — pulling 8 providers' pricing is wasteful if the user only cares about openai vs opencode-go.

### Provider-availability constraint

A swap is only valid if the target provider is **already configured with credentials** in `~/.config/opencode/opencode.json` (i.e., has a `provider.<name>.options.apiKey` or equivalent). Never recommend a provider the user hasn't set up — that would require them to provision API keys first, which is a separate workflow.

If the Pareto frontier requires a provider the user hasn't configured, surface it as a **"would-dominate-if-configured"** note in the output (separate from the applied swaps) so the user can decide whether to provision keys.

## Workflow

### 1. Read current state

Read `~/.config/opencode/micode.json` and inventory every agent's `model` field. Group by current model so dominance is computed once per unique model, not per agent.

```bash
python3 -c "import json; d = json.load(open('/Users/squizzeak/.config/opencode/micode.json')); \
  from collections import Counter; \
  c = Counter(a['model'] for a in d['agents'].values()); \
  [print(f'{m}: {n}') for m, n in c.most_common()]"
```

### 2. Confirm or extract the user's constraint

If the user hasn't stated a constraint, ask once. The constraint determines which axes matter:

| Constraint                              | Axes that matter                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| Speed where interaction is required, quality where unattended (default for this user) | quality, speed, cost, quota — applied per agent class (interactive vs unattended) |
| Maximum quality regardless of cost      | quality only (Opus 5 / Qwen3-Max tier wins)                                   |
| Minimum cost regardless of quality      | cost only (cheap tier wins)                                                   |
| Best TTFT for chat                      | TTFT, then quality                                                            |

The default for `micode.json` is the first row. Don't assume it — confirm if ambiguous.

The constraint also implicitly selects a **provider scope** (see Provider dimension above). Two clarifications worth asking in one batch:

1. **Constraint** — quality / cost / TTFT / two-tier (default).
2. **Provider scope** — `all configured` (default) / `opencode-go only` / `direct only` / `3rd-party only` / a specific list.

If the user says "compare openai vs anthropic" the scope is implicitly `[openai, anthropic]`. If they say "should I leave opencode-go?" the scope is `[opencode-go, <all direct>]`. Infer when unambiguous; ask when not.

### 3. Load the Pareto-dominance map (per provider)

The map changes every time any provider rotates models. **Always re-verify before recommending swaps.** For each provider in scope, fetch the current catalog and pricing. Suggested sources:

- **opencode-go**: Context7 or fetch `https://julien.cloud/opencode-go-models` (TTL 24h via ctx_fetch_and_index).
- **openai, anthropic, google, xai, deepseek, zai, moonshot, minimax**: their published pricing pages — fetch with `ctx_fetch_and_index` (TTL 24h). Cross-check at least two providers with Context7 where the docs are stable.
- **3rd-party aggregators** (OpenRouter, AnyScale, etc.): their `/models` endpoints or pricing pages. OpenRouter exposes a JSON API at `https://openrouter.ai/api/v1/models` — useful for one-shot pricing snapshots.
- **Provider latency benchmarks**: there is no canonical source. Default to the per-provider overheads table below; allow user override if they have measured TTFT from logs.

The known map as of Sept 2026 (treat as baseline; verify with fresh fetch — these were verified on opencode-go, cross-provider dominance requires fresh per-provider fetch):

| Dominant model | Dominates        | Why                                                                                                                          |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| V4-Flash       | V4-Pro           | Higher quality (TB2.1 90.6 vs 87.9) + 2.1× faster + 8× cheaper input + ~7× quota. V4-Pro retires Sept 14, 2026 and routes to V4.1-Flash at the same price — paying for the older, slower model. |
| V4-Flash       | GLM-5.3          | Higher quality + faster + cheaper on every axis                                                                               |
| V4-Flash       | deepseek-v3.5    | Newer gen, wins on quality + speed + cost                                                                                     |
| V4-Flash       | Kimi-K2          | Newer gen, wins on quality + speed + cost                                                                                     |
| V4-Flash       | GLM-4.6          | Older Zhipu gen                                                                                                              |
| V4-Flash       | minimax-m2       | Older MiniMax gen                                                                                                            |
| M3             | minimax-m2       | Faster streaming, higher quality                                                                                             |
| Luna           | any old "small" model that loses on TTFT | Best TTFT in catalog at sufficient quality tier |

**Always verify each dominance claim with fresh benchmark data before applying.** Models that were dominated last month may have closed the gap; models that were frontier last month may now be dominated.

### 4. Map agents to Pareto-dominance candidates

For each unique `(provider, model)` tuple currently in the config, check whether any candidate tuple within scope strictly dominates it. If yes, propose the swap (the new tuple may differ from the current one in provider, model, or both). If no, the current tuple is on the frontier under the user's constraint — leave it.

Special cases:

- **brainstormer / interactive Q&A**: speed axis includes TTFT, not just tok/s. Luna beats M3 on TTFT; M3 beats Luna on streaming. Both are frontier — leave unless the user has expressed a clear TTFT-vs-streaming preference.
- **Subagents with quota constraints**: V4-Flash has ~7× the subagent quota of V4-Pro. If a model has a quota cap that's binding on unattended work, quota is a first-class axis.
- **Retirement warnings**: if a model is retired or scheduled to retire (e.g., V4-Pro on Sept 14, 2026), flag it as dominated regardless of benchmark parity — paying premium for an EOL model is a strictly worse trade.
- **Provider-switch dominance**: an agent currently on `opencode-go/X` may be dominated by `direct/X` if direct is cheaper/faster with the same quality, OR dominated by `opencode-go/Y` if a different model on the same provider beats it. Both kinds of swap are valid.
- **Quota caps that bind only one provider**: a model may have a generous quota on opencode-go but a tight cap on direct (or vice versa). When quota binds, swap to the provider where the cap is not the binding constraint.

### 5. Apply edits

Use the `edit` tool in parallel for independent swaps. Keep the diff surgical — only change the `model` field, preserve every other field (`description`, `prompt`, `permission`, etc.) exactly.

The `model` field format is always `<provider>/<model-id>`. A swap may change either half: same provider different model (`opencode-go/v4-pro` → `opencode-go/v4-flash`), different provider same model (`opencode-go/deepseek-v4-flash` → `deepseek/deepseek-v4-flash`), or both. Group parallel edits by oldString uniqueness to avoid edit collisions.

### 6. Validate

```bash
python3 -c "import json; d = json.load(open('/Users/squizzeak/.config/opencode/micode.json')); print('JSON valid'); print(f'{len(d[\"agents\"])} agents')"
```

Then sanity-check that every `model` value references a configured provider:

```bash
python3 -c "import json, re; \
  cfg = json.load(open('/Users/squizzeak/.config/opencode/opencode.json')); \
  providers = set(cfg.get('provider', {}).keys()); \
  mic = json.load(open('/Users/squizzeak/.config/opencode/micode.json')); \
  bad = [(a, m['model']) for a, m in mic['agents'].items() if m['model'].split('/')[0] not in providers]; \
  print(f'providers configured: {sorted(providers)}'); \
  print(f'agents referencing unconfigured providers: {bad if bad else \"none\"}')"
```

Then print a summary table: agent, old `(provider/model)`, new `(provider/model)`, dominance reason.

Finally, **tell the user to quit and restart opencode** — config is loaded once at startup, not hot-reloaded.

## Per-provider pricing & speed

A model offered by N providers has N separate `(provider, model)` candidates. The skill needs price, latency, and quota per candidate. Where to look:

| Provider class     | Examples                                    | Pricing source                                                                | Speed source                                                  | Quota source                                          |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| opencode proxy     | `opencode-go`                               | opencode-go catalog (`https://julien.cloud/opencode-go-models`)              | opencode-go status / your logged TTFT                         | opencode-go account page                              |
| Direct first-party | `openai`, `anthropic`, `google`, `xai`, `deepseek`, `zai`, `moonshot`, `minimax` | Provider's published pricing page (fetch via `ctx_fetch_and_index`, TTL 24h)   | Provider's published benchmarks; your measured TTFT preferred | Provider's account dashboard                          |
| 3rd-party aggregators | `openrouter`, `anyscale`, etc.            | Aggregator's `/models` endpoint or pricing page                               | Aggregator's published latency stats; your measured TTFT preferred | Aggregator's rate limit doc; your account dashboard   |
| Bundled / subscription | `github-copilot`                        | Free with existing subscription (effective cost = 0)                          | Backend provider's TTFT (model runs elsewhere)                 | Subscription tier caps                                  |

### Fetch recipe

For each provider in scope, run one `ctx_fetch_and_index` (TTL 24h, parallelism 3-5) for the pricing page, and one for any published latency benchmarks. If the provider exposes a JSON catalog (OpenRouter does), prefer that over HTML scraping.

After fetching, **normalize** the data into a single table with columns:

```
(provider, model, input_$/1M, output_$/1M, ttft_p50_ms, tok/s_p50, quota_rpm_or_tpm, available)
```

`available` is `False` if the provider isn't configured in the user's `opencode.json`. Pareto analysis runs over rows where `available=True`; `available=False` rows surface as **would-dominate-if-configured** notes.

## Markup & discount handling

Pricing models fall into three categories — only the first two have a per-token `markup_factor`:

| Pricing model              | Examples                                  | Effective `$/1M` formula                                              | Per-token markup |
| -------------------------- | ----------------------------------------- | --------------------------------------------------------------------- | ---------------- |
| **Pay-per-token**          | openai API, anthropic API, google API, deepseek API, etc. | `list_input_price + (list_output_price * expected_output_ratio)` | 1.0× (list) — may be 1.05×–1.10× on aggregators |
| **Flat-rate subscription** | opencode-go, GitHub Copilot, ChatGPT Plus API (where applicable) | `monthly_fee / expected_monthly_tokens` (user-supplied); $0 marginal within bundled quota | n/a — not a multiplier |
| **Truly free tier**        | Hugging Face free inference, open-weight providers with no billing | `0` — only valid if no rate cap binds                                  | 0.0×             |

Why this matters:

- A flat-rate subscription is **NOT** "free" — at low utilization, the `monthly_fee / expected_tokens` term dominates and effective `$/1M` can be very high. At high utilization, it can beat any pay-per-token route. The Pareto dominance calculation only works if you compute effective `$/1M` correctly.
- A subscription that bundles a quota cap is **NOT equivalent** to unlimited $0/token access — when the quota binds, the candidate is dominated by a pay-per-token equivalent (assuming you can fall back to one).
- "Free" only applies to the third category. The `free` constraint filters to those candidates; `cost` evaluates everything via the effective `$/1M` formula above.

How to apply:

1. For pay-per-token routes: fetch list price, apply markup factor (1.0× for direct, current rate for aggregators from their pricing API), record as effective `$/1M`.
2. For flat-rate subscription routes: ask the user for `monthly_fee` and `expected_monthly_tokens` (default to user's last-30-days usage if available from logs), compute effective `$/1M`. If the user hasn't supplied these, surface the candidate as `usage_unknown` and exclude from automatic swaps.
3. For truly free tiers: effective `$/1M = 0`. Verify the rate cap doesn't bind at expected usage before recommending.
4. Pareto dominance on the cost axis uses the **effective** price, not the list price.

**Never guess** `monthly_fee`, `expected_monthly_tokens`, or a markup factor. If the source is uncertain, fall back to 1.0× and flag the candidate as `markup_uncertain: true` so the user knows the dominance claim assumes list price.

## Provider latency overhead

The same model can have very different TTFT on different providers due to proxy/routing overhead. Baseline as of Sept 2026 (treat as starting point; always prefer user-measured values if available):

| Provider route              | Typical added TTFT | Typical tok/s          | Notes                                                            |
| --------------------------- | ------------------ | ---------------------- | ---------------------------------------------------------------- |
| Direct first-party (US/EU regions) | ~baseline          | ~baseline              | Lowest possible TTFT, but varies by region and time of day       |
| opencode-go proxy           | +50–150 ms         | comparable to direct   | Proxy adds routing overhead; quality and quota bundled           |
| OpenRouter and aggregators  | +100–400 ms        | often comparable or slightly lower | Variable by upstream chosen                                    |
| GitHub Copilot              | +100–300 ms        | comparable             | Routes to underlying provider; bundled with subscription         |

The skill does not memorize these — it uses them as **defaults when no measured data is available**. If the user has logged TTFT from their own runs, those values override the defaults. Always tell the user to verify TTFT for interactive agents (brainstormer, commander) — provider latency has a bigger impact there than on unattended work.

### Quota-by-provider

Some providers apply per-account rate limits that differ by model and tier. opencode-go bundles a generous subagent quota (~7× what V4-Pro had); direct providers typically charge per-token with rate-limit headers but no per-day cap; 3rd-party aggregators vary. Treat quota as a binary axis for Pareto dominance — if a candidate hits its quota cap in normal use, it's strictly dominated by an equivalent candidate without that cap.

## Two-tier architecture (the user's constraint)

The user runs a two-tier setup by default:

| Tier                | Agents                                                                                                | Target axes                |
| ------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| **Interactive**     | commander, brainstormer, project-initializer, ledger-creator, mm-orchestrator, M3-class interactive agents | speed (streaming + TTFT), quality floor |
| **Unattended**      | planner, executor, implementer, reviewer, all 14 `@fast` subagents                                    | quality, speed, cost, quota              |

When in doubt about a specific agent's tier, the rule is: **does this agent's output reach the user directly (interactive) or feed into another agent (unattended)?** If interactive → speed-first (TTFT matters most here, so prefer providers with low latency overhead). If unattended → quality-first (cost and quota matter more than TTFT; provider choice can optimize for either).

### Provider implications per tier

- **Interactive agents**: prefer direct first-party routes when TTFT matters and the user has credentials. If the user is on opencode-go and the proxy overhead is a noticeable fraction of TTFT (interactive work is short), flag the swap to direct as a candidate. Don't swap if the proxy overhead is small relative to total response time.
- **Unattended agents**: cost and quota dominate. Aggregators with bulk discounts (and Copilot bundle if applicable) often Pareto-dominate here even when they have higher TTFT, because the unattended agent doesn't care about latency.

## Output format

After applying swaps, print:

1. **JSON validation** result + provider-coverage check (none referencing unconfigured providers).
2. **Swap summary table** — agent, old `(provider/model)`, new `(provider/model)`, dominance reason (one line each). When the provider changed, mark the row with `←provider-switch`; when only the model changed, mark `←same-provider`.
3. **Net count** — e.g., "5 swaps applied across 23 agents (3 provider-switches, 2 same-provider upgrades)".
4. **No-change agents** — list those that already sat on the frontier, briefly: "remaining models are frontier under your constraint with the providers in scope".
5. **Would-dominate-if-configured notes** — candidates that Pareto-dominate the current assignment but require a provider the user hasn't set up. Print as a separate table with `(provider/model, agent it would replace, what credentials to add)`. Do NOT apply these — surface them so the user can decide whether to provision keys.
6. **Restart reminder** — "quit and restart opencode for changes to take effect".

If zero swaps are warranted, say so plainly: "config is Pareto-optimal under your constraint with the current catalog — no swaps recommended."

## What this skill does NOT do

- Does not invent benchmarks or quote numbers it hasn't verified. Freshness wins over confidence.
- Does not pick among trade-off frontier models unless the user has explicitly stated a priority weighting.
- Does not touch any non-model field in `micode.json` (prompts, permissions, descriptions stay byte-identical).
- Does not modify opencode.json (the main config), agent files in `.opencode/agent/`, or any other config file. (It may *read* `opencode.json` to discover configured providers, but never edits it.)
- Does not create new agents, prompts, or skill files — only swaps the `model` field on existing agents.
- Does not register new plugins, MCP servers, or provider credentials. If Pareto dominance requires a provider the user hasn't configured, surface as a note; never silently provision.
- Does not apply provider-switches without showing them clearly in the swap table. The user must opt in to leaving opencode-go.

If the user's request expands beyond model swaps, route to the parent `customize-opencode` skill or escalate to the user.

## When to refuse

Refuse to apply a swap if:

- The dominance claim cannot be verified against fresh benchmark data (don't ship guesses).
- The swap would change an agent's behavior in a way the user has not opted into (e.g., moving a frontier model to a strictly-different trade-off).
- The target provider is not configured in `~/.config/opencode/opencode.json` — surface as a would-dominate-if-configured note instead of applying.
- The markup factor is uncertain (no published rate available) and the cost axis is the deciding one — flag the swap as `markup_uncertain` and require explicit user confirmation.
- The JSON fails validation after the edit — roll back and surface the parse error.

Surface the conflict to the user with the dominance evidence and let them decide.
