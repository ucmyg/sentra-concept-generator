import assert from 'node:assert/strict';
import { test } from 'node:test';

import { terminationProbe, type Foundation } from '../../src/foundry/index.ts';

import { MONOID_FOUNDATION } from './helpers.ts';

const v = (name: string) => ({ v: name });
const c = (name: string) => ({ c: name });
const op = (name: string, ...args: ReturnType<typeof v>[]) => ({ op: name, args });

/* ------------------------------------------------------------------ *
 * FOUNDRY-NEXT.md Priority 2 item 4 — termination probe.               *
 * Written before the implementation was wired into any caller; these   *
 * three cases are the ones the design note calls out: a term that      *
 * genuinely normalizes, a rule set that provably cannot terminate      *
 * under this reduction order, and a blow-up caught by the size bound   *
 * rather than the step bound.                                          *
 * ------------------------------------------------------------------ */

test('a monoid term normalizes and TERMINATED reports the reached normal form', () => {
  const start = op('mul', op('mul', v('x'), c('e')), v('y'));
  const result = terminationProbe(MONOID_FOUNDATION, start);
  assert.equal(result.status, 'TERMINATED');
  assert.notEqual(result.final, null);
  // right-identity then nothing left to fire: mul(mul(x,e),y) -> mul(x,y)
  assert.deepEqual(result.final, op('mul', v('x'), v('y')));
});

test('a rule that strictly grows the term every application is caught as NON_TERMINATING_WITHIN_BOUND', () => {
  const DIVERGENT: Foundation = {
    id: 'divergent',
    name: 'A single rule that never reaches a normal form',
    primitives: ['token'],
    constants: ['a'],
    operations: [{ name: 'f', arity: 1 }],
    rules: [{ id: 'grow', lhs: op('f', v('x')), rhs: op('f', op('f', v('x'))) }],
    distinct: [],
    invariants: [],
  };
  const result = terminationProbe(DIVERGENT, op('f', c('a')), { maxSteps: 50, maxSize: 100_000 });
  assert.equal(result.status, 'NON_TERMINATING_WITHIN_BOUND');
  assert.equal(result.final, null);
  assert.equal(result.steps_taken, 50);
});

test('a rule whose term size explodes faster than the step bound is caught as SIZE_EXCEEDED, not silently accepted', () => {
  const DOUBLING: Foundation = {
    id: 'doubling',
    name: 'A rule that doubles term size each step',
    primitives: ['token'],
    constants: ['a'],
    operations: [{ name: 'g', arity: 1 }],
    rules: [{ id: 'double', lhs: op('g', v('x')), rhs: op('g', op('g', v('x'))) }],
    distinct: [],
    invariants: [],
  };
  const result = terminationProbe(DOUBLING, op('g', c('a')), { maxSteps: 10_000, maxSize: 50 });
  assert.equal(result.status, 'SIZE_EXCEEDED');
  assert.equal(result.final, null);
  assert.ok(result.max_term_size > 50);
});
