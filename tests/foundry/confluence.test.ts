import assert from 'node:assert/strict';
import { test } from 'node:test';

import { criticalPairs, confluenceContradiction } from '../../src/foundry/confluence.ts';
import { seedFoundations } from '../../src/foundry/generator.ts';
import type { Foundation, Term } from '../../src/foundry/types.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ------------------------------------------------------------------ *
 * Critical-pair analysis. The point of this module is the third test: *
 * a non-confluence whose two normal forms are declared distinct is    *
 * not a style warning, it is a contradiction proof.                   *
 * ------------------------------------------------------------------ */

test('a confluent rule set is reported confluent within its bound', () => {
  const f: Foundation = {
    id: 'confluent-idempotent',
    name: 'Idempotent unary',
    primitives: ['thing'],
    constants: ['a'],
    operations: [{ name: 'g', arity: 1 }],
    rules: [{ id: 'idem', lhs: O('g', O('g', V('x'))), rhs: O('g', V('x')) }],
    distinct: [],
    invariants: [],
  };
  const report = criticalPairs(f);
  assert.equal(report.status, 'CONFLUENT_WITHIN_BOUND', report.note);
  assert.equal(report.unjoined.length, 0);
  // And the claim is explicitly scoped — local confluence, not a proof.
  assert.match(report.note, /not a termination proof/);
});

test('a genuinely non-confluent overlap is caught with both results recorded', () => {
  // f(g(x)) -> a  and  g(x) -> b  overlap: f(g(x)) goes to `a`, or to f(b).
  const f: Foundation = {
    id: 'non-confluent',
    name: 'Overlapping rules with no common normal form',
    primitives: ['thing'],
    constants: ['a', 'b'],
    operations: [
      { name: 'f', arity: 1 },
      { name: 'g', arity: 1 },
    ],
    rules: [
      { id: 'fg-to-a', lhs: O('f', O('g', V('x'))), rhs: C('a') },
      { id: 'g-to-b', lhs: O('g', V('x')), rhs: C('b') },
    ],
    distinct: [],
    invariants: [],
  };
  const report = criticalPairs(f);
  assert.equal(report.status, 'NON_CONFLUENT', report.note);
  assert.ok(report.unjoined.length > 0);
  const pair = report.unjoined[0]!;
  assert.ok(pair.left_normal_form, 'left side must have normalized');
  assert.ok(pair.right_normal_form, 'right side must have normalized');
  assert.notDeepEqual(pair.left_normal_form, pair.right_normal_form);
  assert.ok(pair.overlap_term, 'the overlapping term itself must be recorded');
});

test('a non-confluence between DECLARED-DISTINCT constants is reported CONTRADICTORY', () => {
  // Same shape as above, but now the system declares a and b distinct — so
  // the divergence is not a style problem, it is an inconsistency.
  const f: Foundation = {
    id: 'confluence-contradiction',
    name: 'Overlap that proves a contradiction',
    primitives: ['thing'],
    constants: ['a', 'b'],
    operations: [
      { name: 'f', arity: 1 },
      { name: 'g', arity: 1 },
    ],
    rules: [
      { id: 'fg-to-a', lhs: O('f', O('g', V('x'))), rhs: C('a') },
      { id: 'g-to-b', lhs: O('g', V('x')), rhs: C('b') },
      { id: 'fb-to-b', lhs: O('f', C('b')), rhs: C('b') },
    ],
    distinct: [['a', 'b']],
    invariants: ['a and b are distinct'],
  };
  const report = criticalPairs(f);
  assert.equal(report.status, 'CONTRADICTORY', report.note);
  assert.ok(report.contradictions.length > 0);
  const found = report.contradictions[0]!;
  assert.deepEqual([...found.contradiction!.pair].sort(), ['a', 'b']);
  assert.match(report.note, /contradiction proof/);

  const shortcut = confluenceContradiction(f);
  assert.ok(shortcut, 'confluenceContradiction must surface the same finding');
  assert.deepEqual([...shortcut!.contradiction!.pair].sort(), ['a', 'b']);
});

test('a budget exhaustion is reported UNKNOWN, never as confluent', () => {
  // A rule that grows its term forever: no side normalizes inside the bound.
  const f: Foundation = {
    id: 'non-terminating',
    name: 'Growing rule set',
    primitives: ['thing'],
    constants: ['a', 'b'],
    operations: [{ name: 'g', arity: 1 }],
    rules: [
      // g(x) -> g(g(x)) never runs out of redex at the root, so nothing
      // underneath it is ever reached.
      { id: 'grow', lhs: O('g', V('x')), rhs: O('g', O('g', V('x'))) },
      { id: 'mark', lhs: O('g', C('a')), rhs: C('b') },
    ],
    distinct: [],
    invariants: [],
  };
  const report = criticalPairs(f, {
    maxNormalizationSteps: 12,
    maxTermSize: 20,
    maxOverlaps: 500,
  });
  assert.equal(report.status, 'UNKNOWN_BUDGET_EXCEEDED', report.note);
  assert.notEqual(report.status, 'CONFLUENT_WITHIN_BOUND');
});

test('every shipped foundation gets a recorded confluence verdict', () => {
  for (const f of seedFoundations()) {
    const report = criticalPairs(f);
    assert.ok(
      ['CONFLUENT_WITHIN_BOUND', 'NON_CONFLUENT', 'CONTRADICTORY', 'UNKNOWN_BUDGET_EXCEEDED'].includes(
        report.status,
      ),
      `${f.id}: unexpected status ${report.status}`,
    );
    assert.ok(report.budget_spent > 0, `${f.id}: no overlaps examined at all`);
    // A shipped foundation must not be silently contradictory.
    assert.notEqual(report.status, 'CONTRADICTORY', `${f.id}: ${report.note}`);
  }
});
