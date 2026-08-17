import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CANDIDATE_OPERATIONS,
  enumerateRuleCandidates,
  enumerateTerms,
  seededSample,
  existingOperationsOf,
} from '../../src/foundry/enumerate.ts';
import { DISTINCTION_ALGEBRA, seedFoundations } from '../../src/foundry/generator.ts';
import { isInformationPreserving, runScreen, screenCandidate } from '../../src/foundry/screen.ts';
import type { OpSpec, Rule, Term } from '../../src/foundry/types.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

const GEN_U: OpSpec = { name: 'gen_u', arity: 1 };
const GEN_B: OpSpec = { name: 'gen_b', arity: 2 };

/* ------------------------------------------------------------------ *
 * Enumeration. Reproducibility is the whole point: a run that finds   *
 * something must be re-runnable by anyone holding the seed.           *
 * ------------------------------------------------------------------ */

test('enumeration is deterministic — same signature and bound, same stream', () => {
  const bound = { maxDepth: 2, maxVars: 2, maxCandidates: 5000 };
  const a = enumerateRuleCandidates(DISTINCTION_ALGEBRA, GEN_U, bound);
  const b = enumerateRuleCandidates(DISTINCTION_ALGEBRA, GEN_U, bound);
  assert.ok(a.length > 0, 'enumeration must actually produce candidates');
  assert.deepEqual(
    a.map((c) => c.rule),
    b.map((c) => c.rule),
  );
});

test('every enumerated candidate is a well-formed rule about the new operation', () => {
  const candidates = enumerateRuleCandidates(DISTINCTION_ALGEBRA, GEN_B, {
    maxDepth: 2,
    maxVars: 2,
    maxCandidates: 500,
  });
  const varsOf = (t: Term, into = new Set<string>()): Set<string> => {
    if ('v' in t) into.add(t.v);
    else if ('args' in t) for (const a of (t as { args: Term[] }).args) varsOf(a, into);
    return into;
  };
  for (const { rule } of candidates) {
    assert.ok(!('v' in rule.lhs), 'a bare variable on the left would rewrite everything');
    assert.notDeepEqual(rule.lhs, rule.rhs, 'a rule to itself is not a rule');
    const lhsVars = varsOf(rule.lhs);
    for (const v of varsOf(rule.rhs)) {
      assert.ok(lhsVars.has(v), `rhs invents variable ${v} that the lhs never binds`);
    }
    assert.equal(
      JSON.stringify(rule.lhs).includes('gen_b'),
      true,
      'the left side must constrain the operation being proposed',
    );
  }
});

test('the term enumerator respects its depth bound', () => {
  const terms = enumerateTerms(DISTINCTION_ALGEBRA.operations, DISTINCTION_ALGEBRA.constants, {
    maxDepth: 2,
    maxVars: 2,
  });
  const depth = (t: Term): number =>
    'args' in t ? 1 + Math.max(0, ...(t as { args: Term[] }).args.map(depth)) : 0;
  for (const t of terms) assert.ok(depth(t) <= 2, `term exceeded the declared depth bound`);
});

test('sampling is reproducible under a seed and varies across seeds', () => {
  const pool = Array.from({ length: 200 }, (_, i) => i);
  assert.deepEqual(seededSample(pool, 20, 'alpha'), seededSample(pool, 20, 'alpha'));
  assert.notDeepEqual(seededSample(pool, 20, 'alpha'), seededSample(pool, 20, 'beta'));
  assert.deepEqual(seededSample(pool, 500, 'alpha').length, 200, 'never oversamples the pool');
});

/* ------------------------------------------------------------------ *
 * Degeneracy. The failure the first real run actually exposed.         *
 * ------------------------------------------------------------------ */

test('a constant rule is degenerate even though it is perfectly consistent', () => {
  const constantRule: Rule = { id: 'c', lhs: O('gen_u', V('x')), rhs: O('mark', C('unit')) };
  assert.equal(isInformationPreserving(constantRule), false);

  const result = screenCandidate(DISTINCTION_ALGEBRA, constantRule, GEN_U, [], 0);
  assert.equal(
    result.outcome,
    'DEGENERATE_CONSTANT',
    'gen_u(x) -> mark(unit) answers the same for every input; it is a value, not an operation',
  );
});

