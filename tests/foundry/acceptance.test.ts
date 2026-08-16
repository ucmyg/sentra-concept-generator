import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildTransmittedEvidenceIndex,
  parseAndValidateInventionOutput,
} from '../../src/output-contract.ts';

import {
  ConceptRegistry,
  admitConstructedArtifact,
  admitDerivedResult,
  buildGenesisRecord,
  checkEquivalence,
  classifyStatement,
  computeLineageHash,
  findContradiction,
  hasPriorArtCorpus,
  replayTrace,
  transitionNovelty,
  verifyLineage,
} from '../../src/foundry/index.ts';

import {
  MONOID_FOUNDATION,
  RESKINNED_MONOID,
  PLANTED_CONTRADICTION,
  minimalGenesisInput,
} from './helpers.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/* ------------------------------------------------------------------ *
 * 1. Regression: the untouched evidence gate.                         *
 *    Written first. Must pass before and after every change here.     *
 * ------------------------------------------------------------------ */

test('REGRESSION: an external factual claim without verified evidence still fails', () => {
  const request = JSON.parse(
    readFileSync(resolve(root, 'tests/fixtures/request.json'), 'utf8'),
  );
  const index = buildTransmittedEvidenceIndex(request.transmitted_sources);

  const unsourced = JSON.stringify({
    schema_version: 'mechanism-invention-output-v1',
    no_concept_reason: null,
    concepts: [
      {
        id: 'smuggled-external-fact',
        mechanism: 'Order flow imbalance predicts reversals in equity index futures.',
        evidence_refs: [],
        mechanism_atoms: [
          { atom_type: 'EMPIRICAL', claim: 'This is established in the literature.', evidence_ref_ids: [] },
        ],
      },
    ],
  });

  const result = parseAndValidateInventionOutput(unsourced, index);
  assert.equal(result.contract_status, 'CONTRACT_REJECTED');
  assert.equal(result.valid.length, 0);
  assert.ok(result.rejection_codes.includes('OUTPUT_EVIDENCE_REFS_EMPTY'));

  const forgedPacket = JSON.stringify({
    schema_version: 'mechanism-invention-output-v1',
    no_concept_reason: null,
    concepts: [
      {
        id: 'forged-packet',
        mechanism: 'Invented citation.',
        evidence_refs: [
          {
            evidence_ref_id: 'r1',
            source_id: 'src-does-not-exist',
            packet_id: 'pkt-does-not-exist',
            evidence_tier: 'FULL_TEXT',
            claim_scope: 'SOURCE_PASSAGE',
            locator_type: 'PARAGRAPH_SENTENCE',
            locator_value: '1:1',
            passage_echo: 'made up',
          },
        ],
        mechanism_atoms: [{ atom_type: 'EMPIRICAL', claim: 'x', evidence_ref_ids: ['r1'] }],
      },
    ],
  });
  const forged = parseAndValidateInventionOutput(forgedPacket, index);
  assert.equal(forged.contract_status, 'CONTRACT_REJECTED');
  assert.ok(forged.rejection_codes.includes('OUTPUT_SOURCE_ID_NOT_TRANSMITTED'));
});

/* ------------------------------------------------------------------ *
 * 2. Constructed artifacts register with zero citations.              *
 * ------------------------------------------------------------------ */

test('a constructed artifact registers with zero citations', () => {
  const registry = new ConceptRegistry();
  const record = buildGenesisRecord(minimalGenesisInput('zero-citation-concept'));
  assert.equal(record.epistemic_class, 'CONSTRUCTED_ARTIFACT');
  assert.deepEqual(record.citations, []);

  const admitted = admitConstructedArtifact(record);
  assert.equal(admitted.ok, true, JSON.stringify(admitted.rejections));

  registry.append(record);
  assert.equal(registry.get(record.identity.id)?.identity.id, record.identity.id);
  assert.equal(registry.size(), 1);
});

