import {
  isConst,
  isVar,
  positions,
  renameApart,
  replaceAt,
  substitute,
  subtermAt,
  commutativeOps,
  termEqModulo,
  terminationProbe,
  unify,
} from './kernel.ts';
import type { Foundation, Rule, Term } from './types.ts';

/* ------------------------------------------------------------------ *
 * Confluence by critical-pair analysis.                               *
 *                                                                     *
 * The kernel replays traces but says nothing about whether a rule set *
 * converges. Two rules that overlap can send one term to two          *
 * different normal forms. That matters here for a specific reason:    *
 * if those two normal forms are constants the system has DECLARED     *
 * distinct, the non-confluence is not a stylistic defect — it is a    *
 * contradiction, and it must be reported as one.                      *
 *                                                                     *
 * Bounded and honest: an unjoined pair inside the bound is a real     *
 * finding; a budget exhaustion is reported as UNKNOWN, never as       *
 * confluent.                                                          *
 * ------------------------------------------------------------------ */

export interface CriticalPair {
  left_rule: string;
  right_rule: string;
  /** Position inside the left rule's lhs where the right rule overlapped. */
  position: number[];
  overlap_term: Term;
  left_result: Term;
  right_result: Term;
  left_normal_form: Term | null;
  right_normal_form: Term | null;
  joinable: boolean;
  /** Set when the two normal forms are constants the system declares distinct. */
  contradiction: { pair: [string, string] } | null;
  note: string;
}

export type ConfluenceStatus =
  | 'CONFLUENT_WITHIN_BOUND'
  | 'NON_CONFLUENT'
  | 'CONTRADICTORY'
  | 'UNKNOWN_BUDGET_EXCEEDED';

export interface ConfluenceReport {
  foundation_id: string;
  status: ConfluenceStatus;
  pairs_examined: number;
  critical_pairs: CriticalPair[];
  unjoined: CriticalPair[];
  contradictions: CriticalPair[];
  budget_spent: number;
  bound: ConfluenceBound;
  note: string;
}

export interface ConfluenceBound {
  /** Max rewrite steps allowed when normalizing each side of a pair. */
  maxNormalizationSteps: number;
  /** Max term size allowed during normalization. */
  maxTermSize: number;
  /** Max overlaps to examine before giving up and reporting UNKNOWN. */
  maxOverlaps: number;
}

export const DEFAULT_CONFLUENCE_BOUND: ConfluenceBound = {
  maxNormalizationSteps: 60,
  maxTermSize: 60,
  maxOverlaps: 4000,
};

/** Non-variable positions — the only places a rule can overlap another. */
function nonVariablePositions(t: Term): number[][] {
  return positions(t).filter((p) => {
    const sub = subtermAt(t, p);
    return sub !== null && !isVar(sub);
  });
}

function normalizeBounded(
  foundation: Foundation,
  term: Term,
  bound: ConfluenceBound,
): { term: Term | null; reason: string } {
  const probe = terminationProbe(foundation, term, {
    maxSteps: bound.maxNormalizationSteps,
    maxSize: bound.maxTermSize,
  });
  if (probe.status === 'TERMINATED') return { term: probe.final, reason: 'TERMINATED' };
  return { term: null, reason: probe.status };
}

function distinctPairOf(
  foundation: Foundation,
  a: Term | null,
  b: Term | null,
): [string, string] | null {
  if (!a || !b || !isConst(a) || !isConst(b)) return null;
  for (const [x, y] of foundation.distinct) {
    if ((a.c === x && b.c === y) || (a.c === y && b.c === x)) return [x, y];
  }
  return null;
}

/**
 * All critical pairs of a rewrite system. For rules l1 -> r1 and l2 -> r2,
 * at each non-variable position p in l1 where l2 unifies with l1|p, the term
 * sigma(l1) rewrites two ways: to sigma(r1), and to sigma(l1[r2]_p).
 */
