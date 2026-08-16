import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renameApart, substitute, unify } from '../../src/foundry/index.ts';

const v = (name: string) => ({ v: name });
const c = (name: string) => ({ c: name });
const op = (name: string, ...args: ReturnType<typeof v>[]) => ({ op: name, args });

/* ------------------------------------------------------------------ *
 * First-order unification — the piece FOUNDRY-NEXT.md item 4 flags as *
 * the missing prerequisite for critical-pair confluence checking.     *
 * `match` only lets the pattern side bind; these cases specifically   *
 * exercise both sides binding, occurs-check failure, and unify        *
 * failure on shape mismatch — the three things `match` cannot do.     *
 * ------------------------------------------------------------------ */

test('unifies a variable on each side against each other (both sides bind)', () => {
  // f(x, a) vs f(b, y) unifies with x := b, y := a.
  const a = op('f', v('x'), c('a'));
  const b = op('f', c('b'), v('y'));
  const s = unify(a, b);
  assert.notEqual(s, null);
  assert.deepEqual(substitute(a, s!), op('f', c('b'), c('a')));
  assert.deepEqual(substitute(b, s!), op('f', c('b'), c('a')));
});

test('occurs check rejects a variable unifying with a term containing itself', () => {
  const s = unify(v('x'), op('f', v('x')));
  assert.equal(s, null);
});

test('fails when operators or arities disagree, even under variables', () => {
  assert.equal(unify(op('f', v('x')), op('g', v('x'))), null);
  assert.equal(unify(op('f', v('x'), v('y')), op('f', v('x'))), null);
});

test('a substitution already in scope threads through a later unification call', () => {
  // x is already bound to a from a prior step; unifying f(x) with f(y) must
  // resolve x through that binding rather than treating x as free again.
  const s1 = unify(v('x'), c('a'));
  assert.notEqual(s1, null);
  const s2 = unify(op('f', v('x')), op('f', v('y')), s1!);
  assert.notEqual(s2, null);
  assert.deepEqual(substitute(v('y'), s2!), c('a'));
});

test('renameApart gives two rules that share a variable name disjoint variables', () => {
  const leftIdentity = op('mul', c('e'), v('x'));
  const renamed = renameApart(leftIdentity, '#1');
  assert.deepEqual(renamed, op('mul', c('e'), v('x#1')));
  // Now unifying the original against the renamed copy no longer conflates
  // "x" from one rule with "x" from the other.
  const s = unify(v('x'), renamed);
  assert.notEqual(s, null);
  assert.deepEqual(substitute(v('x'), s!), renamed);
});
