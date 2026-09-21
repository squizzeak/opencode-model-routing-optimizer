#!/usr/bin/env bun
/**
 * Executable markdown-contract tests (plan §15).
 *
 * These assert the *written contract* shared by the single shipped skill and
 * its user-facing command mirror — synchronized intake, domain suitability,
 * billing/capacity gates, provenance discipline, the replacement of
 * all-axis dominance, and a §15-compliant acceptance canary.
 *
 * They verify text, not LLM behavior, and they deliberately do NOT require
 * the unsafe `grep … || echo "all models resolve"` canary: a failed CLI also
 * matches nothing, so that idiom reports false success. §15 requires the
 * canary to inspect exit status AND warnings.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

const DOCS = [
  { label: "skill", path: "assets/skills/optimize-micode-models/SKILL.md" },
  { label: "command", path: "assets/command/optimize-micode.md" },
] as const;

/** Collapse all whitespace so wrapped prose compares to a single-line literal. */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const read = (path: string) => readFileSync(`${REPO}/${path}`, "utf8");

/** The two §15 intake questions, verbatim. */
const INTAKE_DIMENSIONS =
  "What dimensions should we be optimizing for (e.g., TTFT, quality, cost, TPS), and in what priority order or weighting?";
const INTAKE_EXPERTISE =
  "What area of expertise should we focus on (e.g., report writing, creative writing, Python programming, Java programming, spreadsheet generation, technical documents, or freeform)?";

/** The §5.6 quota-pool-spreading normative sentence. */
const QUOTA_POOL =
  "When two routes are materially equivalent on every requested priority, prefer assigning them to different agents so load is spread across independent quota pools. Never do this at the expense of a stated priority. Label it quota-pool spreading: static micode assignments are not runtime smooth fallback and must not be described as such (a quota-exhausted provider does not fail over at runtime).";

/** Contract phrases both files must carry (compared whitespace-normalized). */
const SHARED_CONTRACT = [
  INTAKE_DIMENSIONS,
  INTAKE_EXPERTISE,
  "Expertise and each agent's actual responsibilities define suitability and quality evidence before ranking, not merely as tie-breakers.",
  "a rate_limit entry does not by itself prove a subscription",
  "Independently require fresh positive remaining capacity or documented usable account entitlement before recommending a new assignment in any billing mode.",
  "Unknown or stale capacity remains unverified and cannot silently pass unrestricted mode.",
  "No all-axis dominance requirement",
  "Record each claim's source, publication or measurement date, measurement conditions, exclusions, confidence, and gaps",
  QUOTA_POOL,
];

/** Extract the body of every fenced code block (```lang … ```). */
function fencedBlocks(md: string): string[] {
  const blocks: string[] = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) blocks.push(m[1]);
  return blocks;
}

describe("markdown contract — synchronized between skill and command", () => {
  for (const { label, path } of DOCS) {
    describe(label, () => {
      const raw = read(path);
      const text = norm(raw);

      test("is a real, non-empty document", () => {
        expect(raw.length).toBeGreaterThan(1000);
      });

      test("carries every shared contract phrase", () => {
        const missing = SHARED_CONTRACT.filter((phrase) => !text.includes(norm(phrase)));
        expect(missing).toEqual([]);
      });

      test("accepts all four eligibility modes and all six dimension tokens", () => {
        for (const mode of ["unrestricted", "avoid-paygo", "paygo-only", "free-only"]) {
          expect(text).toContain(mode);
        }
        for (const dim of ["ttft", "tps", "quality", "cost", "context", "reliability"]) {
          expect(raw.toLowerCase()).toContain(dim);
        }
      });

      test("unknown classification is excluded from the three constrained modes", () => {
        // Both files bold the word "excluded", so the contiguous fragments to
        // assert are the surrounding phrases, not "excluded from …".
        expect(text).toContain("from the three constrained modes");
        expect(text).toContain("cannot be asserted to qualify");
      });

      test("keeps billing derived, never asked, and unknown never asserted positive", () => {
        expect(text).toContain("never ask");
        expect(text).toContain("unknown billing nature or balance as positive");
      });

      test("preserves the delegation hard gate and exact-edit consent", () => {
        const lower = text.toLowerCase();
        expect(lower).toContain("delegation hard gate");
        expect(lower).toContain("exact-edit consent");
      });

      test("scope is micode.json model fields only — no router/fallback/Pareto wording", () => {
        expect(text).toContain("model");
        expect(raw).not.toMatch(/pareto/i);
        expect(raw).not.toContain("design-fallback-chain");
        expect(text).toContain("router");
      });

      test("canary inspects exit status AND warnings (no false success on CLI error)", () => {
        expect(text).toContain("exit status 0 AND zero");
        expect(text).toContain("warnings");
        // The prohibition is stated explicitly …
        expect(text).toContain("prints a false success");
      });

      test('no executable canary uses the unsafe `|| echo "all models resolve"` shortcut', () => {
        const canaryBlocks = fencedBlocks(raw).filter((b) => b.includes("opencode models"));
        expect(canaryBlocks.length).toBeGreaterThan(0);
        for (const block of canaryBlocks) {
          // §15: capture status separately; never let "grep matched nothing"
          // (which a failed CLI also produces) read as success.
          expect(block).toContain("status=$?");
          expect(block).not.toContain('|| echo "all models resolve"');
          expect(block).not.toContain('echo "all models resolve"');
        }
      });
    });
  }
});
