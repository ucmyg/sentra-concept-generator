import { normalForm } from './baseline.ts';
import { applyInterpretation, interpretationCollapses } from './interpretation.ts';
import type { Interpretation, InterpretationWitness } from './interpretation.ts';
import { isApp, isConst, isVar, termEq } from './kernel.ts';
import type { Foundation, Term } from './types.ts';

/* ------------------------------------------------------------------ *
 * THE WITNESS GATE                                                    *
 *                                                                     *
 * EXISTING_EQUIVALENT_FOUND is terminal. It does not weaken a claim,  *
 * it deletes the concept as a re-skin of something already known. So  *
 * its evidence bar is the highest in the machine, not the lowest.     *
 *                                                                     *
 * An interpretation may legally send an operation to a bare           *
 * projection variable. Send EVERY operation that way and every rule   *
 * translates to x = x, which holds vacuously, in both directions,     *
 * between any two systems that have ever been written down. That is   *
 * not a translation. It is an erasure, and for as long as it was      *
 * unguarded it was concluding a terminal verdict on candidates that   *
 * had nothing to do with each other.                                  *
 *                                                                     *
 * This gate runs BEFORE any equivalence is accepted. A witness that   *
 * fails it is not a weaker kill. It is NO kill, recorded as a         *
 * rejected witness carrying the condition it failed.                  *
 * ------------------------------------------------------------------ */

export type WitnessGateCondition =
  /** (a) The interpretation does not send the whole carrier through a
   *      constant or a bare projection — it distinguishes structure. */
  | 'W1_NON_COLLAPSING'
  /** (b) The translated rule set is not uniformly tautological — at least
   *      one axiom lands somewhere whose verification does real work. */
  | 'W2_NON_TAUTOLOGICAL'
  /** (c) Both directions verified independently. One direction alone is an
   *      embedding, never an equivalence. */
  | 'W3_BIDIRECTIONAL';

export const WITNESS_GATE_CONDITIONS: readonly WitnessGateCondition[] = [
  'W1_NON_COLLAPSING',
  'W2_NON_TAUTOLOGICAL',
  'W3_BIDIRECTIONAL',
] as const;

export interface WitnessGateResult {
  /** True only when every condition passed. Nothing else may accept equivalence. */
  admitted: boolean;
  conditions_checked: readonly WitnessGateCondition[];
  failed_condition: WitnessGateCondition | null;
  reason: string | null;
  /** Per-direction detail, always populated, so a rejection is auditable. */
  detail: {
    forward: DirectionReport;
    backward: DirectionReport;
  };
}

export interface DirectionReport {
  /** Operations whose body is a bare projection or a ground constant. */
  erased_operations: string[];
  total_operations: number;
  /** Rules that were non-trivial at the source and landed as reflexive. */
  tautological_rules: string[];
  /** Rules whose verification required real rewriting in the target. */
  working_rules: string[];
  /** Two source terms the interpretation merged, when it merges any. */
  collapse: { source_a: Term; source_b: Term; shared_image: Term } | null;
}

/** A body that mentions no operation carries none of the source's structure. */
function isErasingBody(body: Term): boolean {
  if (isVar(body)) return true;
  if (isConst(body)) return true;
  return false;
}

function inspectDirection(
  source: Foundation,
  target: Foundation,
  interp: Interpretation,
): DirectionReport {
  const erased: string[] = [];
  for (const op of source.operations) {
    const body = interp.operations[op.name];
    if (body === undefined || isErasingBody(body)) erased.push(op.name);
  }

  const tautological: string[] = [];
  const working: string[] = [];
  for (const rule of source.rules) {
    // A rule that was already reflexive at the source is not evidence of
    // erasure — it never said anything to begin with. Only rules that MEANT
    // something and stopped meaning it count against the witness.
    if (termEq(rule.lhs, rule.rhs)) continue;
    const lhs = applyInterpretation(rule.lhs, interp);
    const rhs = applyInterpretation(rule.rhs, interp);
    if (lhs === null || rhs === null) continue;
    if (termEq(lhs, rhs)) {
      tautological.push(rule.id);
      continue;
    }
    // The two sides landed apart and normalization had to close the gap.
    // That is verification doing non-trivial work.
    if (termEq(normalForm(target, lhs), normalForm(target, rhs))) working.push(rule.id);
  }

  return {
    erased_operations: erased,
    total_operations: source.operations.length,
    tautological_rules: tautological,
    working_rules: working,
    collapse: interpretationCollapses(source, target, interp),
  };
}

/**
 * Run the gate. `a` and `b` are the two systems; `witness` is the candidate
 * two-way interpretation between them.
 *
 * Order is deliberate: the cheapest structural refutations run first, and the
 * first failure short-circuits with the condition named. A caller that wants
 * the full picture reads `detail`, which is populated regardless.
 */
export function gateInterpretationWitness(
  a: Foundation,
  b: Foundation,
  witness: InterpretationWitness,
): WitnessGateResult {
  const forward = inspectDirection(a, b, witness.forward);
  const backward = inspectDirection(b, a, witness.backward);
  const detail = { forward, backward };

  const reject = (
    failed_condition: WitnessGateCondition,
    reason: string,
  ): WitnessGateResult => ({
    admitted: false,
    conditions_checked: WITNESS_GATE_CONDITIONS,
    failed_condition,
    reason,
    detail,
  });

  // (a) Non-collapsing.
  for (const [name, d] of [
    ['forward', forward],
    ['backward', backward],
  ] as const) {
    if (d.total_operations > 0 && d.erased_operations.length === d.total_operations) {
      return reject(
        'W1_NON_COLLAPSING',
        `The ${name} interpretation sends every operation (${d.erased_operations.join(', ')}) ` +
          'to a bare projection or constant. It carries no structure across, so it translates nothing.',
      );
    }
    if (d.collapse) {
      return reject(
        'W1_NON_COLLAPSING',
        `The ${name} interpretation merges two terms the source keeps apart. ` +
          'Information was destroyed in translation, which makes this a lossy embedding, not an equivalence.',
      );
    }
  }

  // (b) Non-tautological.
  for (const [name, d] of [
    ['forward', forward],
    ['backward', backward],
  ] as const) {
    if (d.tautological_rules.length > 0) {
      return reject(
        'W2_NON_TAUTOLOGICAL',
        `Under the ${name} interpretation, rule(s) ${d.tautological_rules.join(', ')} ` +
          'that said something at the source land as reflexive identities. They were not translated, they were deleted.',
      );
    }
    if (d.working_rules.length === 0) {
      return reject(
        'W2_NON_TAUTOLOGICAL',
        `No rule survives the ${name} interpretation with any verification work left to do. ` +
          'A witness under which every axiom is free proves nothing.',
      );
    }
  }

  // (c) Bidirectional.
  if (!witness.forward_verified || !witness.backward_verified) {
    return reject(
      'W3_BIDIRECTIONAL',
      'Only one direction verified. That is an embedding, and an embedding is never an equivalence.',
    );
  }

  return {
    admitted: true,
    conditions_checked: WITNESS_GATE_CONDITIONS,
    failed_condition: null,
    reason: null,
    detail,
  };
}
