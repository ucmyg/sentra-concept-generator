import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SCREEN_BOUNDS,
  measure,
  preregister,
  screenCandidate,
  type Foundation,
} from '../../src/foundry/index.ts';
import { levelCeiling, LEVEL_NAMES, type LevelEvidence } from '../../src/foundry/levels.ts';

const v = (name: string) => ({ v: name });
const c = (name: string) => ({ c: name });
const op = (name: string, ...args: { v: string }[] | { c: string }[] | object[]) => ({
  op: name,
  args: args as never,
});

/* ------------------------------------------------------------------ *
 * PROJECT GENESIS — Charter v2, Phase 0 / M0.                         *
 *                                                                     *
 * Three gates the charter makes law that the M0 audit found either    *
 * unreachable or unenforced. Written to fail against the code as it   *
 * stands, so that passing means the gate actually closed.             *
 * ------------------------------------------------------------------ */

/* --- Gate 1: the screening gauntlet's termination check is reachable --- */

const LOOPING_PARENT: Foundation = {
  id: 'loop-parent',
  name: 'Parent with one constant and one declared unary operation',
  primitives: ['token'],
  constants: ['unit'],
  operations: [{ name: 'mark', arity: 1 }],
  rules: [{ id: 'mark-unit', lhs: op('mark', c('unit')), rhs: c('unit') }],
  distinct: [],
  invariants: ['mark collapses unit'],
};

test('a candidate whose rule can never reach a normal form dies as NON_TERMINATING', () => {
  // gen_u(x) -> gen_u(gen_u(x)) strictly grows the term at every application.
  // It is information-preserving, consistent, and distinct — every question
  // the gauntlet asks after termination would be asked of a system in which
  // nothing normalizes. The termination gate exists to stop that.
  const result = screenCandidate(
    LOOPING_PARENT,
    { id: 'divergent', lhs: op('gen_u', v('x')), rhs: op('gen_u', op('gen_u', v('x'))) },
    { name: 'gen_u', arity: 1 },
    [LOOPING_PARENT],
    0,
    DEFAULT_SCREEN_BOUNDS,
  );
  assert.equal(result.outcome, 'NON_TERMINATING');
  assert.ok(result.detail.length > 0, 'a death must record why it died');
});

/* --- Gate 2: a benchmark refuses to run without a valid pre-registration --- */

const SPEC = {
  id: 'bench-law',
  task: 'connect a declared start/target pair under the parent foundation',
  metric: 'reasoning_steps' as const,
  baseline_representation: 'GROUND_LOOKUP_TABLE' as const,
  baseline_bound: { maxDepth: 3, maxTerms: 60 },
  comparison: 'LOWER_IS_BETTER' as const,
  margin: 2,
  held_out: false,
  goals: [
    {
      foundation_id: 'loop-parent',
      start: op('mark', c('unit')),
      target: c('unit'),
      description: 'mark(unit) collapses to unit',
    },
  ],
};

test('measure() refuses a pre-registration lock whose hash does not match its own spec', () => {
  const honest = preregister(SPEC as never, '2026-08-16T00:00:00.000Z');
  // The failure mode this guards: a spec written AFTER seeing the numbers,
  // stamped with a hash that was never computed from it.
  const forged = { ...honest, margin: 1, results: [] };
  assert.throws(
    () => measure(forged as never, LOOPING_PARENT),
    /PREREGISTRATION_HASH_MISMATCH/,
    'a post-hoc edited spec must not be measurable',
  );
});

test('measure() refuses a spec carrying no lock at all', () => {
  const unlocked = { ...SPEC, preregistered_at: '2026-08-16T00:00:00.000Z', prereg_hash: '', results: [] };
  assert.throws(
    () => measure(unlocked as never, LOOPING_PARENT),
    /PREREGISTRATION_HASH_MISSING/,
  );
});

test('measure() accepts an untouched lock', () => {
  const honest = preregister(SPEC as never, '2026-08-16T00:00:00.000Z');
  const result = measure(honest, LOOPING_PARENT);
  assert.equal(result.prereg_hash, honest.prereg_hash);
});

/* --- Gate 3: the level scale, and the default-down rule --- */

const BASE: LevelEvidence = {
  formalized: false,
  reduction: 'NOT_ATTEMPTED',
  benchmark: 'NOT_RUN',
};

test('every level 0 through 7 has a declared name', () => {
  for (let n = 0; n <= 7; n += 1) assert.ok(LEVEL_NAMES[n as 0], `level ${n} unnamed`);
});

test('a concept with no recorded reduction attempt cannot climb above level 1', () => {
  const out = levelCeiling(5, { ...BASE, formalized: true });
  assert.equal(out.level, 1);
  assert.equal(out.capped, true);
  assert.match(out.reason, /REDUCTION_ATTACK_NOT_ATTEMPTED/);
});

test('a lossless embedding caps the candidate at level 2 however loudly it is claimed', () => {
  const out = levelCeiling(6, { ...BASE, formalized: true, reduction: 'LOSSLESS_EMBEDDING' });
  assert.equal(out.level, 2);
  assert.match(out.reason, /LOSSLESS_EMBEDDING/);
});

test('surviving the reduction attack opens level 3 and 4 but not level 5', () => {
  const ev: LevelEvidence = { formalized: true, reduction: 'NO_EMBEDDING_FOUND', benchmark: 'NOT_RUN' };
  assert.equal(levelCeiling(4, ev).level, 4);
  assert.equal(levelCeiling(4, ev).capped, false);
  const five = levelCeiling(5, ev);
  assert.equal(five.level, 4);
  assert.match(five.reason, /NO_PREREGISTERED_ADVANTAGE/);
});

test('level 5 requires a pre-registered benchmark advantage, and a null result is not one', () => {
  const survived: LevelEvidence = {
    formalized: true,
    reduction: 'NO_EMBEDDING_FOUND',
    benchmark: 'PREREGISTERED_NO_ADVANTAGE',
  };
  assert.equal(levelCeiling(5, survived).level, 4);
  const won: LevelEvidence = { ...survived, benchmark: 'PREREGISTERED_ADVANTAGE' };
  assert.equal(levelCeiling(5, won).level, 5);
  assert.equal(levelCeiling(5, won).capped, false);
});

test('an unformalized artifact cannot exceed level 0 — prose is not a representational change', () => {
  const out = levelCeiling(1, { ...BASE, reduction: 'NO_EMBEDDING_FOUND' });
  assert.equal(out.level, 0);
  assert.match(out.reason, /NOT_FORMALIZED/);
});

test('a claimed level below the ceiling is never silently raised to it', () => {
  const won: LevelEvidence = {
    formalized: true,
    reduction: 'NO_EMBEDDING_FOUND',
    benchmark: 'PREREGISTERED_ADVANTAGE',
  };
  const out = levelCeiling(2, won);
  assert.equal(out.level, 2, 'classify down when uncertain; evidence permits, it does not compel');
  assert.equal(out.capped, false);
});
