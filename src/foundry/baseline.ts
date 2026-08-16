import {
  applyRuleAt,
  commutativeOps,
  positions,
  termDepth,
  termEqModulo,
  termKey,
} from './kernel.ts';
import { enumerateGroundTerms } from './contradiction.ts';
import type { Foundation, Rule, Term, Trace, TraceStep } from './types.ts';

/* ------------------------------------------------------------------ *
 * Baseline representations — MEASURED, never stipulated.              *
 *                                                                     *
 * The first run's benchmark table was decoration: baseline_value was  *
 * a number chosen at pre-registration time, so "advantage: yes" said  *
 * nothing about the foundation. A baseline has to be an actual        *
 * representation that an actual task actually runs on.                *
 *                                                                     *
 * The conventional representation used here is the ground lookup      *
 * table: the same behavior with every abstraction removed. One        *
 * variable-free rule per reachable ground term, mapping it straight   *
 * to its normal form. It is what you have before you generalize.      *
 * ------------------------------------------------------------------ */

export interface BaselineBound {
  maxDepth: number;
  maxTerms: number;
}

/** Normal form under the declared rules, bounded by fuel. */
export function normalForm(foundation: Foundation, term: Term, fuel = 80): Term {
  const comm = commutativeOps(foundation);
  let current = term;
  for (let i = 0; i < fuel; i += 1) {
    let advanced = false;
    outer: for (const rule of foundation.rules) {
      for (const path of positions(current)) {
        const produced = applyRuleAt(rule, current, path, comm);
        if (produced !== null && !termEqModulo(produced, current, comm)) {
          current = produced;
          advanced = true;
          break outer;
        }
      }
    }
    if (!advanced) break;
  }
  return current;
}

/**
 * The conventional encoding: no variables, no abstraction, one explicit
 * ground equation per reachable term. Bigger, flatter, and dumber on
 * purpose — that is the point of a baseline.
 */
export function buildLookupBaseline(
  foundation: Foundation,
  bound: BaselineBound,
  extraTerms: Term[] = [],
): { foundation: Foundation; rule_count: number; source_terms: number } {
  // The pre-registered goal terms are always included. A baseline that has
  // never seen the task term is not a baseline, it is a handicap, and beating
  // it would prove nothing.
  const terms = [...extraTerms, ...enumerateGroundTerms(foundation, bound)];
  const rules: Rule[] = [];
  const seen = new Set<string>();
  terms.forEach((term, i) => {
    const nf = normalForm(foundation, term);
    if (termEqModulo(term, nf, commutativeOps(foundation))) return; // nothing to look up
    const key = termKey(term);
    if (seen.has(key)) return;
    seen.add(key);
    rules.push({ id: `lookup-${i}`, lhs: term, rhs: nf });
  });
  return {
    foundation: {
      id: `${foundation.id}#baseline-lookup`,
      name: `${foundation.name} — ground lookup table (conventional baseline)`,
      primitives: foundation.primitives,
      constants: foundation.constants,
      operations: foundation.operations,
      rules,
      distinct: foundation.distinct,
      invariants: ['no abstraction: every equation is a variable-free ground instance'],
    },
    rule_count: rules.length,
    source_terms: terms.length,
  };
}

/* ------------------------------------------------------------------ *
 * Task execution — used identically on the foundation and on the      *
 * baseline, so the numbers are comparable.                            *
 * ------------------------------------------------------------------ */

export interface TaskRun {
  reached: boolean;
  steps: number;
  trace: Trace | null;
  /** Rule-firing attempts made by the search. The real cost of the encoding. */
  attempts: number;
  peak_term_size: number;
}

const sizeOf = (t: Term): number =>
  'op' in t ? 1 + t.args.reduce((n, a) => n + sizeOf(a), 0) : 1;

/**
 * Shortest derivation from start to target, breadth-first. Counts every
 * rule-firing attempt, which is where a flat lookup table pays for itself
 * being flat.
 */
export function runTask(
  foundation: Foundation,
  start: Term,
  target: Term,
  maxSteps = 8,
  maxNodes = 20_000,
): TaskRun {
  const comm = commutativeOps(foundation);
  let attempts = 0;
  let peak = sizeOf(start);
  if (termEqModulo(start, target, comm)) {
    return { reached: true, steps: 0, trace: { start, steps: [] }, attempts, peak_term_size: peak };
  }
  const seen = new Set([termKey(start)]);
  const queue: Array<{ term: Term; steps: TraceStep[] }> = [{ term: start, steps: [] }];
  let nodes = 0;

  while (queue.length > 0 && nodes < maxNodes) {
    const node = queue.shift()!;
    nodes += 1;
    if (node.steps.length >= maxSteps) continue;
    for (const rule of foundation.rules) {
      for (const path of positions(node.term)) {
        attempts += 1;
        const produced = applyRuleAt(rule, node.term, path, comm);
        if (produced === null) continue;
        if (termDepth(produced) > 8) continue;
        const key = termKey(produced);
        if (seen.has(key)) continue;
        seen.add(key);
        peak = Math.max(peak, sizeOf(produced));
        const steps = [...node.steps, { rule: rule.id, path, result: produced }];
        if (termEqModulo(produced, target, comm)) {
          return { reached: true, steps: steps.length, trace: { start, steps }, attempts, peak_term_size: peak };
        }
        queue.push({ term: produced, steps });
      }
    }
  }
  return { reached: false, steps: -1, trace: null, attempts, peak_term_size: peak };
}