test('a construction that cites a source, or asserts external establishment, is blocked', () => {
  const cited = buildGenesisRecord(minimalGenesisInput('mislabeled'));
  const withCitation = { ...cited, citations: ['doi:10.1000/fake'] };
  const r1 = admitConstructedArtifact(withCitation as typeof cited);
  assert.equal(r1.ok, false);
  assert.ok(r1.rejections.includes('CONSTRUCTED_ARTIFACT_CARRIES_CITATIONS'));

  const asFact = classifyStatement({
    text: 'It is well established in the literature that this operation is associative.',
    declared_class: 'CONSTRUCTED_ARTIFACT',
  });
  assert.equal(asFact.ok, false);
  assert.ok(asFact.rejections.includes('ASSERTS_EXTERNAL_FACT'));

  const worldAxiom = buildGenesisRecord(
    minimalGenesisInput('world-axiom', {
      axioms: [
        {
          id: 'ax-world',
          statement: 'Observed market volatility clusters in real markets.',
          kind: 'ASSUMPTION_OF_SYSTEM',
          rule: null,
        },
      ],
    }),
  );
  const r2 = admitConstructedArtifact(worldAxiom);
  assert.equal(r2.ok, false);
  assert.ok(r2.rejections.includes('AXIOM_ASSERTS_WORLD_FACT'));
});

/* ------------------------------------------------------------------ *
 * 3. Derived results need a kernel-replayable trace.                  *
 * ------------------------------------------------------------------ */

test('a derived result without a kernel-replayable trace is rejected', () => {
  const bogus = admitDerivedResult({
    id: 'derived-no-trace',
    foundation: MONOID_FOUNDATION,
    claim: 'mul(e, mul(e, x)) = x',
    trace: null,
  });
  assert.equal(bogus.ok, false);
  assert.ok(bogus.rejections.includes('DERIVED_RESULT_MISSING_TRACE'));

  const tampered = admitDerivedResult({
    id: 'derived-bad-trace',
    foundation: MONOID_FOUNDATION,
    claim: 'mul(e, mul(e, x)) = x',
    trace: {
      start: { op: 'mul', args: [{ c: 'e' }, { op: 'mul', args: [{ c: 'e' }, { v: 'x' }] }] },
      steps: [
        {
          rule: 'left-identity',
          path: [],
          result: { c: 'WRONG' },
        },
      ],
    },
  });
  assert.equal(tampered.ok, false);
  assert.ok(tampered.rejections.includes('TRACE_NOT_REPLAYABLE'));
});

test('a genuine trace replays deterministically through the kernel', () => {
  const start = {
    op: 'mul',
    args: [{ c: 'e' }, { op: 'mul', args: [{ c: 'e' }, { v: 'x' }] }],
  };
  const replay = replayTrace(MONOID_FOUNDATION, {
    start,
    steps: [
      { rule: 'left-identity', path: [1], result: { op: 'mul', args: [{ c: 'e' }, { v: 'x' }] } },
      { rule: 'left-identity', path: [], result: { v: 'x' } },
    ],
  });
  assert.equal(replay.ok, true, replay.reason ?? '');
  assert.deepEqual(replay.final, { v: 'x' });
});

/* ------------------------------------------------------------------ *
 * 4. Planted contradiction: found, recorded, terminal, retained.      *
 * ------------------------------------------------------------------ */

test('a planted contradiction is found, recorded, marked CONTRADICTORY, and retained', () => {
  const registry = new ConceptRegistry();
  const search = findContradiction(PLANTED_CONTRADICTION, { maxDepth: 6, maxTerms: 400 });
  assert.equal(search.found, true, 'contradiction search missed a planted contradiction');
  assert.ok(search.proof, 'contradiction recorded without a proof');
  assert.ok(search.proof!.left.steps.length > 0);
  assert.ok(search.proof!.right.steps.length > 0);

  const record = buildGenesisRecord(
    minimalGenesisInput('planted-contradiction', {
      foundation: PLANTED_CONTRADICTION,
      contradiction: search,
    }),
  );
  assert.equal(record.status.formal, 'CONTRADICTORY');
  assert.ok(record.status.cause_of_death);
  assert.ok(record.validation.contradiction_tests.some((t) => t.found));

  registry.append(record);
  assert.equal(registry.get('planted-contradiction')?.status.formal, 'CONTRADICTORY');
  assert.equal(registry.dead().length, 1, 'dead concepts must stay in the registry');
  assert.equal(registry.size(), 1);
});

test('contradiction search records a negative result too', () => {
  const clean = findContradiction(MONOID_FOUNDATION, { maxDepth: 5, maxTerms: 300 });
  assert.equal(clean.found, false);
  assert.ok(clean.budget_spent > 0, 'a negative result must still record work done');
});

/* ------------------------------------------------------------------ *
 * 5. A re-skinned known structure is caught, with a witness.          *
 * ------------------------------------------------------------------ */

