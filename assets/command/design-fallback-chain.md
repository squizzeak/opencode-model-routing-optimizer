---
description: Design a subscription-aware routing config for `opencode-model-router`. Writes a new `presets.<name>` block plus a `fallback.global` chain into `~/.config/opencode/opencode-model-router.overrides.jsonc`. Provider-agnostic: the strategy is `sub-<cheap>-<heavy>` with friendly provider names (`go`, `openai`, `codex`, `claude`, `copilot`, `zai`, `kimi`, `deepseek`, `gemini`, `grok`, `groq`, `minimax`, `openrouter`, `hf`, etc.) resolved against the user's configured providers in `opencode.json`. Default when `$ARGUMENTS` is empty: `sub-<cheapest-bundled>-<largest-subscription>` inferred from the user's configured providers. Reserved keywords: `max-throughput`, `min-cost`, `custom`.
agent: commander
---

<!-- routing-optimizer:version=0.1.2 -->

# /design-fallback-chain

You are running the `/design-fallback-chain` slash command. Your job is to design a subscription-aware tier-routing config for `opencode-model-router` and write it to the user's overrides file. This is the **dynamic-routing** sibling of `/optimize-micode` — that command picks a static `model` per agent in `micode.json`, this one designs a preset whose tiers are chosen at runtime per task.

## Step 1 — Load the skill

Load and follow the **`design-fallback-chain`** skill in its entirety. That skill contains the plugin-capability analysis (what `opencode-model-router` can and cannot do), the two-tier architecture, the preset-design rules, the fallback-chain design rules, the lead-recovery gap, the output format, and the refuse rules. Do not duplicate any of that here — the skill is the source of truth.

After loading, **return briefly to the user** with one line confirming the skill loaded, then proceed.

## Step 2 — Parse `$ARGUMENTS`

`$ARGUMENTS` is the full text the user typed after `/design-fallback-chain`. It may be empty. Parse it into:

| Slot | Recognized values                                                              | Default            |
| ---- | ------------------------------------------------------------------------------ | ------------------ |
| Preset strategy | `sub-<cheap>-<heavy>` (any pair of provider identifiers) / `sub-<provider>` / `max-throughput` / `min-cost` / `custom` | inferred: `sub-<cheapest-bundled>-<largest-subscription>` |
| Override file target | `global` / `project`                                                     | `global` (writes to `~/.config/opencode/opencode-model-router.overrides.jsonc`) |

### Provider identifier resolution

Tokens inside the strategy are resolved against the user's `configured_providers` via this alias table (matches the skill's table — extend if you encounter new aliases):

| Friendly name(s) | Canonical `provider.*` key |
| ---------------- | -------------------------- |
| `go`, `opencode-go` | `opencode-go` |
| `openai`, `gpt`, `codex` | `openai` |
| `claude`, `anthropic` | `anthropic` |
| `copilot`, `github`, `github-copilot` | `github-copilot` |
| `zai`, `z.ai`, `zai-coding` | `zai` |
| `kimi`, `moonshot` | `moonshot` |
| `deepseek` | `deepseek` |
| `google`, `gemini` | `google` |
| `grok`, `xai` | `xai` |
| `groq` | `groq` |
| `minimax` | `minimax` |
| `openrouter` | `openrouter` |
| `anyscale` | `anyscale` |
| `hf`, `huggingface`, `free` | `huggingface` |

Resolution rules (apply in order):

1. **Lowercase** the token, strip any `/<model>` suffix (treat `claude/opus-4.6` as `name=claude, model=opus-4.6`).
2. **Match against the alias table** — unique match → use the canonical key.
3. **If the canonical key isn't in `configured_providers`** → refuse with the missing-credential setup recipe for that specific provider (Codex auth setup, Copilot plugin install, Anthropic API key, z.ai coding plan, etc.). Do NOT silently substitute a different provider.
4. **If the input doesn't match any alias** → treat the input as a literal `provider.*` key and check `configured_providers` directly. Unique match → use it. No match → refuse with "not configured, here's what's configured: ...".
5. **If still ambiguous** → ask the user once with `pick_one` listing the closest configured providers.

### Strategy shapes

