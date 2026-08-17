import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sha256 } from '../../src/canonical-json.ts';
import {
  InMemoryPriorArtCorpus,
  validateCorpusEntry,
  type CorpusEntry,
} from '../../src/foundry/corpus.ts';
import {
  attachPriorArtCorpus,
  detachPriorArtCorpus,
  hasPriorArtCorpus,
} from '../../src/foundry/prior-art.ts';
import { buildGenesisRecord } from '../../src/foundry/genesis.ts';
import { transitionNovelty } from '../../src/foundry/status.ts';
import type { Foundation, Term } from '../../src/foundry/types.ts';

import { MONOID_FOUNDATION, RESKINNED_MONOID, minimalGenesisInput } from './helpers.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

const PASSAGE =
  'A monoid is a set equipped with an associative binary operation and an identity element.';

const monoidEntry = (): CorpusEntry => ({
  entry_id: 'entry-monoid',
  name: 'monoid',
  structure: MONOID_FOUNDATION,
  evidence: {
    source_id: 'src-algebra-text',
    packet_id: 'pkt-0001',
    locator_type: 'SECTION_PARAGRAPH',
    locator_value: '2.1:1',
    passage: PASSAGE,
    passage_sha256: sha256(PASSAGE),
  },
});

const SEMIGROUP_PASSAGE =
  'A semigroup is a set with an associative binary operation and no required identity.';

const semigroupEntry = (): CorpusEntry => ({
  entry_id: 'entry-semigroup',
  name: 'semigroup',
  structure: {
    id: 'known-semigroup',
    name: 'Semigroup',
    primitives: ['element'],
    constants: [],
    operations: [{ name: 'mul', arity: 2 }],
    rules: [
      {
        id: 'assoc',
        lhs: O('mul', O('mul', V('x'), V('y')), V('z')),
        rhs: O('mul', V('x'), O('mul', V('y'), V('z'))),
      },
    ],
    distinct: [],
    invariants: ['mul is associative'],
  },
  evidence: {
    source_id: 'src-algebra-text',
    packet_id: 'pkt-0002',
    locator_type: 'SECTION_PARAGRAPH',
    locator_value: '2.0:1',
    passage: SEMIGROUP_PASSAGE,
    passage_sha256: sha256(SEMIGROUP_PASSAGE),
  },
});

/** A structure with no equivalent in the test corpus. */
const ABSORBING: Foundation = {
  id: 'absorbing',
  name: 'Absorbing structure',
  primitives: ['element'],
  constants: ['z'],
  operations: [{ name: 'mul', arity: 2 }],
  rules: [
    { id: 'absorb-l', lhs: O('mul', C('z'), V('x')), rhs: C('z') },
    { id: 'absorb-r', lhs: O('mul', V('x'), C('z')), rhs: C('z') },
    {
      id: 'assoc',
      lhs: O('mul', O('mul', V('x'), V('y')), V('w')),
      rhs: O('mul', V('x'), O('mul', V('y'), V('w'))),
    },
  ],
  distinct: [],
  invariants: [],
};

/* ------------------------------------------------------------------ *
 * A corpus entry is a SOURCED CLAIM about existing mathematics and    *
 * carries the same burden as any other external claim.                *
 * ------------------------------------------------------------------ */

test('a corpus entry without evidence is refused at ingestion', () => {
  const corpus = new InMemoryPriorArtCorpus('c1', 'test corpus');
  const naked = { ...monoidEntry(), evidence: undefined } as unknown as CorpusEntry;
  const result = corpus.ingest([naked]);
  assert.equal(result.ok, false);
  assert.equal(corpus.record_count, 0, 'an unsourced entry must not enter the corpus');
  assert.ok(result.rejected[0]!.rejections.includes('CORPUS_ENTRY_MISSING_EVIDENCE'));
});

test('a corpus entry whose passage hash does not match its passage is refused', () => {
  const corpus = new InMemoryPriorArtCorpus('c1', 'test corpus');
  const tampered = monoidEntry();
  tampered.evidence.passage = `${PASSAGE} And it is also commutative.`;
  const result = corpus.ingest([tampered]);
  assert.equal(result.ok, false);
  assert.ok(result.rejected[0]!.rejections.includes('CORPUS_ENTRY_PASSAGE_HASH_MISMATCH'));
  assert.equal(corpus.record_count, 0);

  // The stored hash is recomputed, never trusted: restating the hash to match
  // the altered passage is a different (and detectable) act, but the point is
  // that no entry gets in on an unverified hash.
  const honest = monoidEntry();
  assert.deepEqual(validateCorpusEntry(honest), []);
});

