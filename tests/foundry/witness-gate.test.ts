import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkEquivalence,
  findInterpretationWitness,
  gateInterpretationWitness,
  type Foundation,
  type Interpretation,
  type InterpretationWitness,
  type Term,
} from '../../src/foundry/index.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ================================================================== *
 * REGRESSION: the degenerate interpretation.                          *
 *                                                                     *
 * PRE-FIX BEHAVIOUR, recorded here because the defect is now          *
 * unreachable and this test is the only remaining evidence it existed:*
 *                                                                     *
 *   At commit 3abd2bf and every commit before it, an interpretation   *
 *   was permitted to map every operation to a bare projection         *
 *   variable. Every rule then translated to x = x, which holds        *
 *   vacuously. Both directions "verified". checkEquivalence returned  *
 *   equivalent: true, stage INTERPRETATION_WITNESS_VERIFIED, for the  *
 *   two OBVIOUSLY inequivalent systems below — and screening runs     *
 *   were killing candidates as EQUIVALENT_TO_KNOWN on that basis.     *
 *                                                                     *
 *   Equivalence is terminal. Those were executions with an empty      *
 *   proof.                                                            *
 *                                                                     *
 * To reproduce the RED: `git stash` the witness-gate change and run   *
 * this file against 3abd2bf. The two assertions below invert.         *
 * ================================================================== */

/** down undoes up. Nothing here is a fixed point of anything. */
const RETRACTION: Foundation = {
  id: 'retraction',
  name: 'One-sided retraction',
  primitives: ['token'],
  constants: ['z'],
  operations: [
    { name: 'up', arity: 1 },
    { name: 'down', arity: 1 },
  ],
  rules: [{ id: 'retract', lhs: O('down', O('up', V('x'))), rhs: V('x') }],
  distinct: [],
  invariants: [],
};

/** s fixes z, and says nothing about anything else. */
const FIXPOINT: Foundation = {
  id: 'fixpoint',
  name: 'Pointed unary structure with a fixed point',
  primitives: ['token'],
  constants: ['z'],
  operations: [{ name: 's', arity: 1 }],
  rules: [{ id: 'fix', lhs: O('s', C('z')), rhs: C('z') }],
  distinct: [],
  invariants: [],
};

/** The exact witness the old path accepted: every operation erased. */
function degenerateWitness(a: Foundation, b: Foundation): InterpretationWitness {
  const erase = (from: Foundation, to: Foundation): Interpretation => ({
    from: from.id,
    to: to.id,
    // Every operation goes to its first argument. Every rule collapses.
    operations: Object.fromEntries(from.operations.map((o) => [o.name, V(' arg0')])),
    constants: Object.fromEntries(from.constants.map((c) => [c, C(to.constants[0] ?? c)])),
  });
  return {
    forward: erase(a, b),
    backward: erase(b, a),
    forward_verified: true,
    backward_verified: true,
    forward_unverified_rules: [],
    backward_unverified_rules: [],
    search_budget_spent: 0,
    search_exhausted: true,
  };
}

test('the witness gate refuses an interpretation that erases every operation', () => {
  const result = gateInterpretationWitness(RETRACTION, FIXPOINT, degenerateWitness(RETRACTION, FIXPOINT));

  assert.equal(result.admitted, false, 'the degenerate witness was admitted — the gate is not holding');
  assert.equal(result.failed_condition, 'W1_NON_COLLAPSING');
  assert.ok(result.reason && result.reason.length > 0, 'a rejection must carry its reason');
  assert.deepEqual(
    result.conditions_checked,
    ['W1_NON_COLLAPSING', 'W2_NON_TAUTOLOGICAL', 'W3_BIDIRECTIONAL'],
    'the gate must name every condition it claims to enforce',
  );
});

test('a rejected witness is recorded with its failure, not silently dropped', () => {
  const result = gateInterpretationWitness(RETRACTION, FIXPOINT, degenerateWitness(RETRACTION, FIXPOINT));
  assert.ok(result.detail.forward.erased_operations.includes('up'));
  assert.ok(result.detail.forward.erased_operations.includes('down'));
  assert.equal(
    result.detail.forward.erased_operations.length,
    result.detail.forward.total_operations,
    'every operation should be reported erased',
  );
});

test('two obviously inequivalent systems are not declared equivalent', () => {
  const verdict = checkEquivalence(RETRACTION, FIXPOINT, { interpretation: true });
  assert.equal(
    verdict.equivalent,
    false,
    'a retraction and a fixed-point structure were declared equivalent — the erasure path is live again',
  );
});

test('the honest search never returns a fully-erasing witness', () => {
  const witness = findInterpretationWitness(RETRACTION, FIXPOINT);
  if (witness === null) return; // refusing outright is the strongest possible pass
  const gated = gateInterpretationWitness(RETRACTION, FIXPOINT, witness);
  assert.equal(gated.admitted, false, 'the search returned a witness the gate will not admit');
});