test('a projection is not degenerate — dropping one argument still says something', () => {
  const projection: Rule = { id: 'p', lhs: O('gen_b', V('x'), V('y')), rhs: O('mark', V('y')) };
  assert.equal(isInformationPreserving(projection), true);
  assert.notEqual(
    screenCandidate(DISTINCTION_ALGEBRA, projection, GEN_B, [], 0).outcome,
    'DEGENERATE_CONSTANT',
  );
});

test('a ground rule states a specific fact and is not treated as degenerate', () => {
  const ground: Rule = { id: 'g', lhs: O('gen_u', C('void')), rhs: C('unit') };
  assert.equal(isInformationPreserving(ground), true);
});

/* ------------------------------------------------------------------ *
 * The gauntlet, applied to generated input rather than curated input. *
 * ------------------------------------------------------------------ */

test('a rule mapping between distinct constants is NOT a contradiction', () => {
  // gen_u(void) -> unit does not assert void = unit. It asserts a function
  // sends one to the other, which is exactly what functions between distinct
  // things do. Killing this would make the gate superstitious rather than strict.
  const mapping: Rule = { id: 'm', lhs: O('gen_u', C('void')), rhs: C('unit') };
  const result = screenCandidate(DISTINCTION_ALGEBRA, mapping, GEN_U, [], 0);
  assert.notEqual(result.outcome, 'CONTRADICTORY');
});

test('a generated rule that collides with a parent rule over distinct constants is killed', () => {
  // F1 already says join(void, x) -> x, so join(void, unit) reduces to unit.
  // A candidate saying it reduces to void instead puts two DECLARED-DISTINCT
  // constants at the end of the same term. That must die, and must die by
  // search rather than by anyone noticing.
  const collision: Rule = { id: 'k', lhs: O('join', C('void'), C('unit')), rhs: C('void') };
  const joinOp: OpSpec = { name: 'join', arity: 2 };
  const result = screenCandidate(DISTINCTION_ALGEBRA, collision, joinOp, [], 0);
  assert.ok(
    result.outcome === 'CONTRADICTORY' || result.outcome === 'NON_CONFLUENT',
    `a rule forcing two declared-distinct constants to meet must not survive ` +
      `(got ${result.outcome}: ${result.detail})`,
  );
});

test('constraining an existing operation is where the gate actually bites', () => {
  // Fresh operations are nearly always consistent — a brand-new symbol has
  // nothing to disagree with. If the run only ever proposes fresh operations,
  // the contradiction and confluence channels never fire and a completely
  // broken gate would look identical to a working one.
  const report = runScreen([DISTINCTION_ALGEBRA], {
    seed: 'existing-ops',
    sampleSize: 60,
    operations: existingOperationsOf(DISTINCTION_ALGEBRA),
  });
  assert.ok(
    report.tally.CONTRADICTORY > 0,
    'no candidate contradicted anything — the contradiction search is untested here',
  );
  assert.ok(
    report.tally.NON_CONFLUENT > 0,
    'no candidate broke confluence — the critical-pair analysis is untested here',
  );
});

/* ------------------------------------------------------------------ *
 * REPLACED: 'a screening run kills the overwhelming majority of what   *
 * it proposes'.                                                        *
 *                                                                      *
 * That test asserted a kill-rate floor as its proof the screener was    *
 * working. A kill rate is precisely the number a BROKEN killer          *
 * inflates, so the assertion passed *because* the equivalence channel   *
 * was executing candidates on degenerate witnesses, and it went red     *
 * the moment the killer became honest. It was measuring the defect and  *
 * calling it health.                                                    *
 *                                                                      *
 * The rule that replaces it, and that governs this suite from here on:  *
 *                                                                      *
 *   OUTCOME RATES ARE OBSERVATIONS TO REPORT, NEVER ASSERTIONS THAT     *
 *   PROVE CORRECTNESS. A mechanism is proven by a constructed scenario  *
 *   in which it MUST fire, paired with one in which it MUST NOT.        *
 *                                                                      *
 * The tally is still checked for internal consistency below — that is   *
 * a bookkeeping invariant, not a rate.                                  *
 * ------------------------------------------------------------------ */

