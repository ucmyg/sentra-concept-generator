import { sha256, stableStringify } from '../canonical-json.ts';

import { buildLookupBaseline, normalForm, runTask, type BaselineBound } from './baseline.ts';
import { enumerateGroundTerms } from './contradiction.ts';
import type { Foundation, Term } from './types.ts';

/* ------------------------------------------------------------------ *
 * Benchmark framework.                                                *
 *                                                                     *
 * Rule before result. What is pre-registered and hashed is the RULE:  *
 * the task, the metric, the goal pair, the baseline representation,   *
 * and the margin that counts as an advantage.                         *
 *                                                                     *
 * What is NOT pre-registered is the baseline VALUE — that is measured *
 * by running the same task on the conventional representation. A      *
 * stipulated baseline measures nothing, which is exactly what the     *
 * first run's table did.                                              *
 * ------------------------------------------------------------------ */

export type BenchmarkMetric =
  | 'reasoning_steps'
  | 'memory'
  | 'computation'
  | 'compositionality'
  | 'expressiveness';

/** A fixed start/target pair, declared before the run. */
export interface BenchmarkGoal {
  foundation_id: string;
  start: Term;
  target: Term;
  description: string;
}

export interface BenchmarkSpec {
  id: string;
  task: string;
  metric: BenchmarkMetric;
  baseline_representation: 'GROUND_LOOKUP_TABLE';
  baseline_bound: BaselineBound;
  comparison: 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER';
  /** How much the foundation must beat the measured baseline by to claim an advantage. */
  margin: number;
  /**
   * Held-out: the goal terms are NOT given to the baseline lookup table.
   * A memorized table trivially wins any task it has already memorized, so a
   * seeded benchmark only measures memorization. Generalization is the thing
   * an abstraction is supposed to buy, and this is where it is tested.
   */
  held_out: boolean;
  goals: BenchmarkGoal[];
}

export interface BenchmarkResult {
  benchmark_id: string;
  prereg_hash: string;
  foundation_id: string;
  metric: BenchmarkMetric;
  baseline_source: 'MEASURED_GROUND_LOOKUP_TABLE';
  baseline: number;
  measured: number;
  advantage: boolean;
  status:
    | 'MEASURED'
    | 'GOAL_UNREACHABLE'
    | 'NO_GOAL_DECLARED'
    | 'BASELINE_CANNOT_REPRESENT'
    | 'FOUNDATION_CANNOT_REACH';
  detail: string;
}

export interface PreregisteredBenchmark extends BenchmarkSpec {
  preregistered_at: string;
  prereg_hash: string;
  results: BenchmarkResult[];
}

export function preregister(spec: BenchmarkSpec, at: string): PreregisteredBenchmark {
  if (!(spec.margin > 0)) {
    throw new Error(
      `BENCHMARK_MARGIN_MUST_BE_POSITIVE:${spec.id} — a margin of zero lets a tie register ` +
        'as an advantage, which is how a null result gets reported as a win.',
    );
  }
  const prereg_hash = sha256(stableStringify({ ...spec, preregistered_at: at }));
  return { ...spec, preregistered_at: at, prereg_hash, results: [] };
}

function goalFor(benchmark: BenchmarkSpec, foundationId: string): BenchmarkGoal | undefined {
  return benchmark.goals.find((g) => foundationId.startsWith(g.foundation_id));
}