test('a renamed monoid is caught by the equivalence checker with a two-way witness', () => {
  const verdict = checkEquivalence(RESKINNED_MONOID, MONOID_FOUNDATION, { maxModelSize: 4 });
  assert.equal(verdict.equivalent, true, `expected equivalence, got: ${verdict.stage}`);
  assert.ok(verdict.witness, 'EXISTING_EQUIVALENT_FOUND requires a translation witness');
  assert.ok(verdict.witness!.forward, 'witness must interpret the new concept in the known one');
  assert.ok(verdict.witness!.backward, 'witness must interpret back');
  assert.equal(verdict.witness!.forward_verified, true);
  assert.equal(verdict.witness!.backward_verified, true);
  assert.equal(verdict.witness!.forward.operations['blend'], 'mul');
  assert.equal(verdict.witness!.forward.constants['null_flux'], 'e');
});

test('surface similarity alone does not justify EXISTING_EQUIVALENT_FOUND', () => {
  const notEquivalent = checkEquivalence(PLANTED_CONTRADICTION, MONOID_FOUNDATION, {
    maxModelSize: 4,
  });
  assert.equal(notEquivalent.equivalent, false);
  assert.equal(notEquivalent.witness, null);
});

/* ------------------------------------------------------------------ *
 * 6. Novelty is unreachable while no corpus is attached.              *
 * ------------------------------------------------------------------ */

test('no novelty status beyond PRIOR_ART_UNCHECKED while no corpus is attached', () => {
  assert.equal(hasPriorArtCorpus(), false);

  const record = buildGenesisRecord(minimalGenesisInput('novelty-attempt'));
  assert.equal(record.status.novelty, 'PRIOR_ART_UNCHECKED');

  assert.throws(
    () => transitionNovelty(record, 'NOVELTY_CONFIRMED', {}),
    /NOVELTY_CONFIRMED_REQUIRES_CORPUS/,
  );

  // POSSIBLY_NOVEL requires an argued distinguishing behavior.
  assert.throws(
    () => transitionNovelty(record, 'POSSIBLY_NOVEL', {}),
    /POSSIBLY_NOVEL_REQUIRES_DISTINGUISHING_BEHAVIOR/,
  );

  // EXISTING_EQUIVALENT_FOUND requires a verified two-way witness.
  assert.throws(
    () => transitionNovelty(record, 'EXISTING_EQUIVALENT_FOUND', {}),
    /EXISTING_EQUIVALENT_REQUIRES_WITNESS/,
  );

  const argued = transitionNovelty(record, 'POSSIBLY_NOVEL', {
    distinguishing_behavior:
      'Composition is non-associative under the declared collapse rule, which no monoid admits.',
  });
  assert.equal(argued.status.novelty, 'POSSIBLY_NOVEL');
});

/* ------------------------------------------------------------------ *
 * 7. Lineage hashes are tamper-evident.                               *
 * ------------------------------------------------------------------ */

test('altering any genesis field anywhere in a lineage breaks the lineage hash', () => {
  const registry = new ConceptRegistry();
  const parent = buildGenesisRecord(minimalGenesisInput('lineage-parent'));
  registry.append(parent);
  const child = buildGenesisRecord(
    minimalGenesisInput('lineage-child', { parents: [parent] }),
  );
  registry.append(child);
  const grandchild = buildGenesisRecord(
    minimalGenesisInput('lineage-grandchild', { parents: [child] }),
  );
  registry.append(grandchild);

  assert.equal(verifyLineage(grandchild, registry).ok, true);

  // Tamper with a field on the ancestor, deep inside formal content.
  const tamperedParent = structuredClone(parent);
  (tamperedParent.formal.definition as string) = parent.formal.definition + ' (edited)';
  assert.notEqual(computeLineageHash(tamperedParent), parent.identity.lineage_hash);

  // And the break propagates: recomputing the chain from the tampered ancestor
  // yields a different hash at every descendant.
  const tamperedChild = buildGenesisRecord(
    minimalGenesisInput('lineage-child', { parents: [tamperedParent] }),
  );
  assert.notEqual(tamperedChild.identity.lineage_hash, child.identity.lineage_hash);

  const brokenRegistry = new ConceptRegistry();
  brokenRegistry.append(tamperedParent);
  brokenRegistry.append(child);
  brokenRegistry.append(grandchild);
  const check = verifyLineage(grandchild, brokenRegistry);
  assert.equal(check.ok, false);
  assert.ok(check.broken.length > 0);
});

