import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ScreenLedger } from '../../src/foundry/screen-ledger.ts';
import type { ScreenResult } from '../../src/foundry/screen.ts';
import type { OpSpec, Rule, Term } from '../../src/foundry/types.ts';

const V = (n: string): Term => ({ v: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

const RULE: Rule = { id: 'r', lhs: O('f', V('x')), rhs: V('x') };
const OP: OpSpec = { name: 'f', arity: 1 };

function result(id: string, over: Partial<ScreenResult> = {}): ScreenResult {
  return {
    candidate_id: id,
    parent_id: 'parent',
    rule: RULE,
    new_operation: OP,
    outcome: 'SURVIVED',
    detail: 'ok',
    foundation: null,
    ...over,
  };
}

const KILL = (id: string, evidence: unknown): ScreenResult =>
  result(id, {
    outcome: 'EQUIVALENT_TO_KNOWN',
    detail: 'equivalent to known',
    equivalence_evidence: evidence as ScreenResult['equivalence_evidence'],
  });

test('a verdict that is issued is a verdict that is written down', () => {
  const ledger = new ScreenLedger();
  ledger.record('seed-1', result('c1'));
  ledger.record('seed-1', KILL('c2', { target_id: 't', stage: 's', interpretation_witness: {}, witness_gate: {}, notes: ['n'] }));
  assert.equal(ledger.length, 2, 'the screener issued two verdicts and the ledger holds fewer');
  assert.equal(ledger.terminalVerdicts().length, 1);
});

test('an untouched ledger verifies, and every entry links to the one before it', () => {
  const ledger = new ScreenLedger();
  ledger.record('seed-1', result('c1'));
  ledger.record('seed-1', result('c2'));
  ledger.record('seed-1', result('c3'));

  const check = ledger.verify();
  assert.equal(check.ok, true, `an untouched ledger must verify: ${JSON.stringify(check.broken)}`);

  const entries = ledger.all();
  assert.equal(entries[0]!.prev_hash, '0'.repeat(64), 'the first entry must anchor to the genesis hash');
  for (let i = 1; i < entries.length; i += 1) {
    assert.equal(
      entries[i]!.prev_hash,
      entries[i - 1]!.entry_hash,
      `entry ${i} is not chained to entry ${i - 1}`,
    );
  }
});

test('an altered entry fails verification — a rewritten kill cannot pass as original', () => {
  const ledger = new ScreenLedger();
  ledger.record('seed-1', result('c1'));
  ledger.record('seed-1', KILL('c2', null));
  ledger.record('seed-1', result('c3'));

  // Forge the middle entry the way someone covering a bad kill would: change
  // the verdict, keep the hashes. verify() recomputes, so it must catch it.
  const forged = ledger.all().map((e, i) => (i === 1 ? { ...e, outcome: 'SURVIVED' as const } : e));
  const tampered = ScreenLedger.fromEntries(forged);

  const check = tampered.verify();
  assert.equal(check.ok, false, 'a rewritten entry passed verification — the chain proves nothing');
  assert.ok(
    check.broken.some((b) => b.seq === 1 && b.reason === 'ENTRY_HASH_MISMATCH'),
    'the altered entry itself must be named',
  );
  assert.ok(
    check.broken.some((b) => b.seq === 2 && b.reason === 'PREV_HASH_MISMATCH'),
    'tampering must invalidate every entry downstream of it, not just the one edited',
  );
});

test('entries are frozen against in-place edits', () => {
  const ledger = new ScreenLedger();
  ledger.record('seed-1', result('c1'));
  const entry = ledger.all()[0]!;
  assert.equal(Object.isFrozen(entry), true, 'a ledger entry must be frozen on append');
});

test('a kill with no evidence is unverifiable, and the ledger says so', () => {
  const ledger = new ScreenLedger();
  const entry = ledger.record('seed-1', KILL('c1', null));
  assert.equal(entry.evidence, null);

  ledger.revisit(
    entry.seq,
    'VERDICT_UNVERIFIABLE',
    'No witness was recorded with the original verdict, so it can be neither upheld nor overturned.',
  );
  assert.equal(ledger.currentKind(entry.seq), 'VERDICT_UNVERIFIABLE');
});

test('a reversal is an append, never a rewrite — the original stays readable', () => {
  const ledger = new ScreenLedger();
  const entry = ledger.record('seed-1', KILL('c1', { target_id: 't', stage: 's', interpretation_witness: {}, witness_gate: { admitted: false }, notes: [] }));
  const reversal = ledger.revisit(
    entry.seq,
    'REVERSED',
    'The only witness supporting this kill was degenerate; it fails W1_NON_COLLAPSING.',
  );

  assert.equal(ledger.length, 2, 'a reversal must add an entry, not replace one');
  assert.equal(ledger.all()[0]!.kind, 'VERDICT', 'the original verdict must survive the reversal');
  assert.equal(ledger.all()[0]!.outcome, 'EQUIVALENT_TO_KNOWN');
  assert.equal(reversal.supersedes, entry.seq);
  assert.ok(reversal.cause && reversal.cause.length > 0, 'a reversal must say why');
  assert.equal(ledger.currentKind(entry.seq), 'REVERSED');
  assert.equal(ledger.verify().ok, true, 'the chain must still verify after a correction');
});

test('a real screening run leaves a verifying ledger of every verdict it issued', async () => {
  const { runScreen } = await import('../../src/foundry/screen.ts');
  const { DISTINCTION_ALGEBRA } = await import('../../src/foundry/generator.ts');

  const report = runScreen([DISTINCTION_ALGEBRA], { seed: 'ledger-run', sampleSize: 4 });

  assert.equal(
    report.ledger.length,
    report.candidates_screened,
    'the run screened more candidates than it wrote down',
  );
  const check = report.ledger.verify();
  assert.equal(check.ok, true, `the run's own ledger does not verify: ${JSON.stringify(check.broken)}`);

  // Every terminal verdict must carry evidence. This is the assertion that
  // makes the tainted-history audit possible next time it is ordered.
  for (const kill of report.ledger.terminalVerdicts()) {
    assert.notEqual(
      kill.evidence,
      null,
      `${kill.candidate_id} was killed as EQUIVALENT_TO_KNOWN with no evidence recorded`,
    );
  }
});

test('a revisit of a revisit is refused — corrections chain to originals', () => {
  const ledger = new ScreenLedger();
  const entry = ledger.record('seed-1', KILL('c1', null));
  const reversal = ledger.revisit(entry.seq, 'REVERSED', 'because');
  assert.throws(
    () => ledger.revisit(reversal.seq, 'CONFIRMED', 'no'),
    /NOT_AN_ORIGINAL_VERDICT/,
  );
});
