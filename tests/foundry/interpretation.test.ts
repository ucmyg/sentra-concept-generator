import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkEquivalence, findWitness } from '../../src/foundry/equivalence.ts';
import { findInterpretationWitness } from '../../src/foundry/interpretation.ts';
import type { Foundation, Term } from '../../src/foundry/types.ts';

import { MONOID_FOUNDATION } from './helpers.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ------------------------------------------------------------------ *
 * A DEFINED re-skin: same monoid, plus a new operation `sq` that is   *
 * nothing but mul(x, x) under a new name. New name, zero new formal   *
 * behavior. The bijection witness cannot see it — the signatures no   *
 * longer match, so that search never runs.                            *
 * ------------------------------------------------------------------ */

const DEFINED_RESKIN: Foundation = {
  id: 'squared-monoid',
  name: 'Squared monoid (a monoid with a defined operation bolted on)',
  primitives: ['element', 'composition', 'squaring'],
  constants: ['e'],
  operations: [
    { name: 'mul', arity: 2 },
    { name: 'sq', arity: 1 },
  ],
  rules: [
    { id: 'left-identity', lhs: O('mul', C('e'), V('x')), rhs: V('x') },
    { id: 'right-identity', lhs: O('mul', V('x'), C('e')), rhs: V('x') },
    {
      id: 'assoc',
      lhs: O('mul', O('mul', V('x'), V('y')), V('z')),
      rhs: O('mul', V('x'), O('mul', V('y'), V('z'))),
    },
    { id: 'sq-def', lhs: O('sq', V('x')), rhs: O('mul', V('x'), V('x')) },
  ],
  distinct: [],
  invariants: ['sq is definitionally mul(x, x) and adds nothing'],
};

test('the bijection witness CANNOT catch a defined re-skin — this is the gap', () => {
  assert.equal(
    findWitness(DEFINED_RESKIN, MONOID_FOUNDATION),
    null,
    'if this ever returns a witness the gap has closed and this test should change',
  );
  const withoutInterpretation = checkEquivalence(DEFINED_RESKIN, MONOID_FOUNDATION, {
    maxModelSize: 3,
  });
  assert.equal(withoutInterpretation.equivalent, false);
  assert.equal(withoutInterpretation.stage, 'SIGNATURE_MISMATCH');
});

test('the interpretation witness catches it, verified in both directions', () => {
  const witness = findInterpretationWitness(DEFINED_RESKIN, MONOID_FOUNDATION, {
    maxBodySize: 3,
  });
  assert.ok(witness, 'no interpretation witness found for a definitional re-skin');
  assert.equal(witness!.forward_verified, true, JSON.stringify(witness!.forward_unverified_rules));
  assert.equal(witness!.backward_verified, true, JSON.stringify(witness!.backward_unverified_rules));
  assert.deepEqual(witness!.forward_unverified_rules, []);
  assert.deepEqual(witness!.backward_unverified_rules, []);
});

test('the staged checker reports INTERPRETATION_WITNESS_VERIFIED when enabled', () => {
  const verdict = checkEquivalence(DEFINED_RESKIN, MONOID_FOUNDATION, {
    maxModelSize: 3,
    interpretation: true,
  });
  assert.equal(verdict.equivalent, true, `stage was ${verdict.stage}`);
  assert.equal(verdict.stage, 'INTERPRETATION_WITNESS_VERIFIED');
  assert.ok(verdict.interpretation_witness);
  assert.equal(verdict.interpretation_witness!.forward_verified, true);
  assert.equal(verdict.interpretation_witness!.backward_verified, true);
});

/* ------------------------------------------------------------------ *
 * A genuinely different structure must NOT be swallowed by the same   *
 * search. The interpretation stage has to be able to say no.          *
 * ------------------------------------------------------------------ */

const GENUINELY_DIFFERENT: Foundation = {
  id: 'absorbing-structure',
  name: 'Absorbing structure — every product collapses to the constant',
  primitives: ['element', 'absorption'],
  constants: ['z'],
  operations: [{ name: 'mul', arity: 2 }],
  rules: [
    { id: 'absorb-left', lhs: O('mul', C('z'), V('x')), rhs: C('z') },
    { id: 'absorb-right', lhs: O('mul', V('x'), C('z')), rhs: C('z') },
    {
      id: 'assoc',
      lhs: O('mul', O('mul', V('x'), V('y')), V('z2')),
      rhs: O('mul', V('x'), O('mul', V('y'), V('z2'))),
    },
  ],
  distinct: [],
  invariants: ['the constant absorbs rather than acting as an identity'],
};

test('an absorbing structure is not swallowed as an interpretation of a monoid', () => {
  const verdict = checkEquivalence(GENUINELY_DIFFERENT, MONOID_FOUNDATION, {
    maxModelSize: 3,
    interpretation: true,
  });
  assert.equal(
    verdict.equivalent,
    false,
    `absorbing structure wrongly reported equivalent at stage ${verdict.stage}`,
  );
});

test('a one-directional interpretation is an embedding, never an equivalence', () => {
  // A unary-only system embeds into a monoid (dbl(x) := mul(x,x)) but the
  // monoid has no binary operation to come back to.
  const UNARY_ONLY: Foundation = {
    id: 'unary-only',
    name: 'Unary doubling only',
    primitives: ['element', 'doubling'],
    constants: ['e'],
    operations: [{ name: 'dbl', arity: 1 }],
    rules: [{ id: 'dbl-e', lhs: O('dbl', C('e')), rhs: C('e') }],
    distinct: [],
    invariants: [],
  };
  const verdict = checkEquivalence(UNARY_ONLY, MONOID_FOUNDATION, {
    maxModelSize: 3,
    interpretation: true,
  });
  assert.equal(verdict.equivalent, false, `stage ${verdict.stage}`);
  if (verdict.interpretation_witness) {
    assert.equal(
      verdict.interpretation_witness.forward_verified &&
        verdict.interpretation_witness.backward_verified,
      false,
      'a two-way witness must not verify between structures of different expressive power',
    );
  }
});
