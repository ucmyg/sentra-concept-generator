import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  KNOWN_TEMPLATES,
  REDUCTION_TARGET_COVERAGE,
  reductionAttack,
  type Foundation,
  type Term,
} from '../../src/foundry/index.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ------------------------------------------------------------------ *
 * Charter v2 §11 — The Reduction Attack.                              *
 *                                                                     *
 * "Every candidate concept is presumed to be existing mathematics     *
 * wearing a new name until proven otherwise — and you are the         *
 * prosecution." The prosecution has to actually show up: a verdict of *
 * NO_EMBEDDING_FOUND means nothing without the attempted embeddings   *
 * attached, and it means nothing if the room we tried to escape into  *
 * was almost empty.                                                   *
 * ------------------------------------------------------------------ */

test('the target library covers more than a handful of structures', () => {
  assert.ok(
    KNOWN_TEMPLATES.length >= 12,
    `four templates is not a room worth escaping; got ${KNOWN_TEMPLATES.length}`,
  );
  const ids = new Set(KNOWN_TEMPLATES.map((t) => t.id));
  assert.equal(ids.size, KNOWN_TEMPLATES.length, 'template ids must be unique');
});

test('every declared target is internally well-formed: rules only mention its own signature', () => {
  for (const t of KNOWN_TEMPLATES) {
    const ops = new Set(t.operations.map((o) => o.name));
    const consts = new Set(t.constants);
    const walk = (term: Term): void => {
      if ('op' in term) {
        assert.ok(ops.has(term.op), `${t.id} rule mentions undeclared op ${term.op}`);
        const arity = t.operations.find((o) => o.name === term.op)!.arity;
        assert.equal(term.args.length, arity, `${t.id}: arity mismatch on ${term.op}`);
        term.args.forEach(walk);
      } else if ('c' in term) {
        assert.ok(consts.has(term.c), `${t.id} rule mentions undeclared constant ${term.c}`);
      }
    };
    for (const r of t.rules) {
      walk(r.lhs);
      walk(r.rhs);
    }
  }
});

test('a renamed copy of a known structure is caught as a LOSSLESS_EMBEDDING', () => {
  // A monoid with the symbols swapped out. This is the whole failure mode
  // the attack exists to catch: new names, identical behaviour.
  const RESKIN: Foundation = {
    id: 'candidate:reskin',
    name: 'Sequential composition of actions with a null action',
    primitives: ['action'],
    constants: ['idle'],
    operations: [{ name: 'then', arity: 2 }],
    rules: [
      { id: 'l', lhs: O('then', C('idle'), V('x')), rhs: V('x') },
      { id: 'r', lhs: O('then', V('x'), C('idle')), rhs: V('x') },
      {
        id: 'a',
        lhs: O('then', O('then', V('x'), V('y')), V('z')),
        rhs: O('then', V('x'), O('then', V('y'), V('z'))),
      },
    ],
    distinct: [],
    invariants: ['composition is associative and idle does nothing'],
  };
  const report = reductionAttack(RESKIN);
  assert.equal(report.outcome, 'LOSSLESS_EMBEDDING');
  assert.equal(report.witness_target, 'template:monoid');
  assert.ok(report.attempts.length >= 12, 'every attempt must be recorded, not just the hit');
});

test('a structure that is genuinely none of the targets survives, with the failed attempts attached', () => {
  // Two unary operations, one of which undoes the other only in one order.
  // Not a monoid, not a group, not an involution, not a band.
  const ODD: Foundation = {
    id: 'candidate:odd',
    name: 'One-sided retraction',
    primitives: ['token'],
    constants: ['z'],
    operations: [
      { name: 'up', arity: 1 },
      { name: 'down', arity: 1 },
    ],
    rules: [{ id: 'retract', lhs: O('down', O('up', V('x'))), rhs: V('x') }],
    distinct: [],
    invariants: ['down undoes up; up does not undo down'],
  };
  const report = reductionAttack(ODD);
  assert.equal(report.outcome, 'NO_EMBEDDING_FOUND');
  assert.equal(report.witness_target, null);
  assert.equal(
    report.attempts.length,
    KNOWN_TEMPLATES.length,
    'a survived attack must record an attempt against every declared target',
  );
  assert.ok(
    report.attempts.every((a) => a.notes.length > 0),
    'each failed embedding must say why it failed',
  );
});

test('an attack with no targets is NOT_ATTEMPTED, never a survival', () => {
  const ANY: Foundation = {
    id: 'candidate:any',
    name: 'anything',
    primitives: [],
    constants: ['z'],
    operations: [{ name: 'f', arity: 1 }],
    rules: [{ id: 'r', lhs: O('f', C('z')), rhs: C('z') }],
    distinct: [],
    invariants: [],
  };
  const report = reductionAttack(ANY, []);
  assert.equal(report.outcome, 'NOT_ATTEMPTED');
  assert.equal(report.attempts.length, 0);
});

test('target coverage is declared honestly: what the target language cannot express is named', () => {
  const families = REDUCTION_TARGET_COVERAGE.map((c) => c.family);
  // Charter §11 names these eight explicitly.
  for (const required of [
    'sets',
    'relations',
    'functions',
    'graphs',
    'algebraic structures',
    'automata',
    'probability spaces',
    'programs',
  ]) {
    assert.ok(families.includes(required), `§11 family not accounted for: ${required}`);
  }
  for (const c of REDUCTION_TARGET_COVERAGE) {
    assert.ok(c.rationale.length > 0, `${c.family}: coverage claim without a rationale`);
    if (c.status === 'COVERED') {
      assert.ok(c.targets.length > 0, `${c.family}: claimed covered with no target`);
      for (const id of c.targets) {
        assert.ok(
          KNOWN_TEMPLATES.some((t) => t.id === id),
          `${c.family}: names a target that does not exist: ${id}`,
        );
      }
    }
  }
  // The honest part: at least one family must be admitted as out of reach,
  // because equational rewriting cannot express a probability space.
  assert.ok(
    REDUCTION_TARGET_COVERAGE.some((c) => c.status === 'NOT_EXPRESSIBLE_IN_TARGET_LANGUAGE'),
    'a coverage table with no gaps is a coverage table nobody checked',
  );
});

test('a NO_EMBEDDING_FOUND verdict carries the coverage caveat with it', () => {
  const ODD: Foundation = {
    id: 'candidate:odd2',
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
  const report = reductionAttack(ODD);
  assert.ok(
    report.caveat.includes('NOT_EXPRESSIBLE_IN_TARGET_LANGUAGE') ||
      report.caveat.length > 40,
    'survival must be reported alongside the limits of what it was tested against',
  );
});