| Shape                                            | Meaning                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `sub-<cheap>-<heavy>`                            | Two-provider subscription-first preset. `<cheap>` and `<heavy>` are resolved identifiers; the canonical preset name is `sub-<canonical-cheap>-<canonical-heavy>` (e.g., `claude codex` → `sub-anthropic-openai`). |
| `sub-<provider>`                                 | Single-provider preset — every tier on `<provider>`, fallback chain just adds free endpoints. Use when the user has only one subscription. |
| `max-throughput`                                 | Reserved keyword. Spread work across all bundled subscriptions in parallel roles; the user is asked for each tier via `pick_one`. |
| `min-cost`                                       | Reserved keyword. Treat all quotas as precious; design the preset on the cheapest route with free-tier fallback. Reserved regardless of provider. |
| `custom`                                         | Reserved keyword. Ask once via `pick_one` for each tier's `(provider, model)` before designing. |

Reserved keywords always win over provider-name matching. If the user types `max-throughput openai`, parse as `[strategy=max-throughput, scope=openai]` (or, if `openai` is a configured provider, treat `openai` as an additional scope filter and use it as the heavy provider).

### Token parsing rules

- Empty `$ARGUMENTS` → both defaults. The default strategy is inferred in step 3 by inspecting `configured_providers` and applying the skill's "cheapest bundled" / "largest subscription" heuristics.
- One token → reserved keyword if it matches one; otherwise treat as a `sub-<cheap>` shape with the heavy provider inferred (single-provider fallback to `free`).
- Two tokens of the form `sub X` → `sub-<X>` strategy, scope defaults to `global`.
- Two tokens of the form `sub-X Y` → `sub-X-Y` strategy (the `-` is part of the strategy name).
- Three or more tokens → first token is the strategy shape; the rest is the override file target + any extra scope filters. Apply left-to-right parsing: `sub-X-Y global` = `[strategy=sub-X-Y, scope=global]`, `sub-X-Y project` = `[strategy=sub-X-Y, scope=project]`, `sub-X-Y global extra` = refuse (too many positional args).
- If a strategy's `<cheap>` or `<heavy>` resolves to a configured provider, that's the strategy to apply.
- If a strategy's `<cheap>` or `<heavy>` does NOT resolve → refuse and ask once with `pick_one` listing the user's configured providers.
- Unrecognized shapes: ask the user once with `pick_one` before proceeding. Do not guess.

If the user typed a free-form concern (e.g., "codex quota exhausted every afternoon, design around that" or "I have HF free + opencode-go"), treat that as an extra constraint note to surface in step 3 alongside the standard slots.

## Step 3 — Run the skill workflow

Execute every step of the `design-fallback-chain` skill in order:

1. Inventory current state (`opencode.json` providers, `micode.json` lead, current overrides file).
2. Use the strategy and override file target parsed in step 2 above (do not re-ask).
3. Validate the target models resolve against the user's configured providers.
4. Design the preset (which provider/model for each of @fast/@medium/@heavy, plus cost ratios).
5. Design the fallback chain (per-provider failover order).
6. Choose the lead-model strategy — **this is where the lead-mismatch pause lives**.
7. Apply the config via `Write` (new file) or `Edit` (existing file).
8. Validate JSONC and tell the user to restart.

For each step, follow the skill's instructions exactly — including the **refuse-and-surface** rules for missing providers, unresolvable model IDs, malformed existing overrides, and "apply anyway" requests.

### Lead-mismatch pause (step 6)

The skill's step 6 says: if the orchestrator (`commander` agent in `micode.json`) is currently on the heavy-subscription provider, surface as a recommendation — do not edit micode.json.

The detection rule is **provider-agnostic**: if `micode.json.commander.model.split('/')[0] == <heavy-provider>` (the heavy provider resolved in step 2), surface the recommendation. This applies regardless of whether the heavy provider is `openai` (Codex), `anthropic` (Claude API), `github-copilot` (Copilot), `zai` (z.ai coding), or any other configured subscription.

The command must **honor this as an explicit pause**, not a silent proceed. Concretely: when the skill detects the lead is on the heavy-subscription provider, the command emits a one-line note specifying WHICH provider is at risk (e.g., "your commander is currently on `openai/gpt-5.2-codex` — this will burn your ChatGPT Pro quota on every message, not just heavy work") and offers two follow-up branches via `pick_one`:

- **Generate anyway + recommend /optimize-micode** — proceed to write the preset; the new preset will be correct, but the lead will still burn heavy-subscription quota on every message until the user separately runs `/optimize-micode` to swap the lead.
- **Abort, run /optimize-micode first** — stop the command here. The Pareto sibling swaps the lead to the cheap route, then this command can be re-run and the lead will already be safe.

Default the pick to the first option (proceed with the preset). The user can branch to "abort" if they want a clean ordering.

## Step 4 — Render output

After validation, print the skill's full output format:

1. **Validation result** — JSONC parse + provider-coverage check (every `model` references a configured provider).
2. **Rendered preset** — the full JSONC block that was written, for visual confirmation by eye.
3. **Reasoning table** — one line per tier + one line per fallback chain entry, explaining the model choice and the ratio/order.
4. **The lead-recovery gap** — explicit reminder that the plugin cannot auto-recover the lead when its quota exhausts. Include the manual-recovery recipe: which `/preset` command to run when the user hits a quota window.
5. **Restart reminder** — overrides are loaded at startup; the user must quit and restart opencode.

If the skill refuses (missing prerequisites, unresolvable model, malformed file), print the refuse reason plainly and stop. Do not write a partial config.

## Step 5 — Offer follow-ups

After rendering, briefly offer three next-step options via `pick_one`:

- **Apply + restart** — confirm the preset was written; remind the user to quit and restart opencode. Note that if they had a different preset active before (state file), they may also need to run `/preset sub-<canonical-cheap>-<canonical-heavy>` (or whichever strategy they chose) at runtime, since the state file wins over override defaults.
- **Lead first** — if a lead-mismatch was detected, route to `/optimize-micode` first to swap the orchestrator to the cheap route, then re-run this command. Skip if no lead mismatch was detected.
- **Tighten / change strategy** — re-run with a different preset strategy, a different `<cheap>`/`<heavy>` pair, or `custom` to specify each tier by hand.

If the user picked "Apply + restart" or the conversation is wrapping, finish with a one-line summary using the resolved canonical preset name (e.g., "preset `sub-opencode-go-openai` written to global overrides — quit and restart opencode, then `/preset sub-opencode-go-openai` if you had another preset active before").

## Argument examples

- `/design-fallback-chain` — default inferred from configured providers. Typical result for a user with opencode-go + openai configured: `sub-opencode-go-openai`, written to global overrides.
- `/design-fallback-chain go codex` — friendly form; resolved to `sub-opencode-go-openai` (since `go` → `opencode-go` and `codex` → `openai`).
- `/design-fallback-chain go claude` — `sub-opencode-go-anthropic` (Anthropic API key for heavy, opencode-go for cheap).
- `/design-fallback-chain go copilot` — `sub-opencode-go-github-copilot` (GitHub Copilot for heavy, opencode-go for cheap).
- `/design-fallback-chain go zai` — `sub-opencode-go-zai` (z.ai coding for heavy, opencode-go for cheap).
- `/design-fallback-chain go kimi` — `sub-opencode-go-moonshot` (Moonshot/Kimi for heavy, opencode-go for cheap).
- `/design-fallback-chain go` — `sub-opencode-go` (single-provider preset; every tier on opencode-go).
- `/design-fallback-chain max-throughput` — spread work across all bundled subscriptions in parallel roles; user is asked for each tier.
- `/design-fallback-chain min-cost` — cheapest route with free-tier fallback; ignore heavy quotas.
- `/design-fallback-chain custom` — prompt for each tier's `(provider, model)` explicitly.
- `/design-fallback-chain go codex project` — write to `<repo>/.opencode/opencode-model-router.overrides.jsonc` instead of the global file (useful for team-shared config).
- `/design-fallback-chain sub-opencode-go-openai global` — explicit canonical form of the most common default.

Mixed forms work too: `/design-fallback-chain sub-go-codex` is parsed as `strategy=sub-go-codex`, not as `sub-go` + `codex`, because the `-` is part of the strategy name. If the user wants the latter, they should write `sub go codex` with spaces.

## What this command does NOT do

- Does **not** modify `~/.config/opencode/micode.json` — that is the `/optimize-micode` command's scope. If a lead mismatch is detected, the command recommends `/optimize-micode`; it never edits the file itself.
- Does **not** author a custom watcher plugin to detect subscription quota reset (Codex 5h window, Copilot monthly cap, per-day API key, etc.). That is a separate engineering task — the skill's "Engineering the gap closer" section explains what that would entail.
- Does **not** provision API keys, install `opencode-model-router`, or set up any subscription auth plugin (Codex, Copilot, z.ai coding, Anthropic API key, etc.). Surface as prerequisites and refuse if missing.
- Does **not** edit `tiers.json` inside the plugin's cache directory. Always uses the overrides file — `tiers.json` is overwritten on every plugin update.
- Does **not** pick a model on a provider the user has not configured. Refuses and surfaces the missing-credential note instead — does NOT silently fall back to opencode-go or any other "default" provider.

If `$ARGUMENTS` requests something outside the skill's scope (e.g., "rewrite my agent prompts", "add a new subagent", "install the Codex auth plugin"), refuse and route the user back to the `customize-opencode` parent skill or to a fresh request.
