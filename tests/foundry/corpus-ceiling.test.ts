import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  corpusCeiling,
  levelCeiling,
  type CorpusCoverage,
  type LevelEvidence,
} from '../../src/foundry/levels.ts';

/* ------------------------------------------------------------------ *
 * "Nothing above level three" used to be a sentence in a report. A    *
 * sentence in a report is not a gate — nobody can violate it, because *
 * nothing checks it. These tests pin it as a computed property.       *
 *                                                                    *
 * RED evidence: before corpusCeiling existed, levelCeiling(4, {       *
 * formalized: true, reduction: 'NO_EMBEDDING_FOUND', benchmark:       *
 * 'NOT_RUN' }) returned level 4, capped: false, against a corpus of   *
 * any size whatsoever — including a corpus of zero targets.           *
 * ------------------------------------------------------------------ */

/** The corpus as it actually stands: 15 targets, 2 full, 4 partial. */
const CORPUS_AT_15: CorpusCoverage = {
  families_fully_covered: ['functions', 'algebraic structures'],
  families_partially_covered: ['sets', 'relations', 'automata', 'programs'],
  families_not_expressible: ['graphs', 'probability spaces'],
  targets_checked: 15,
};

/** A thin corpus: 8 targets, one family covered, one half-covered. */
const CORPUS_AT_8: CorpusCoverage = {
  families_fully_covered: ['algebraic structures'],
  families_partially_covered: ['sets'],
  families_not_expressible: ['graphs', 'probability spaces'],
  targets_checked: 8,
};

const SURVIVED_ATTACK: LevelEvidence = {
  formalized: true,
  reduction: 'NO_EMBEDDING_FOUND',
  benchmark: 'NOT_RUN',
};

test('a survivor cannot be stamped above the ceiling its corpus derives', () => {
  // 1 full + 1 partial = 1.5 effective families -> level 2 at most.
  const derived = corpusCeiling(CORPUS_AT_8);
  assert.equal(derived.ceiling, 2, 'a corpus this thin cannot support a conceptual claim');

  const verdict = levelCeiling(4, SURVIVED_ATTACK, CORPUS_AT_8);
  assert.equal(verdict.capped, true, 'the claim exceeded the corpus and was not refused');
  assert.equal(verdict.level, derived.ceiling, 'the stamped level must fall to the derived ceiling');
  assert.equal(verdict.claimed, 4, 'the original claim must stay on the record');
});

test('the refusal cites the ceiling and how it was derived, not just a number', () => {
  const verdict = levelCeiling(4, SURVIVED_ATTACK, CORPUS_AT_8);
  assert.match(verdict.reason, /CORPUS_CEILING_BINDS/);
  assert.match(verdict.reason, /8 target\(s\)/, 'the target count must appear');
  assert.match(verdict.reason, /algebraic structures/, 'the covered families must be named');
  assert.match(verdict.reason, /graphs/, 'families never attacked must be disclosed');
  assert.match(verdict.reason, /effective famil/, 'the derivation itself must be stated');
});

test('the ceiling rises on its own as the corpus grows — nobody raises it by claiming', () => {
  const thin = corpusCeiling(CORPUS_AT_8);
  const current = corpusCeiling(CORPUS_AT_15);
  assert.ok(
    current.ceiling > thin.ceiling,
    'growing the corpus must lift the ceiling without any claim changing',
  );

  const grown: CorpusCoverage = {
    ...CORPUS_AT_15,
    families_fully_covered: [
      ...CORPUS_AT_15.families_fully_covered,
      'order/lattice',
      'group-like',
      'ring-like',
      'state-transition',
    ],
    targets_checked: 27,
  };
  assert.ok(
    corpusCeiling(grown).ceiling > current.ceiling,
    'landing whole new families must lift the ceiling further',
  );
});

test('the ceiling as it stands right now is 3 — computed, not stated', () => {
  const current = corpusCeiling(CORPUS_AT_15);
  assert.equal(current.effective_families, 4, '2 full + 4 partial at half weight');
  assert.equal(current.ceiling, 3);

  const verdict = levelCeiling(5, SURVIVED_ATTACK, CORPUS_AT_15);
  assert.equal(verdict.level, 3, 'level 5 is not available against this corpus');
  assert.equal(verdict.capped, true);
});

test('an empty corpus supports nothing — surviving no attack is not surviving', () => {
  const empty: CorpusCoverage = {
    families_fully_covered: [],
    families_partially_covered: [],
    families_not_expressible: [],
    targets_checked: 0,
  };
  assert.equal(corpusCeiling(empty).ceiling, 1);
  assert.equal(levelCeiling(4, SURVIVED_ATTACK, empty).level, 1);
});

test('the corpus ceiling binds only claims of absence, never claims of fact', () => {
  // A lossless embedding is a fact about a target that WAS found. A thin
  // corpus does not make that finding weaker — it is already conclusive.
  const embedded: LevelEvidence = {
    formalized: true,
    reduction: 'LOSSLESS_EMBEDDING',
    benchmark: 'NOT_RUN',
  };
  const verdict = levelCeiling(2, embedded, {
    families_fully_covered: [],
    families_partially_covered: [],
    families_not_expressible: [],
    targets_checked: 0,
  });
  assert.equal(verdict.level, 2, 'a found embedding must not be capped by corpus size');
  assert.equal(verdict.capped, false);
});

test('omitting coverage entirely does not silently grant the old uncapped behaviour', () => {
  // Callers that pass no coverage get the evidence ceiling, which is the
  // pre-existing contract. This test exists so that if anyone ever makes
  // coverage optional-by-default in a way that reintroduces the hole, it is
  // visible here rather than discovered in a report six weeks later.
  const verdict = levelCeiling(4, SURVIVED_ATTACK);
  assert.equal(verdict.level, 4, 'documented behaviour without coverage');
  assert.equal(
    verdict.reason.includes('CORPUS_CEILING_BINDS'),
    false,
    'no corpus was supplied, so no corpus derivation may be cited',
  );
});
