import { sha256, stableStringify } from '../canonical-json.ts';

import { applyRuleAt, positions, replayTrace, termSize } from './kernel.ts';
import { enumerateGroundTerms } from './contradiction.ts';
import type { Consequence, Foundation, Rule, Term, Trace } from './types.ts';

/* ------------------------------------------------------------------ *
 * Benchmark framework.                                                *
 *                                                                     *
 * Rule before result. A benchmark is pre-registered — task, metric,   *
 * baseline representation, success threshold — and hashed. Every      *
 * result carries the prereg hash, so a post-hoc benchmark cannot be   *
 * passed off as a prediction.                                         *
 * ------------------------------------------------------------------ */

export type BenchmarkMetric =
  | 'reasoning_steps'
  | 'memory'
  | 'computation'
  | 'compositionality'
  | 'expressiveness';

export interface BenchmarkSpec {
  id: string;
  task: string;
  metric: BenchmarkMetric;
  baseline_representation: string;
  baseline_value: number;
  /** Direction of improvement. */
  lower_is_better: boolean;
  success_threshold: number;
}

export interface BenchmarkResult {
  benchmark_id: string;
  prereg_hash: string;
  foundation_id: string;
  metric: BenchmarkMetric;
  baseline: number;
  measured: number;
  advantage: boolean;
  detail: string;
}

export interface PreregisteredBenchmark extends BenchmarkSpec {
  preregistered_at: string;
  prereg_hash: string;
  results: BenchmarkResult[];
}

export function preregister(spec: BenchmarkSpec, at: string): PreregisteredBenchmark {
  const prereg_hash = sha256(stableStringify({ ...spec, preregistered_at: at }));
  return { ...spec, preregistered_at: at, prereg_hash, results: [] };
}

export interface MeasurementInput {
  foundation: Foundation;
  consequences: Consequence[];
}

export function measure(
  benchmark: PreregisteredBenchmark,
  input: MeasurementInput,
): BenchmarkResult {
  const { foundation, consequences } = input;
  let measured = 0;
  let detail = '';

  switch (benchmark.metric) {
    case 'reasoning_steps': {
      const steps = consequences.map((c) => c.trace.steps.length);
      measured = steps.length === 0 ? 0 : steps.reduce((a, b) => a + b, 0) / steps.length;
      detail = `mean kernel steps over ${steps.length} recorded derivations`;
      break;
    }
    case 'memory': {
      const sizes = consequences.map((c) => replayTrace(foundation, c.trace).max_term_size);
      measured = sizes.length === 0 ? 0 : Math.max(...sizes);
      detail = 'peak term size held during replay';
      break;
    }
    case 'computation': {
      measured = countRewriteAttempts(foundation, consequences.map((c) => c.trace));
      detail = 'rule-firing attempts required to reproduce the recorded derivations';
      break;
    }
    case 'compositionality': {
      const ops = foundation.operations.filter((o) => o.arity >= 1).length;
      const composable = foundation.rules.filter((r) => termSize(r.lhs) > 2).length;
      measured = ops === 0 ? 0 : composable / ops;
      detail = 'declared rules acting on composite terms per operation';
      break;
    }
    case 'expressiveness': {
      const terms = enumerateGroundTerms(foundation, { maxDepth: 3, maxTerms: 120 });
      const normalForms = new Set(terms.map((t) => stableStringify(normalize(foundation, t))));
      measured = normalForms.size;
      detail = `distinct normal forms among ${terms.length} bounded ground terms`;
      break;
    }
  }

  const advantage = benchmark.lower_is_better
    ? measured <= benchmark.success_threshold
    : measured >= benchmark.success_threshold;

  const result: BenchmarkResult = {
    benchmark_id: benchmark.id,
    prereg_hash: benchmark.prereg_hash,
    foundation_id: foundation.id,
    metric: benchmark.metric,
    baseline: benchmark.baseline_value,
    measured,
    advantage,
    detail,
  };
  benchmark.results.push(result);
  return result;
}

function countRewriteAttempts(foundation: Foundation, traces: Trace[]): number {
  let attempts = 0;
  for (const trace of traces) {
    attempts += trace.steps.length * Math.max(1, foundation.rules.length);
  }
  return attempts;
}

/** Leftmost-outermost normalization, bounded. Used only for measurement. */
export function normalize(foundation: Foundation, term: Term, fuel = 60): Term {
  let current = term;
  for (let i = 0; i < fuel; i += 1) {
    let changed = false;
    for (const rule of foundation.rules) {
      const next = tryRewrite(rule, current);
      if (next !== null) {
        current = next;
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return current;
}

function tryRewrite(rule: Rule, term: Term): Term | null {
  for (const path of positions(term)) {
    const produced = applyRuleAt(rule, term, path);
    if (produced !== null && stableStringify(produced) !== stableStringify(term)) return produced;
  }
  return null;
}
