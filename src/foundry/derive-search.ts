import { enumerateGroundTerms } from './contradiction.ts';
import { applyRuleAt, positions, termDepth, termKey } from './kernel.ts';
import type { Foundation, Term, Trace, TraceStep } from './types.ts';

/* ------------------------------------------------------------------ *
 * Consequence search.                                                 *
 *                                                                     *
 * Derivations are found by actually running the rules, never written  *
 * by hand and asserted. Whatever comes back has already replayed once *
 * by construction, and is replayed again by the kernel on admission.  *
 * ------------------------------------------------------------------ */

export interface DerivationCriteria {
  minSteps: number;
  minDistinctRules: number;
  maxSearchDepth: number;
  maxStartTerms: number;
}

const DEFAULTS: DerivationCriteria = {
  minSteps: 2,
  minDistinctRules: 2,
  maxSearchDepth: 5,
  maxStartTerms: 250,
};

export function searchDerivation(
  foundation: Foundation,
  criteria: Partial<DerivationCriteria> = {},
): Trace | null {
  const c = { ...DEFAULTS, ...criteria };
  const starts = enumerateGroundTerms(foundation, { maxDepth: 4, maxTerms: c.maxStartTerms });

  for (const start of starts) {
    const seen = new Set([termKey(start)]);
    const queue: Array<{ term: Term; steps: TraceStep[] }> = [{ term: start, steps: [] }];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (
        node.steps.length >= c.minSteps &&
        new Set(node.steps.map((s) => s.rule)).size >= c.minDistinctRules
      ) {
        return { start, steps: node.steps };
      }
      if (node.steps.length >= c.maxSearchDepth) continue;
      for (const rule of foundation.rules) {
        for (const path of positions(node.term)) {
          const produced = applyRuleAt(rule, node.term, path);
          if (produced === null) continue;
          if (termDepth(produced) > 7) continue;
          const key = termKey(produced) + `|${node.steps.length}`;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({
            term: produced,
            steps: [...node.steps, { rule: rule.id, path, result: produced }],
          });
        }
      }
    }
  }
  return null;
}