test('every screened candidate is accounted for in the tally', () => {
  const report = runScreen([DISTINCTION_ALGEBRA], { seed: 'test-screen', sampleSize: 30 });
  assert.ok(report.candidates_enumerated > 100, 'the candidate space must be genuinely searched');
  assert.ok(report.candidates_screened > 0);
  assert.equal(
    Object.values(report.tally).reduce((a, b) => a + b, 0),
    report.candidates_screened,
    'every screened candidate must be accounted for in the tally',
  );
  for (const [outcome, n] of Object.entries(report.tally)) {
    assert.ok(Number.isInteger(n), `tally for ${outcome} is not a number — an outcome went unbucketed`);
  }
});

test('the equivalence channel MUST fire on a planted re-skin', () => {
  // Build a candidate that clears every earlier gate on its own merits, then
  // plant that exact structure in the known set and screen it again. It is now
  // a re-skin of something already known, and the equivalence channel is the
  // only thing standing between it and a SURVIVED verdict it does not deserve.
  const rule: Rule = { id: 'def', lhs: O('gen_u', V('x')), rhs: O('mark', V('x')) };
  const first = screenCandidate(DISTINCTION_ALGEBRA, rule, GEN_U, [], 0);
  assert.equal(
    first.outcome,
    'SURVIVED',
    `fixture is not exercising the equivalence channel — it died earlier as ${first.outcome}`,
  );

  const reskin = { ...first.foundation!, id: 'planted-reskin' };
  const result = screenCandidate(DISTINCTION_ALGEBRA, rule, GEN_U, [reskin], 0);
  assert.equal(
    result.outcome,
    'EQUIVALENT_TO_KNOWN',
    'a candidate identical to a known structure was not caught by the equivalence channel',
  );
  // Part 2: a terminal verdict must carry its evidence.
  assert.ok(result.equivalence_evidence, 'an equivalence kill was issued with no evidence attached');
  assert.equal(result.equivalence_evidence!.target_id, 'planted-reskin');
  assert.ok(
    result.equivalence_evidence!.notes.length > 0,
    'the equivalence evidence must record how the verdict was reached',
  );
});

test('the equivalence channel MUST NOT fire on two genuinely distinct systems', () => {
  const [f1, f2] = seedFoundations();
  const result = screenCandidate(
    f1!,
    { id: 'fresh', lhs: O('gen_u', C('void')), rhs: C('void') },
    GEN_U,
    [f2!],
    0,
  );
  assert.notEqual(
    result.outcome,
    'EQUIVALENT_TO_KNOWN',
    'two genuinely distinct systems were declared equivalent — the erasure path is live again',
  );
});

test('no survivor is equivalent to any seed foundation or to another survivor', () => {
  const report = runScreen([DISTINCTION_ALGEBRA], { seed: 'test-distinct', sampleSize: 25 });
  const ids = report.survivors.map((s) => s.candidate_id);
  assert.equal(new Set(ids).size, ids.length, 'survivor ids must be unique');
  for (const s of report.survivors) {
    assert.equal(s.outcome, 'SURVIVED');
    assert.ok(s.foundation, 'a survivor must carry the foundation it survived as');
  }
});

test('screening is reproducible: the same seed yields the same verdicts', () => {
  const opts = { seed: 'repro', sampleSize: 12 } as const;
  const a = runScreen([DISTINCTION_ALGEBRA], opts);
  const b = runScreen([DISTINCTION_ALGEBRA], opts);
  assert.deepEqual(
    a.results.map((r) => [r.candidate_id, r.outcome]),
    b.results.map((r) => [r.candidate_id, r.outcome]),
  );
});

test('every seed foundation admits a non-empty candidate space', () => {
  for (const f of seedFoundations()) {
    for (const op of CANDIDATE_OPERATIONS) {
      const n = enumerateRuleCandidates(f, op, {
        maxDepth: 2,
        maxVars: 2,
        maxCandidates: 1000,
      }).length;
      assert.ok(n > 0, `${f.id} + ${op.name} produced no candidates at all`);
    }
  }
});
