import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, test } from 'node:test';

import { listRuns, loadRun, openRunDir } from '../../src/foundry/run-store.ts';
import { ScreenLedger } from '../../src/foundry/screen-ledger.ts';

const roots: string[] = [];
function freshRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'foundry-runstore-'));
  roots.push(root);
  return root;
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/* The pin for the overwrite class. This is the test that would have failed on
 * 2026-08-16, when a corpus run destroyed the exhaustive re-screen's ledger by
 * writing to the same fixed filename. */
test('a second run cannot alter the first run byte-for-byte', () => {
  const root = freshRoot();

  const first = openRunDir(root, 'same-seed');
  const led1 = new ScreenLedger(first.sink);
  led1.openRun('same-seed', { exhaustive: true }, 'run opened');
  led1.observe('same-seed', 'run closed', { screened: 1 }, 'done');
  first.writeArtifact('survivors.json', '["alpha"]');

  const before = readdirSync(first.dir)
    .sort()
    .map((f) => [f, readFileSync(resolve(first.dir, f), 'utf8')] as const);

  const second = openRunDir(root, 'same-seed');
  assert.notEqual(second.dir, first.dir, 'same seed must not reuse the first run directory');
  const led2 = new ScreenLedger(second.sink);
  led2.openRun('same-seed', { exhaustive: true }, 'run opened');
  second.writeArtifact('survivors.json', '["beta"]');

  const after_ = readdirSync(first.dir)
    .sort()
    .map((f) => [f, readFileSync(resolve(first.dir, f), 'utf8')] as const);

  assert.deepEqual(after_, before, "the first run's artifacts were mutated by a later run");
  assert.equal(listRuns(root).length, 2);
});

test('every entry is on disk the moment it is issued, not at process exit', () => {
  const root = freshRoot();
  const run = openRunDir(root, 'streaming');
  const ledger = new ScreenLedger(run.sink);

  ledger.openRun('streaming', { exhaustive: false, sample_size: 3 }, 'run opened');
  // Read the file with the "process" still running. Nothing has flushed or
  // exited — if this is empty, a session dying mid-run loses everything.
  const midRun = readFileSync(run.ledgerPath, 'utf8').trim().split('\n');
  assert.equal(midRun.length, 1);
  assert.equal(JSON.parse(midRun[0]!).kind, 'RUN_HEADER');
});

test('a truncated tail leaves a valid chain that a resume appends to', () => {
  const root = freshRoot();
  const run = openRunDir(root, 'crashed');
  const ledger = new ScreenLedger(run.sink);
  ledger.openRun('crashed', { exhaustive: true }, 'run opened');
  ledger.observe('crashed', 'progress', { n: 1 }, 'mid-run');

  // Simulate a kill in the middle of writing entry 3.
  const partial = `${readFileSync(run.ledgerPath, 'utf8')}{"seq":2,"kind":"OBSERV`;
  run.writeArtifact('screen-ledger.jsonl', partial);

  const resumed = loadRun(run.ledgerPath, run.sink);
  assert.equal(resumed.length, 2, 'the truncated line must be dropped, not parsed');
  assert.equal(resumed.verify().ok, true, 'a partial chain is still a valid chain');

  resumed.observe('crashed', 'resumed', { n: 2 }, 'appended after restart');
  assert.equal(resumed.verify().ok, true, 'resume must append, not restart');
  assert.equal(loadRun(run.ledgerPath).length, 3);
  assert.equal(loadRun(run.ledgerPath).verify().ok, true);
});

test('header and observation entries are not verdicts', () => {
  const ledger = new ScreenLedger();
  ledger.openRun('s', { exhaustive: true }, 'run opened');
  ledger.observe('s', 'incident', { destroyed: 'survivors.json' }, 'overwrite');
  assert.equal(ledger.terminalVerdicts().length, 0);
  assert.equal(ledger.verify().ok, true);
  for (const e of ledger.all()) {
    assert.equal(e.outcome, null);
    assert.equal(e.candidate_id, '');
  }
});
