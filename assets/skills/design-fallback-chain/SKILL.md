---
name: design-fallback-chain
description: Use ONLY when designing a subscription-aware routing config for `opencode-model-router` — typically a new `presets.<name>` block plus a `fallback.global` chain that lets one bundled subscription (the user's "heavy" tier — opencode-go, ChatGPT Plus/Pro via Codex auth, GitHub Copilot, z.ai coding, Anthropic Claude via API, or any other provider the user has configured) carry genuinely hard work while a cheaper bundled route carries routine work and acts as the first fallback when the heavy quota exhausts. Provider-agnostic: the skill accepts any pair of configured providers for the `<cheap>` and `<heavy>` slots and resolves friendly names (`claude` → `anthropic`, `codex` → `openai`, `copilot` → `github-copilot`, `zai` → `zai`, etc.) against the user's `~/.config/opencode/opencode.json`. Triggers on "subscription-first routing", "preserve Codex quota", "preserve Claude quota", "preserve Copilot quota", "design router preset", "config opencode-model-router for two subscriptions", "subscription-aware tier assignment", "configure fallback chain", "opencode-model-router overrides", "tiers.jsonc config", "/design-fallback-chain". Does NOT modify `micode.json` (that is the sibling `optimize-micode-models` skill's scope). Does NOT author custom watcher plugins to auto-detect quota exhaustion — that is a separate engineering task. Does NOT provision API keys or set up subscription auth — that is a separate `~/.config/opencode/opencode.json` change.
---

<!-- routing-optimizer:version=0.1.1 -->

# Design a subscription-aware routing config

Produces a complete `~/.config/opencode/opencode-model-router.overrides.jsonc` that defines a new `presets.<name>` block plus the corresponding `fallback.global` chains, given a user's mix of subscriptions. Designed to sit beside `optimize-micode-models` — Pareto skill handles static per-agent `model` picks, this skill handles dynamic tier routing across subscriptions.

## What this skill is for

The user has **at least one bundled subscription** — opencode-go, ChatGPT Plus/Pro via Codex auth, GitHub Copilot, z.ai coding, Anthropic Claude via API key, an OpenAI/DeepSeek/Moonshot/Zhipu/MiniMax direct API key, an aggregator (OpenRouter, AnyScale), or any other provider the user has configured in `~/.config/opencode/opencode.json`. They may also have a second provider they want as a fallback. The goal is:

- **Reserve the most-expensive subscription** for work that genuinely needs it (heavy tier: architecture, repeated-failure debug, security audit).
- **Route routine work** through a cheaper bundled route (medium tier: implementation, refactor; fast tier: read-only lookup).
- **When a subscription exhausts** (5h/weekly Codex window, monthly Copilot cap, per-day API key cap, etc.), fall back to the next-bundled provider — then to an explicitly free endpoint.
- **Keep the orchestrator** (the lead agent that runs on every message) on the cheapest bundled route so it doesn't itself burn the heavy subscription.

The skill is provider-agnostic. It does not assume Codex/openai for heavy, opencode-go for cheap, or any other specific pair. The user names the providers they want via the `sub-<cheap>-<heavy>` strategy; the skill resolves friendly names (`claude`, `codex`, `copilot`, `zai`) against the user's configured `provider.*` keys.

## What the plugin can and cannot do (the gap)

`marco-jardim/opencode-model-router` v1.11+ (Sept 2026) is the right target plugin, but its capabilities and gaps must be stated honestly. The user's Sept 19, 2026 session already mapped this.

| Capability                                                    | Status                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tier-based delegation (`@fast`, `@medium`, `@heavy`)          | ✅ Core feature — orchestrator picks the tier per task via `taskPatterns` + rules          |
| Cross-provider fallback on task **failure**                   | ✅ `fallback.global` chains try the next provider when a subagent dispatch errors         |
| Cross-provider fallback on **quota exhaustion**               | ⚠️ Partial — only if the provider returns an HTTP error the plugin can match. A silent rate-limit that returns degraded responses is **not** detected. |
| Quota-window awareness (5h/weekly Codex window, monthly Copilot cap, per-day API key cap, etc.) | ❌ Not implemented — the plugin has no clock, no quota counter, no reset tracking |
| Automatic lead-model swap when the lead's quota exhausts      | ❌ Not implemented — when the orchestrator's tier exhausts, the plugin does NOT promote a fallback as the new lead. The orchestrator stays broken until the user manually switches preset or restarts. |
| Read-only call caps + cumulative ceilings                     | ✅ Documented and enforced — see `tierCaps` and the per-resume `cap × 3` ceiling           |
| Verification / grading / escalation ladder                    | ✅ `enforcement` block in `tiers.json` — advisory by default, enforced with explicit opt-in |

**Bottom line for the skill's design**: the plugin can route work intelligently across subscriptions and can fail-over per-task on hard errors, but it CANNOT auto-recover the lead when the lead's quota exhausts. The skill must be honest about this and design around it — typically by keeping the lead on the cheapest bundled route so the heavy subscription is never at risk of leading.

## Two-tier architecture (the user's constraint)

The user has a two-tier setup by default (same one as `optimize-micode-models`):

| Tier (router)      | What runs here                                                                 | Subscription strategy                                                 |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Orchestrator (lead)| Runs on every message — short, frequent, often trivial                          | Cheapest bundled subscription the user has configured                 |
| `@fast`            | Read-only lookups — single-shot, low-token                                     | Same as orchestrator (often the same model)                           |
| `@medium`          | Implementation, refactor, tests                                                | Mid-tier bundled or pay-per-token (cheapest capable)                  |
| `@heavy`           | Architecture, debug-after-multiple-failures, security audit                     | The user's "expensive" subscription (whatever they named it in the strategy) |

The orchestrator is **deliberately not** on the heavy subscription — that's how the skill protects the heavy quota from being burned by routine coordination. This applies regardless of which provider is heavy: Codex, Copilot, Claude API, z.ai, or any other subscription the user names.

## Workflow

### 1. Inventory current state

Read these files in parallel:

- `~/.config/opencode/opencode.json` — inventory every configured provider (`provider.*` keys with credentials) and every entry in the `plugin` array. **Build a `configured_providers` set and a `configured_plugins` set — these are the source of truth for every alias resolution and prerequisite check below.**
- `~/.config/opencode/micode.json` — confirm the orchestrator agent's `model` is on the cheap route (this skill assumes it already is; if not, the user should run `optimize-micode-models` first).
- `~/.config/opencode/opencode-model-router.overrides.jsonc` (if it exists) — read current state. The skill deep-merges on top, never replaces wholesale.

Then check three prerequisites in order:

1. **Plugin installed**: `opencode-model-router` must appear in `configured_plugins`. If missing → refuse with the install command (`cd ~/.config/opencode && npm install opencode-model-router`, then add to `plugin` array). **Don't apply any config until the plugin is installed — the file is inert without it.**
2. **Both strategy providers configured**: the `<cheap>` and `<heavy>` providers named in the user's strategy (or the defaults inferred in step 2) must both appear in `configured_providers`. If either is missing → refuse with the missing-credential note and the install recipe for that specific provider (Codex auth, Copilot plugin, Anthropic API key, etc.). The skill does NOT silently fall back to a configured replacement.
3. **Optional free-tier fallback**: if any provider with a $0/free-tier exists (HuggingFace, etc.), record it for the fallback chain. If none, the chain simply terminates at the configured non-free providers.

### 2. Confirm or extract the user's strategy

The strategy is **provider-pair-shaped**, not keyword-shaped. The user names the `<cheap>` and `<heavy>` providers; the skill resolves friendly names against the configured providers and designs accordingly.

#### Provider alias resolution

Friendly names resolve to canonical `provider.*` keys via this table (extend if you encounter new aliases):

| Friendly name(s) | Canonical `provider.*` key | Notes                                                         |
| ---------------- | -------------------------- | ------------------------------------------------------------- |
| `go`, `opencode-go` | `opencode-go`           | Bundled proxy                                                 |
| `openai`, `gpt`, `codex` | `openai`            | `codex` requires the Codex auth plugin to be active           |
| `claude`, `anthropic` | `anthropic`              | Direct API key                                                |
| `copilot`, `github`, `github-copilot` | `github-copilot` | Bundled subscription                                          |
| `zai`, `z.ai`, `zai-coding` | `zai`                | Direct API key; `zai-coding` is the coding-tuned model family |
| `kimi`, `moonshot` | `moonshot`                 | Direct API key                                                |
| `deepseek`        | `deepseek`                 | Direct API key                                                |
| `google`, `gemini` | `google`                   | Direct API key                                                |
| `grok`, `xai`      | `xai`                      | Direct API key                                                |
| `groq`             | `groq`                     | Direct API key (often used as fast fallback)                  |
| `minimax`          | `minimax`                  | Direct API key                                                |
| `openrouter`       | `openrouter`               | 3rd-party aggregator                                          |
| `anyscale`         | `anyscale`                 | 3rd-party aggregator                                          |
| `hf`, `huggingface` | `huggingface`             | Free tier (no billing)                                        |
| `free`             | first configured free-tier | Resolved at parse time; if no free-tier configured, refuses    |

Resolution rules:

1. Lowercase the input, strip `/`-prefixed model specifiers (`claude/opus-4.6` → name=`claude`, model=`opus-4.6`).
2. Match against the alias table — if unique → use the canonical key.
3. If the canonical key is not in `configured_providers`, refuse (don't silently substitute).
4. If the input doesn't match any alias, treat the input as a literal `provider.*` key and check `configured_providers` directly.
5. If still no match, ask the user once with `pick_one` listing the closest configured providers.

#### Strategy shapes

| Shape                                            | Meaning                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `sub-<cheap>-<heavy>`                            | Two-provider subscription-first preset. The canonical example, named in the user's own providers. |
| `sub-<provider>`                                 | Single-provider preset — every tier on `<provider>`, fallback chain just adds free endpoints. Use when the user has only one subscription. |
| `max-throughput`                                 | Reserved keyword. Spread work across all bundled subscriptions in parallel roles; the user is asked for each tier via `pick_one`. |
| `min-cost`                                       | Reserved keyword. Treat all quotas as precious; design the preset on the cheapest route with free-tier fallback. Reserved regardless of provider. |
| `custom`                                         | Reserved keyword. Ask once via `pick_one` for each tier's `(provider, model)` before designing. |

If `$ARGUMENTS` is empty, default to `sub-<cheapest-bundled>-<largest-subscription>` — picked by inspecting `configured_providers` and applying the heuristic below.

#### "Cheapest bundled" and "largest subscription" heuristics

When the user doesn't name the providers, infer them:

- **Cheapest bundled**: among configured providers, prefer those with a known bundled subscription (opencode-go, github-copilot, openai with Codex auth, zai coding plan, moonshot/Kimi subscription tier). Among several bundled, pick the one with the lowest expected `$/1M` at the user's likely workload. If no bundled provider exists, pick the lowest per-token direct provider.
- **Largest subscription**: among configured providers, prefer those with the highest quota cap per window (Codex Pro > Codex Plus > API key > free tier). If several are tied, prefer the one with the strongest model for the `@heavy` tier (Opus, GPT-5.x class).

Always surface the inferred pair to the user for confirmation before writing the config.

#### Constraint axes (orthogonal to provider choice)

These axes do NOT name providers — they describe how the preset behaves:

| Constraint                                            | Effect on preset design                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Subscription-first** (default)                      | Reserve the named `<heavy>` for genuinely hard work; route routine work to `<cheap>`.    |
| **Max-throughput**                                    | Spread work across both providers — `@medium` on one, `@heavy` on the other — and let both serve as fallbacks for each other. |
| **Min-cost**                                          | Treat the named `<heavy>` quota as precious; design a `<cheap>`-only preset with a free-tier fallback. The named `<heavy>` is not used in tiers, only as a name reference for clarity. |

The provider pair comes from the strategy shape; the constraint comes from the axis. Both combine.

### 3. Validate the target models exist in the catalog

For each `(provider, model)` the skill is about to put in a preset, verify the provider is configured AND the model ID resolves against the user's configured providers. The README's `/router models [provider]` command exposes this — but the skill should pre-validate before writing the file, by reading the same catalog the plugin reads (opencode's own `provider.<name>.models` registry).

If a target model is missing, **refuse and surface**. Never write a config that references a model the plugin will fail to resolve at startup — the user gets a broken OpenCode with no useful error.

### 4. Design the preset

Compose a `presets.<name>` block. Naming convention: `sub-<cheap>-<heavy>` — the slot names are the canonical provider keys (e.g., `sub-opencode-go-openai`, `sub-opencode-go-anthropic`, `sub-opencode-go-zai`). Required fields per tier: `model`. Optional: `costRatio`, `steps`, `effort`, `prompt`, `variant`, `whenToUse`, `description`.

**Cost ratios are the price signal.** Default ladder is `fast=1`, `medium=5`, `heavy=20`. Set `costRatio` explicitly whenever the relative costs diverge — particularly when one tier uses a pay-per-token route and another uses a bundled subscription. The ladder is provider-agnostic — it expresses *relative* cost, not absolute `$/1M`. Recommended starting points for the default subscription-first constraint:

| Tier          | Model slot                             | costRatio | Rationale                                                              |
| ------------- | -------------------------------------- | --------- | ---------------------------------------------------------------------- |
| Orchestrator  | `<cheap-provider>/<fast-model>`        | 1         | Runs every message — must be cheap; usually the same model as `@fast` |
| `@fast`       | `<cheap-provider>/<fast-model>`        | 1         | Single-shot lookups; cost is the dominant signal                       |
| `@medium`     | `<cheap-provider>/<mid-model>` (or `<heavy-provider>/<mid-model>` if cheap has no mid tier) | 5 | Implementation quality matters; bundled-quota mid is the sweet spot |
| `@heavy`      | `<heavy-provider>/<strong-model>`      | 20        | Reserved for genuinely hard work; the 20× signal discourages overuse    |

The `<fast-model>` / `<mid-model>` / `<strong-model>` slots are concrete model IDs chosen per provider. For opencode-go the fast model is whatever the user has as their default; for Anthropic, the strong model is whatever Claude generation they have API access to (e.g., `claude-opus-4-6`); for Codex auth, it's `gpt-5.2-codex` or whichever Codex variant the auth plugin exposes.

Adjust the ratios after observing one session's actual token spend — the README's cost simulation is illustrative, not benchmarked for the user's specific subscriptions.

### 5. Design the fallback chain

The `fallback.global` block names a provider-to-providers array. When a subagent dispatch fails on provider X, the plugin tries each named fallback in order, then gives up.

For the default `sub-<cheap>-<heavy>` shape, the chain is:

```jsonc
"fallback": {
  "global": {
    "<heavy-provider>": ["<cheap-provider>", "<other-bundled-if-any>", "<free-if-any>"],
    "<cheap-provider>":  ["<other-bundled-if-any>", "<free-if-any>"],
    "<other-provider>":  ["<cheap-provider>", "<free-if-any>"]
  }
}
```

Rules (provider-agnostic):

- The **`<heavy-provider>` entry must list `<cheap-provider>` first**. This is the core subscription-first promise: when the heavy quota hits a hard error, work immediately falls through to the cheap route. Applies regardless of which provider is heavy.
- **Every provider's chain must terminate at an explicitly free endpoint** if any free-tier provider is configured (HuggingFace, etc.). OpenCode's docs note that opencode-go automatically falls back to free models at its own limits — but the router plugin doesn't know that, so the explicit entry is required. If no free-tier is configured, the chain terminates at the cheapest pay-per-token route.
- **Strip entries for providers that aren't configured.** A user with only `<cheap>` and `<heavy>` configured gets a two-entry chain, not a three-entry one.
- The chain is **per-provider**, not per-tier. The plugin does not currently support tier-specific chains; the same fallback applies regardless of which tier the failing dispatch was on. This is fine for the subscription-first design — the failure mode is "this provider is exhausted", not "this tier is exhausted".
- For the `max-throughput` constraint, swap the rule: each provider's chain starts with the *other* provider (so work spreads rather than concentrates). The cheap provider still terminates at a free endpoint.

### 6. Choose the lead-model strategy

The orchestrator is configured in `micode.json` (the `commander` agent, by default). The skill does **not** edit `micode.json` — that is the Pareto skill's scope. But the skill must verify the lead is on the cheap route; otherwise the heavy subscription will be burned on coordination traffic — for *whatever* provider is heavy.

If the lead is currently on the `<heavy-provider>`, **surface this as a recommendation** (not an edit): "your commander is currently on `<heavy-provider>/<model>` — this will burn <heavy-provider> quota on every message, not just heavy work. Run `/optimize-micode` to swap it to the cheap route, then re-run this skill."

The provider-agnostic detection rule: if `micode.json.commander.model.split('/')[0] == <heavy-provider>`, surface the recommendation. Otherwise the lead is already safe — no recommendation needed.

The preset's `@fast` tier can match the lead's model, but the two are independent — the orchestrator is opencode's own concept, not the router's.

### 7. Apply the config

Write the new preset + fallback chain into `~/.config/opencode/opencode-model-router.overrides.jsonc`, deep-merging with any existing content. The plugin's merge semantics:

- Objects merge recursively
- Arrays and scalars replace wholesale
- A malformed override layer is dropped (one bad file never breaks startup)

So the skill can safely add a new `presets.<name>` block alongside any existing presets the user has already configured — it does not touch them.

Use the `Write` tool if the file does not exist. Use the `Edit` tool if it does, targeting the smallest unique substring that contains the `presets` and `fallback` blocks.

### 8. Validate and tell the user to restart

```bash
python3 -c "
import json, re, pathlib
p = pathlib.Path('/Users/squizzeak/.config/opencode/opencode-model-router.overrides.jsonc')
content = p.read_text()
# jsonc — strip comments and trailing commas before parsing
stripped = re.sub(r'//.*', '', re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL))
stripped = re.sub(r',(\s*[}\]])', r'\1', stripped)
try:
    data = json.loads(stripped)
    print('JSONC valid')
    print(f'presets defined: {list(data.get(\"presets\", {}).keys())}')
    print(f'fallback chains: {list(data.get(\"fallback\", {}).get(\"global\", {}).keys())}')
except Exception as e:
    print(f'PARSE ERROR: {e}')
    raise
"
```

Then print the rendered preset as a fenced JSONC block for the user to verify by eye.

Finally, **tell the user to quit and restart opencode** — overrides files are loaded once at startup. The plugin's `/preset <name>` command is the runtime switch after restart.

## What this skill produces

For any `sub-<cheap>-<heavy>` shape, the output is a complete `presets.<name>` block + a `fallback.global` chain, with the slots filled by the user's actual configured providers. Generic template:

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
      "<heavy-provider>": ["<cheap-provider>", "<other-bundled-if-any>"],
      "<cheap-provider>": ["<other-bundled-if-any>", "<free-if-any>"]
    }
  },
  "activePreset": "sub-<cheap>-<heavy>"
}
```

### Concrete examples (for the user to recognize their own shape)

These show the template filled in for several realistic provider pairs. The user's actual rendered output uses their configured names:

**A user with opencode-go + openai (Codex auth) configured:**

```jsonc
{
  "presets": {
    "sub-opencode-go-openai": {
      "fast":   { "model": "opencode-go/<their-cheapest>",  "costRatio": 1,  "steps": 30 },
      "medium": { "model": "opencode-go/<their-mid>",        "costRatio": 5,  "steps": 50 },
      "heavy":  { "model": "openai/gpt-5.2-codex",           "costRatio": 20, "steps": 120, "variant": "high" }
    }
  },
  "fallback": {
    "global": {
      "openai":      ["opencode-go", "github-copilot"],
      "opencode-go": ["github-copilot"]
    }
  },
  "activePreset": "sub-opencode-go-openai"
}
```

**A user with opencode-go + z.ai coding configured:**

```jsonc
{
  "presets": {
    "sub-opencode-go-zai": {
      "fast":   { "model": "opencode-go/<cheap>",  "costRatio": 1,  "steps": 30 },
      "medium": { "model": "opencode-go/<mid>",    "costRatio": 5,  "steps": 50 },
      "heavy":  { "model": "zai/glm-5.6-coding",   "costRatio": 20, "steps": 120, "variant": "high" }
    }
  },
  "fallback": {
    "global": {
      "zai":         ["opencode-go"],
      "opencode-go": ["<free-if-any>"]
    }
  },
  "activePreset": "sub-opencode-go-zai"
}
```

**A user with only opencode-go configured (single-provider):**

```jsonc
{
  "presets": {
    "sub-opencode-go": {
      "fast":   { "model": "opencode-go/<cheap>",  "costRatio": 1,  "steps": 30 },
      "medium": { "model": "opencode-go/<mid>",    "costRatio": 5,  "steps": 50 },
      "heavy":  { "model": "opencode-go/<strong>", "costRatio": 20, "steps": 120 }
    }
  },
  "fallback": {
    "global": {
      "opencode-go": ["<free-if-any>"]
    }
  },
  "activePreset": "sub-opencode-go"
}
```

The skill surfaces the actual model IDs it chose, the cost-ratio reasoning, and the fallback-chain reasoning, all in the printed output. The user reads the rendered JSONC before saving.

## Output format

After applying, print:

1. **Validation result** — JSONC parse + provider-coverage check (every `model` references a configured provider).
2. **Rendered preset** — the full JSONC block that was written, for visual confirmation.
3. **Reasoning table** — one line per tier + one line per fallback chain entry, explaining why this model and this ratio/order.
4. **The lead-recovery gap** — explicit reminder that the plugin cannot auto-recover the lead when its quota exhausts. Include the manual-recovery recipe (which `/preset` command to run).
5. **Restart reminder** — overrides are loaded at startup; the user must quit and restart opencode.

## What this skill does NOT do

- Does **not** modify `~/.config/opencode/micode.json` (the Pareto skill's scope). The two skills complement each other — Pareto picks the static `model` per agent, this skill designs the dynamic tier routing.
- Does **not** author a custom watcher plugin to detect subscription quota reset (Codex 5h window, Copilot monthly cap, per-day API key, etc.). That is a separate engineering task — see the "Engineering the gap closer" section below.
- Does **not** provision API keys, install the opencode-model-router plugin, or set up any subscription auth plugin (Codex, Copilot, z.ai coding, etc.). Those are `opencode.json` changes — surface them as prerequisites, never silently apply.
- Does **not** pick a model on a provider the user has not configured. If the user named `<heavy-provider>` in the strategy but that provider is missing from `configured_providers`, refuse and surface the missing-credential note. Do NOT silently substitute a different provider.
- Does **not** silently fall back to opencode-go or any other "default" provider when the user names a specific provider that isn't configured. The user named it; they meant it; surface the gap.
- Does **not** edit `tiers.json` inside the plugin's cache directory. Always use the overrides file — `tiers.json` is overwritten on every plugin update.

## Engineering the gap closer (optional, separate workflow)

The user may eventually want to close the lead-recovery gap. That requires a separate plugin (provider-agnostic) that:

1. Polls or hooks into whichever provider currently holds the lead role to detect quota-window state. Different providers expose different signals:
   - openai Codex auth: `/usage` endpoint on the Pro/Plus account
   - github-copilot: GitHub's `/copilot_internal/v2/token` quota headers, or the account dashboard
   - zai: per-day request counter on the dashboard
   - direct API keys (Anthropic, OpenAI, DeepSeek, Moonshot, Zhipu, MiniMax): response headers `x-ratelimit-remaining-*`, or the account dashboard
2. Writes a sentinel (env var or `~/.config/opencode/opencode-model-router.state.json`) when a window opens/closes.
3. Triggers a `/preset` switch — or, better, registers a `provider.handoff` that opencode itself honors.

This is non-trivial plugin engineering. The skill **does not** build it. It only points the user at the gap and notes that the closest off-the-shelf workaround is a manual `/preset` switch when they hit quota.

## When to refuse

Refuse to apply the config if:

- The plugin is not installed in `configured_plugins`. Surface the install command; do not write a config the user can't use.
- The named `<cheap-provider>` or `<heavy-provider>` is not in `configured_providers`. Surface the missing-credential setup recipe for *that specific provider* (Codex auth setup, Copilot plugin install, Anthropic API key, etc.). The skill's default constraint requires the user to have at least one bundled subscription plus a heavy subscription — surface the missing prerequisite and offer `min-cost` as a fallback constraint that only requires one subscription.
- A target model ID doesn't resolve against the user's configured providers. Surface as "missing model" with the closest valid suggestion (the plugin's `/router models` output is the canonical source).
- The user's existing overrides file is malformed JSONC — surface the parse error and stop. A typo in the existing file is a separate fix; don't compound it.
- The user requests a config that requires a provider they haven't configured AND won't accept the "would-dominate-if-configured" framing — i.e., they want the skill to apply anyway. Refuse and explain.

Surface the conflict with evidence and let the user decide.