/* ------------------------------------------------------------------ *
 * 8. The registry is append-only.                                     *
 * ------------------------------------------------------------------ */

test('the registry rejects edits and deletes; only appends succeed', () => {
  const registry = new ConceptRegistry();
  const record = buildGenesisRecord(minimalGenesisInput('append-only'));
  registry.append(record);

  const anyReg = registry as unknown as Record<string, unknown>;
  assert.equal(typeof anyReg.update, 'undefined', 'registry must expose no update');
  assert.equal(typeof anyReg.delete, 'undefined', 'registry must expose no delete');
  assert.equal(typeof anyReg.remove, 'undefined', 'registry must expose no remove');

  assert.throws(() => registry.append(record), /DUPLICATE_ID/);

  const fetched = registry.get('append-only')!;
  assert.equal(Object.isFrozen(fetched), true);
  assert.throws(() => {
    (fetched.status as { formal: string }).formal = 'DERIVATION_VERIFIED';
  }, TypeError);

  const all = registry.all();
  assert.throws(() => {
    (all as unknown as unknown[]).push({});
  }, TypeError);

  // Corrections are appends that reference the superseded record.
  const correction = buildGenesisRecord(
    minimalGenesisInput('append-only-v2', { supersedes: 'append-only' }),
  );
  registry.append(correction);
  assert.equal(registry.size(), 2, 'superseded records are retained');
  assert.equal(registry.get('append-only')?.identity.id, 'append-only');
  assert.equal(registry.get('append-only-v2')?.supersedes, 'append-only');
});

/* ------------------------------------------------------------------ *
 * 9. End-to-end provenance on generated concepts.                     *
 * ------------------------------------------------------------------ */

test('every generated concept retains complete provenance end to end', async () => {
  const { runFirstGeneration } = await import('../../src/foundry/run.ts');
  const report = await runFirstGeneration({ seed: 'acceptance', maxModelSize: 4 });

  assert.ok(report.foundations.length >= 3, 'need three substantially different foundations');
  assert.ok(report.registry.size() >= 9, 'need at least three concepts per foundation');

  for (const record of report.registry.all()) {
    assert.equal(record.epistemic_class, 'CONSTRUCTED_ARTIFACT');
    assert.deepEqual(record.citations, []);
    assert.ok(record.identity.lineage_hash, `${record.identity.id} has no lineage hash`);
    assert.equal(
      computeLineageHash(record),
      record.identity.lineage_hash,
      `${record.identity.id} lineage hash does not match its content`,
    );
    assert.equal(verifyLineage(record, report.registry).ok, true, `${record.identity.id} lineage broken`);
    assert.ok(record.formal.definition.length > 0);
    assert.ok(record.formal.primitives.length > 0);
    assert.ok(record.formal.operations.length > 0);
    assert.equal(record.status.novelty, 'PRIOR_ART_UNCHECKED');
    assert.ok(record.validation.contradiction_tests.length > 0, `${record.identity.id} untested`);
    for (const consequence of record.behavior.consequences) {
      const replay = replayTrace(record.formal.foundation, consequence.trace);
      assert.equal(replay.ok, true, `${record.identity.id}: ${consequence.id} trace does not replay`);
    }
  }

  // Each foundation contributed at least one nontrivial derived consequence.
  for (const foundation of report.foundations) {
    const nontrivial = report.consequences.filter(
      (c) => c.foundation_id === foundation.id && c.nontrivial,
    );
    assert.ok(nontrivial.length >= 1, `${foundation.id} produced no nontrivial consequence`);
  }

  // Benchmarks were pre-registered before any result was recorded.
  for (const benchmark of report.benchmarks) {
    assert.ok(benchmark.preregistered_at);
    assert.ok(benchmark.prereg_hash);
    for (const result of benchmark.results) {
      assert.equal(result.prereg_hash, benchmark.prereg_hash, 'post-hoc benchmark detected');
    }
  }
});

test('the generator rejects a new name with no new formal behavior', async () => {
  const { proposeConcept } = await import('../../src/foundry/generator.ts');
  const rejected = proposeConcept({
    id: 'renamed-nothing',
    name: 'Fluxoid',
    parent: MONOID_FOUNDATION,
    addedOperations: [],
    addedRules: [],
    addedInvariants: [],
  });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.rejections.includes('NO_NEW_FORMAL_BEHAVIOR'));
});
