import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkEquivalence,
  findInterpretationWitness,
  type Foundation,
  type Term,
} from '../../src/foundry/index.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ------------------------------------------------------------------ *
 * The degenerate interpretation.                                      *
 *                                                                     *
 * An interpretation may map an operation to any term of the target,   *
 * including a bare projection variable. Map EVERY operation that way  *
 * and every rule translates to x = x, which holds vacuously — so both *
 * directions "verify" and any two systems on earth are declared       *
 * equivalent.                                                         *
 *                                                                     *
 * This is the dangerous direction. INTERPRETATION_WITNESS_VERIFIED is *
 * one of only two stages permitted to conclude equivalence, and       *
 * equivalence is terminal: it kills the concept as a re-skin. A       *
 * vacuous witness does not weaken a claim, it destroys real work.     *
 * ------------------------------------------------------------------ */

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

test('an interpretation that erases every operation is not a witness', () => {
  const witness = findInterpretationWitness(RETRACTION, FIXPOINT);
  if (witness) {
    assert.ok(
      !(witness.forward_verified && witness.backward_verified),
      'a two-way verified witness between these two systems is vacuous: they are not ' +
        'the same structure, and only an operation-erasing interpretation says they are',
    );
  }
});

test('a one-sided retraction is not declared equivalent to a fixed point', () => {
  const verdict = checkEquivalence(RETRACTION, FIXPOINT, {
    interpretation: true,
    maxModelSize: 3,
  });
  assert.equal(verdict.equivalent, false);
});

test('an interpretation may not collapse terms the source keeps apart', () => {
  // In RETRACTION, up(z) and z are not provably equal — no rule connects them.
  // Any interpretation sending up to the identity makes them the same term.
  // That is information destroyed in translation, which is the definition of
  // a lossy embedding, and a lossy embedding is not an equivalence.
  const witness = findInterpretationWitness(RETRACTION, FIXPOINT);
  if (witness?.forward_verified) {
    const body = witness.forward.operations['up'];
    assert.ok(
      body !== undefined && !('v' in body),
      'up was interpreted as a bare projection — the operation was deleted, not translated',
    );
  }
});

test('a genuine re-skin is still caught — the fix must not blind the checker', () => {
  // Same structure, different names. This MUST still come back equivalent,
  // otherwise the cure is worse than the disease.
  const MONOID_A: Foundation = {
    id: 'mon-a',
    name: 'monoid A',
    primitives: [],
    constants: ['e'],
    operations: [{ name: 'op', arity: 2 }],
    rules: [
      { id: 'l', lhs: O('op', C('e'), V('x')), rhs: V('x') },
      { id: 'r', lhs: O('op', V('x'), C('e')), rhs: V('x') },
      {
        id: 'a',
        lhs: O('op', O('op', V('x'), V('y')), V('z')),
        rhs: O('op', V('x'), O('op', V('y'), V('z'))),
      },
    ],
    distinct: [],
    invariants: [],
  };
  const MONOID_B: Foundation = {
    ...MONOID_A,
    id: 'mon-b',
    name: 'monoid B',
    constants: ['unit'],
    operations: [{ name: 'join', arity: 2 }],
    rules: [
      { id: 'l', lhs: O('join', C('unit'), V('x')), rhs: V('x') },
      { id: 'r', lhs: O('join', V('x'), C('unit')), rhs: V('x') },
      {
        id: 'a',
        lhs: O('join', O('join', V('x'), V('y')), V('z')),
        rhs: O('join', V('x'), O('join', V('y'), V('z'))),
      },
    ],
  };
  const verdict = checkEquivalence(MONOID_A, MONOID_B, { interpretation: true, maxModelSize: 3 });
  assert.equal(verdict.equivalent, true, 'a pure rename must still be caught');
});

test('a definitional re-skin via interpretation is still caught', () => {
  // B defines a redundant operation out of A's: twice(x) = op(x,x). The two
  // systems really are inter-definable, and the interpretation path is the
  // only thing that can see it. This must survive the fix.
  const BASE: Foundation = {
    id: 'base-invol',
    name: 'involution',
    primitives: [],
    constants: [],
    operations: [{ name: 'f', arity: 1 }],
    rules: [{ id: 'i', lhs: O('f', O('f', V('x'))), rhs: V('x') }],
    distinct: [],
    invariants: [],
  };
  const RENAMED: Foundation = {
    id: 'renamed-invol',
    name: 'flip',
    primitives: [],
    constants: [],
    operations: [{ name: 'flip', arity: 1 }],
    rules: [{ id: 'i', lhs: O('flip', O('flip', V('x'))), rhs: V('x') }],
    distinct: [],
    invariants: [],
  };
  const verdict = checkEquivalence(BASE, RENAMED, { interpretation: true, maxModelSize: 3 });
  assert.equal(verdict.equivalent, true);
});