export function criticalPairs(
  foundation: Foundation,
  bound: ConfluenceBound = DEFAULT_CONFLUENCE_BOUND,
): ConfluenceReport {
  const pairs: CriticalPair[] = [];
  let examined = 0;
  let spent = 0;
  let budgetExceeded = false;

  for (const r1 of foundation.rules) {
    for (const r2 of foundation.rules) {
      // Rename apart so two rules that both call their variable `x` do not
      // capture each other.
      const l1 = renameApart(r1.lhs, '§1');
      const rhs1 = renameApart(r1.rhs, '§1');
      const l2 = renameApart(r2.lhs, '§2');
      const rhs2 = renameApart(r2.rhs, '§2');

      for (const p of nonVariablePositions(l1)) {
        // The root overlap of a rule with itself is trivial, not critical.
        if (r1.id === r2.id && p.length === 0) continue;
        spent += 1;
        if (spent > bound.maxOverlaps) {
          budgetExceeded = true;
          break;
        }
        const sub = subtermAt(l1, p);
        if (sub === null) continue;
        const sigma = unify(sub, l2);
        if (sigma === null) continue;
        examined += 1;

        const overlap = substitute(l1, sigma);
        const leftResult = substitute(rhs1, sigma);
        const rebuilt = replaceAt(l1, p, rhs2);
        if (rebuilt === null) continue;
        const rightResult = substitute(rebuilt, sigma);

        const comm = commutativeOps(foundation);
        if (termEqModulo(leftResult, rightResult, comm)) continue; // trivially joined

        const leftNf = normalizeBounded(foundation, leftResult, bound);
        const rightNf = normalizeBounded(foundation, rightResult, bound);
        const joinable =
          leftNf.term !== null &&
          rightNf.term !== null &&
          termEqModulo(leftNf.term, rightNf.term, comm);
        const contradictionPair = distinctPairOf(foundation, leftNf.term, rightNf.term);

        pairs.push({
          left_rule: r1.id,
          right_rule: r2.id,
          position: p,
          overlap_term: overlap,
          left_result: leftResult,
          right_result: rightResult,
          left_normal_form: leftNf.term,
          right_normal_form: rightNf.term,
          joinable,
          contradiction: contradictionPair ? { pair: contradictionPair } : null,
          note: joinable
            ? 'both sides reach a common normal form within the bound'
            : leftNf.term === null || rightNf.term === null
              ? `a side did not normalize within the bound (${leftNf.reason}/${rightNf.reason}); ` +
                'this is UNKNOWN, not a proof of divergence'
              : contradictionPair
                ? 'the two normal forms are constants this system declares distinct'
                : 'the two normal forms differ; the rule set is not confluent here',
        });
      }
      if (budgetExceeded) break;
    }
    if (budgetExceeded) break;
  }

  const unjoined = pairs.filter((p) => !p.joinable);
  const contradictions = pairs.filter((p) => p.contradiction !== null);
  const inconclusive = unjoined.filter(
    (p) => p.left_normal_form === null || p.right_normal_form === null,
  );

  let status: ConfluenceStatus;
  let note: string;
  if (contradictions.length > 0) {
    status = 'CONTRADICTORY';
    note =
      'A critical pair sends one term to two constants the system declares distinct. ' +
      'This is a contradiction proof, not a confluence warning.';
  } else if (budgetExceeded) {
    status = 'UNKNOWN_BUDGET_EXCEEDED';
    note = `Overlap budget of ${bound.maxOverlaps} exhausted. Not confluent, not non-confluent — unknown.`;
  } else if (inconclusive.length > 0) {
    status = 'UNKNOWN_BUDGET_EXCEEDED';
    note =
      `${inconclusive.length} critical pair(s) did not normalize within the bound. ` +
      'A bound exhaustion is never reported as confluence.';
  } else if (unjoined.length > 0) {
    status = 'NON_CONFLUENT';
    note = `${unjoined.length} critical pair(s) reach different normal forms.`;
  } else {
    status = 'CONFLUENT_WITHIN_BOUND';
    note =
      `All ${examined} critical pair(s) joined within the bound. Local confluence only — ` +
      'this is not a termination proof and not global confluence.';
  }

  return {
    foundation_id: foundation.id,
    status,
    pairs_examined: examined,
    critical_pairs: pairs,
    unjoined,
    contradictions,
    budget_spent: spent,
    bound,
    note,
  };
}

/** Convenience: does this rule set contain a critical pair proving a contradiction? */
export function confluenceContradiction(
  foundation: Foundation,
  bound: ConfluenceBound = DEFAULT_CONFLUENCE_BOUND,
): CriticalPair | null {
  const report = criticalPairs(foundation, bound);
  return report.contradictions[0] ?? null;
}
