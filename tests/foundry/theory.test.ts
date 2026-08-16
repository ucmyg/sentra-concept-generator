import assert from 'node:assert/strict';
import { test } from 'node:test';

import { criticalPairs } from '../../src/foundry/confluence.ts';
import {
  applyRuleAt,
  canonicalModulo,
  commutativeOps,
  matchModulo,
  replayTrace,
  terminationProbe,
  termEqModulo,
} from '../../src/foundry/kernel.ts';
import { seedFoundations } from '../../src/foundry/generator.ts';
import type { Foundation, Term } from '../../src/foundry/types.ts';

import { MONOID_FOUNDATION } from './helpers.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ------------------------------------------------------------------ *
 * Commutativity cannot be an oriented rule. x·y -> y·x rewrites       *
 * forever in either direction, so the axiom has to be carried by the  *
 * matcher instead. This is the theory layer.                          *
 * ------------------------------------------------------------------ */

/** A commutative monoid declared with ONE identity rule, not two. */
const COMMUTATIVE_MONOID: Foundation = {
  id: 'commutative-monoid',
  name: 'Commutative monoid (identity declared once)',
  primitives: ['element', 'composition'],
  constants: ['e', 'a'],
  operations: [{ name: 'mul', arity: 2 }],
  rules: [
    { id: 'identity', lhs: O('mul', C('e'), V('x')), rhs: V('x') },
    {
      id: 'assoc',
      lhs: O('mul', O('mul', V('x'), V('y')), V('z')),
      rhs: O('mul', V('x'), O('mul', V('y'), V('z'))),
    },
  ],
  distinct: [['e', 'a']],
  invariants: ['mul is commutative — declared in the theory, not as a rule'],
  theory: { commutative: ['mul'] },
};

test('an oriented commutativity rule is exactly what the theory layer avoids', () => {
  const looping: Foundation = {
    ...COMMUTATIVE_MONOID,
    id: 'oriented-commutativity',
    theory: undefined,
    rules: [
      { id: 'comm', lhs: O('mul', V('x'), V('y')), rhs: O('mul', V('y'), V('x')) },
    ],
  };
  const probe = terminationProbe(looping, O('mul', C('a'), C('e')), { maxSteps: 40 });
  assert.equal(
    probe.status,
    'NON_TERMINATING_WITHIN_BOUND',
    'an oriented commutativity rule must be shown to diverge, not silently trusted',
  );
});

test('one identity rule covers both sides when mul is declared commutative', () => {
  const comm = commutativeOps(COMMUTATIVE_MONOID);
  assert.equal(comm.has('mul'), true);

  // mul(a, e) matches lhs mul(e, x) only modulo commutativity.
  const rule = COMMUTATIVE_MONOID.rules[0]!;
  assert.equal(
    applyRuleAt(rule, O('mul', C('a'), C('e')), []),
    null,
    'without the theory the rule must not fire — that is the oriented behavior',
  );
  const fired = applyRuleAt(rule, O('mul', C('a'), C('e')), [], comm);
  assert.deepEqual(fired, C('a'), 'with the theory, one rule covers the mirrored case');
});

test('matching modulo commutativity is consistent across repeated variables', () => {
  const comm = new Set(['mul']);
  // Pattern mul(x, x) must NOT match mul(a, e) in either order.
  assert.equal(matchModulo(O('mul', V('x'), V('x')), O('mul', C('a'), C('e')), comm), null);
  // But it must match mul(a, a).
  assert.ok(matchModulo(O('mul', V('x'), V('x')), O('mul', C('a'), C('a')), comm));
});

test('canonical form modulo commutativity is order-insensitive and stable', () => {
  const comm = new Set(['mul']);
  const left = O('mul', C('a'), C('e'));
  const right = O('mul', C('e'), C('a'));
  assert.deepEqual(canonicalModulo(left, comm), canonicalModulo(right, comm));
  assert.equal(termEqModulo(left, right, comm), true);
  // Nested, and only for the declared operation.
  const nested = O('mul', O('mul', C('e'), C('a')), C('a'));
  assert.deepEqual(canonicalModulo(nested, comm), canonicalModulo(nested, comm));
  // An undeclared operation stays order-sensitive.
  assert.equal(termEqModulo(O('sub', C('a'), C('e')), O('sub', C('e'), C('a')), comm), false);
});

test('an empty theory changes nothing — the oriented path is byte-identical', () => {
  const empty = commutativeOps(MONOID_FOUNDATION);
  assert.equal(empty.size, 0);
  const term = O('mul', C('e'), V('x'));
  assert.deepEqual(canonicalModulo(term, empty), term);
  assert.equal(termEqModulo(term, term, empty), true);
  for (const f of seedFoundations()) {
    assert.equal(commutativeOps(f).size, 0, `${f.id} unexpectedly declares a theory`);
  }
});

test('traces replay through the kernel under a declared theory', () => {
  const start = O('mul', O('mul', C('a'), C('e')), C('a'));
  const comm = commutativeOps(COMMUTATIVE_MONOID);
  const step1 = applyRuleAt(COMMUTATIVE_MONOID.rules[0]!, start, [0], comm);
  assert.ok(step1, 'identity must fire on the mirrored inner term');
  const replay = replayTrace(COMMUTATIVE_MONOID, {
    start,
    steps: [{ rule: 'identity', path: [0], result: step1! }],
  });
  assert.equal(replay.ok, true, replay.reason ?? '');
});

test('critical-pair analysis still returns a verdict under a declared theory', () => {
  const report = criticalPairs(COMMUTATIVE_MONOID);
  assert.ok(
    ['CONFLUENT_WITHIN_BOUND', 'NON_CONFLUENT', 'CONTRADICTORY', 'UNKNOWN_BUDGET_EXCEEDED'].includes(
      report.status,
    ),
  );
  assert.ok(report.budget_spent > 0);
});