export function measure(
  benchmark: PreregisteredBenchmark,
  foundation: Foundation,
): BenchmarkResult {
  const goalSeed = benchmark.held_out
    ? []
    : benchmark.goals
        .filter((g) => foundation.id.startsWith(g.foundation_id))
        .flatMap((g) => [g.start, g.target]);
  const baselineBuild = buildLookupBaseline(foundation, benchmark.baseline_bound, goalSeed);
  const baselineFoundation = baselineBuild.foundation;

  const emit = (
    baseline: number,
    measured: number,
    status: BenchmarkResult['status'],
    detail: string,
  ): BenchmarkResult => {
    // Strictly better by at least the pre-registered margin. A tie is not an
    // advantage, and margin is required to be positive at pre-registration.
    const better =
      benchmark.comparison === 'LOWER_IS_BETTER'
        ? measured < baseline - (benchmark.margin - 1)
        : measured > baseline + (benchmark.margin - 1);
    const result: BenchmarkResult = {
      benchmark_id: benchmark.id,
      prereg_hash: benchmark.prereg_hash,
      foundation_id: foundation.id,
      metric: benchmark.metric,
      baseline_source: 'MEASURED_GROUND_LOOKUP_TABLE',
      baseline,
      measured,
      advantage:
        status === 'BASELINE_CANNOT_REPRESENT' ? true : status === 'MEASURED' && better,
      status,
      detail,
    };
    benchmark.results.push(result);
    return result;
  };

  const goal = goalFor(benchmark, foundation.id);

  switch (benchmark.metric) {
    case 'reasoning_steps':
    case 'memory':
    case 'computation': {
      if (!goal) {
        return emit(0, 0, 'NO_GOAL_DECLARED', 'No pre-registered goal pair for this foundation.');
      }
      const own = runTask(foundation, goal.start, goal.target);
      const base = runTask(baselineFoundation, goal.start, goal.target);
      if (own.reached && !base.reached) {
        // The abstraction solves a task the flat table has no entry for.
        // This is the only shape of result that actually demonstrates an
        // advantage from generalizing rather than from memorizing.
        return emit(
          -1,
          benchmark.metric === 'reasoning_steps'
            ? own.steps
            : benchmark.metric === 'memory'
              ? own.peak_term_size
              : own.attempts,
          'BASELINE_CANNOT_REPRESENT',
          `held-out goal "${goal.description}": the ${baselineBuild.rule_count}-rule ground ` +
            'lookup table has no entry covering it; the foundation reaches it by generalizing.',
        );
      }
      if (!own.reached) {
        return emit(-1, -1, 'FOUNDATION_CANNOT_REACH', `goal "${goal.description}" unreachable by the foundation itself`);
      }
      if (!base.reached) {
        return emit(-1, -1, 'GOAL_UNREACHABLE', `goal "${goal.description}" unreachable by both`);
      }
      if (benchmark.metric === 'reasoning_steps') {
        return emit(
          base.steps,
          own.steps,
          'MEASURED',
          `steps to connect a pre-registered start/target pair; baseline is a ${baselineBuild.rule_count}-rule ground lookup table`,
        );
      }
      if (benchmark.metric === 'memory') {
        return emit(
          base.peak_term_size,
          own.peak_term_size,
          'MEASURED',
          'peak term size held while connecting the pre-registered goal pair',
        );
      }
      return emit(
        base.attempts,
        own.attempts,
        'MEASURED',
        `rule-firing attempts to connect the goal pair; baseline carries ${baselineBuild.rule_count} ground rules`,
      );
    }

    case 'compositionality': {
      // Fraction of rules that act on composite terms rather than naming a
      // single case. A ground lookup table scores structurally lower because
      // every one of its rules is a single case.
      const composite = (f: Foundation): number =>
        f.rules.length === 0
          ? 0
          : f.rules.filter((r) => hasVariable(r.lhs)).length / f.rules.length;
      return emit(
        composite(baselineFoundation),
        composite(foundation),
        'MEASURED',
        'fraction of rules stated over variables rather than a single ground case',
      );
    }

    case 'expressiveness': {
      const distinctNormalForms = (f: Foundation, source: Foundation): number => {
        const terms = enumerateGroundTerms(source, benchmark.baseline_bound);
        return new Set(terms.map((t) => stableStringify(normalForm(f, t)))).size;
      };
      return emit(
        distinctNormalForms(baselineFoundation, foundation),
        distinctNormalForms(foundation, foundation),
        'MEASURED',
        'distinct normal forms over the same bounded set of ground terms',
      );
    }
  }
}

function hasVariable(t: Term): boolean {
  if ('v' in t) return true;
  if ('op' in t) return t.args.some(hasVariable);
  return false;
}