test('a well-evidenced entry is admitted and changes the corpus content hash', () => {
  const corpus = new InMemoryPriorArtCorpus('c1', 'test corpus');
  const before = corpus.content_sha256;
  const result = corpus.ingest([monoidEntry()]);
  assert.equal(result.ok, true, JSON.stringify(result.rejected));
  assert.equal(corpus.record_count, 1);
  assert.notEqual(corpus.content_sha256, before, 'corpus content hash must be tamper-evident');
  assert.equal(corpus.ingest([monoidEntry()]).ok, false, 'duplicate entry ids must be refused');
});

/* ------------------------------------------------------------------ *
 * The search itself.                                                  *
 * ------------------------------------------------------------------ */

test('a re-skinned known structure is caught by the corpus, not crowned novel', () => {
  const corpus = new InMemoryPriorArtCorpus('c1', 'test corpus');
  corpus.ingest([monoidEntry()]);
  const record = corpus.searchDetailed(RESKINNED_MONOID);
  assert.equal(record.exhaustive, true);
  assert.equal(record.entries_compared, 1);
  assert.equal(record.equivalents.length, 1, 'the renamed monoid must match the monoid entry');
  assert.equal(record.equivalents[0]!.name, 'monoid');
});

test('a genuinely different structure finds no equivalent — which proves nothing on its own', () => {
  const corpus = new InMemoryPriorArtCorpus('c1', 'test corpus');
  corpus.ingest([monoidEntry()]);
  const record = corpus.searchDetailed(ABSORBING);
  assert.equal(record.equivalents.length, 0);
  assert.equal(record.exhaustive, true);
});

/* ------------------------------------------------------------------ *
 * NOVELTY_CONFIRMED. Attaching a corpus is not evidence.              *
 * ------------------------------------------------------------------ */

test('NOVELTY_CONFIRMED requires a corpus, a search, an exhaustive one, and an argument', async (t) => {
  const corpus = new InMemoryPriorArtCorpus('c1', 'test corpus');
  corpus.ingest([monoidEntry()]);
  const record = buildGenesisRecord(minimalGenesisInput('novelty-gate'));

  // Without a corpus: the transition does not exist.
  detachPriorArtCorpus();
  assert.equal(hasPriorArtCorpus(), false);
  assert.throws(
    () => transitionNovelty(record, 'NOVELTY_CONFIRMED', {}),
    /NOVELTY_CONFIRMED_REQUIRES_CORPUS/,
  );

  attachPriorArtCorpus(corpus);
  t.after(() => detachPriorArtCorpus());
  assert.equal(hasPriorArtCorpus(), true);

  // Corpus attached, but nobody searched it.
  assert.throws(
    () => transitionNovelty(record, 'NOVELTY_CONFIRMED', {}),
    /NOVELTY_CONFIRMED_REQUIRES_SEARCH_RECORD/,
  );

  const search = corpus.searchDetailed(record.formal.foundation);

  // A truncated search that finds nothing has found nothing.
  assert.throws(
    () =>
      transitionNovelty(record, 'NOVELTY_CONFIRMED', {
        corpus_search: { ...search, exhaustive: false, entries_compared: 0 },
        distinguishing_behavior: 'something',
      }),
    /NOVELTY_CONFIRMED_REQUIRES_EXHAUSTIVE_SEARCH/,
  );

  // A search covering a different foundation does not count.
  assert.throws(
    () =>
      transitionNovelty(record, 'NOVELTY_CONFIRMED', {
        corpus_search: { ...search, foundation_id: 'some-other-foundation' },
        distinguishing_behavior: 'something',
      }),
    /NOVELTY_CONFIRMED_SEARCH_MISMATCH/,
  );

  // The record's own foundation IS the monoid, so the search finds it —
  // and a found equivalent kills the claim outright.
  assert.equal(search.equivalents.length, 1, 'the test record is literally a monoid');
  assert.throws(
    () =>
      transitionNovelty(record, 'NOVELTY_CONFIRMED', {
        corpus_search: search,
        distinguishing_behavior: 'something',
      }),
    /NOVELTY_CONFIRMED_CONTRADICTED_BY_SEARCH/,
  );

  // Blanking the equivalents by hand does not launder the search. The record
  // is sealed by the corpus that produced it; an edited one is not a search.
  assert.throws(
    () =>
      transitionNovelty(record, 'NOVELTY_CONFIRMED', {
        corpus_search: { ...search, equivalents: [] },
        distinguishing_behavior: 'something',
      }),
    /NOVELTY_CONFIRMED_SEARCH_RECORD_UNSEALED/,
  );

  // A structure the corpus genuinely has no equivalent for.
  const novel = buildGenesisRecord(
    minimalGenesisInput('novelty-real', { foundation: ABSORBING }),
  );
  const clean = corpus.searchDetailed(novel.formal.foundation);
  assert.equal(clean.equivalents.length, 0);

  // Clean search, but no argued distinguishing behavior.
  assert.throws(
    () => transitionNovelty(novel, 'NOVELTY_CONFIRMED', { corpus_search: clean }),
    /NOVELTY_CONFIRMED_REQUIRES_DISTINGUISHING_BEHAVIOR/,
  );

  // All conditions met: the transition finally exists.
  const confirmed = transitionNovelty(novel, 'NOVELTY_CONFIRMED', {
    corpus_search: clean,
    distinguishing_behavior:
      'Composition collapses to an absorbing element, which no corpus entry admits.',
  });
  assert.equal(confirmed.status.novelty, 'NOVELTY_CONFIRMED');
  assert.equal(confirmed.supersedes, 'novelty-real', 'a status change is an append, not an edit');
});

/* ------------------------------------------------------------------ *
 * The search record is bound to the corpus state it actually searched. *
 * This is the seam where a true claim quietly goes stale.              *
 * ------------------------------------------------------------------ */

test('a search that predates a corpus growing is stale, and stale is not evidence', async (t) => {
  const corpus = new InMemoryPriorArtCorpus('c1', 'test corpus');
  corpus.ingest([monoidEntry()]);
  attachPriorArtCorpus(corpus);
  t.after(() => detachPriorArtCorpus());

  const novel = buildGenesisRecord(
    minimalGenesisInput('stale-search', { foundation: ABSORBING }),
  );
  const search = corpus.searchDetailed(novel.formal.foundation);
  const evidence = {
    corpus_search: search,
    distinguishing_behavior: 'Composition collapses to an absorbing element.',
  };

  // Against the corpus as searched, this is a legitimate confirmation.
  assert.equal(
    transitionNovelty(novel, 'NOVELTY_CONFIRMED', evidence).status.novelty,
    'NOVELTY_CONFIRMED',
  );

  // The corpus then learns something the search never looked at.
  assert.equal(corpus.ingest([semigroupEntry()]).ok, true);

  // The same record is now a claim about a library that no longer exists.
  assert.throws(
    () => transitionNovelty(novel, 'NOVELTY_CONFIRMED', evidence),
    /NOVELTY_CONFIRMED_SEARCH_RECORD_STALE/,
  );
});

test('a search run against a different corpus does not count for this one', async (t) => {
  const searched = new InMemoryPriorArtCorpus('c-searched', 'the one we read');
  searched.ingest([monoidEntry()]);
  const attachedCorpus = new InMemoryPriorArtCorpus('c-attached', 'the one in force');
  attachedCorpus.ingest([monoidEntry()]);
  attachPriorArtCorpus(attachedCorpus);
  t.after(() => detachPriorArtCorpus());

  const novel = buildGenesisRecord(
    minimalGenesisInput('wrong-corpus', { foundation: ABSORBING }),
  );
  assert.throws(
    () =>
      transitionNovelty(novel, 'NOVELTY_CONFIRMED', {
        corpus_search: searched.searchDetailed(novel.formal.foundation),
        distinguishing_behavior: 'Composition collapses to an absorbing element.',
      }),
    /NOVELTY_CONFIRMED_SEARCH_CORPUS_MISMATCH/,
  );
});

test('detaching the corpus closes the door again', () => {
  detachPriorArtCorpus();
  assert.equal(hasPriorArtCorpus(), false);
  const record = buildGenesisRecord(minimalGenesisInput('novelty-closed'));
  assert.throws(
    () =>
      transitionNovelty(record, 'NOVELTY_CONFIRMED', {
        corpus_search: {
          corpus_id: 'c1',
          corpus_content_sha256: 'x',
          foundation_id: record.formal.foundation.id,
          entries_compared: 1,
          entries_total: 1,
          exhaustive: true,
          equivalents: [],
        },
        distinguishing_behavior: 'anything',
      }),
    /NOVELTY_CONFIRMED_REQUIRES_CORPUS/,
  );
});
