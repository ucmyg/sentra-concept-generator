import { sha256, stableStringify } from '../canonical-json.ts';

import { classifyAxiom, classifyStatement, type ClassRejectionCode } from './classes.ts';
import { replayTrace } from './kernel.ts';
import {
  FOUNDRY_GENESIS_SCHEMA,
  FOUNDRY_NATIVE_SCHEMA,
  type FormalStatus,
  type GenesisInput,
  type GenesisRecord,
} from './types.ts';

/* ------------------------------------------------------------------ *
 * Lineage hashing                                                     *
 *                                                                     *
 * The hash covers the whole canonical record with its own hash field  *
 * blanked, chained with the *recomputed* hashes of its parents. It is *
 * deliberately not the parents' stored hashes: trusting a stored hash *
 * would let an edited ancestor keep a valid-looking descendant.       *
 * ------------------------------------------------------------------ */

export function computeLineageHash(record: GenesisRecord): string {
  const skeleton = {
    ...record,
    identity: { ...record.identity, lineage_hash: null },
  };
  const parents = [...record.identity.parent_lineage_hashes].sort();
  return sha256(`${stableStringify(skeleton)}\n${parents.join('\n')}`);
}

export interface LineageCheck {
  ok: boolean;
  broken: Array<{ id: string; reason: string; expected: string; actual: string | null }>;
  checked: string[];
}

interface RecordLookup {
  get(id: string): GenesisRecord | undefined;
}

export function verifyLineage(
  record: GenesisRecord,
  lookup: RecordLookup,
  seen: Set<string> = new Set(),
): LineageCheck {
  const broken: LineageCheck['broken'] = [];
  const checked: string[] = [];

  const walk = (node: GenesisRecord): void => {
    if (seen.has(node.identity.id)) return;
    seen.add(node.identity.id);
    checked.push(node.identity.id);

    const recomputed = computeLineageHash(node);
    if (recomputed !== node.identity.lineage_hash) {
      broken.push({
        id: node.identity.id,
        reason: 'LINEAGE_HASH_DOES_NOT_MATCH_CONTENT',
        expected: recomputed,
        actual: node.identity.lineage_hash,
      });
    }

    node.identity.parents.forEach((parentId, i) => {
      const parent = lookup.get(parentId);
      if (!parent) {
        broken.push({
          id: node.identity.id,
          reason: `PARENT_NOT_IN_REGISTRY:${parentId}`,
          expected: node.identity.parent_lineage_hashes[i] ?? '',
          actual: null,
        });
        return;
      }
      const parentHash = computeLineageHash(parent);
      if (parentHash !== node.identity.parent_lineage_hashes[i]) {
        broken.push({
          id: node.identity.id,
          reason: `PARENT_LINEAGE_HASH_MISMATCH:${parentId}`,
          expected: node.identity.parent_lineage_hashes[i] ?? '',
          actual: parentHash,
        });
      }
      walk(parent);
    });
  };

  walk(record);
  return { ok: broken.length === 0, broken, checked };
}

/* ------------------------------------------------------------------ *
 * Record construction                                                 *
 * ------------------------------------------------------------------ */

function deriveFormalStatus(input: GenesisInput): { status: FormalStatus; cause: string | null } {
  const contradiction = input.contradiction_tests.find((t) => t.found);
  if (contradiction) {
    const pair = contradiction.proof?.distinct_pair;
    return {
      status: 'CONTRADICTORY',
      cause: pair
        ? `A single term derives both '${pair[0]}' and '${pair[1]}', which the system declares distinct. Proof retained.`
        : 'A contradiction was found and its proof is retained.',
    };
  }
  const hasConsequences = input.consequences.length > 0;
  const allReplay =
    hasConsequences &&
    input.consequences.every((c) => replayTrace(input.foundation, c.trace).ok);
  if (allReplay) return { status: 'DERIVATION_VERIFIED', cause: null };
  if (input.model_attempts.some((m) => m.found)) {
    return { status: 'INTERNALLY_CONSISTENT', cause: null };
  }
  if (input.axioms.length > 0) return { status: 'FORMALIZED', cause: null };
  return { status: 'GENERATED_CANDIDATE', cause: null };
}

export function buildGenesisRecord(input: GenesisInput): GenesisRecord {
  const { status, cause } = deriveFormalStatus(input);
  const parentHashes = input.parents.map((p) => computeLineageHash(p));

  const record: GenesisRecord = {
    schema_version: FOUNDRY_GENESIS_SCHEMA,
    epistemic_class: 'CONSTRUCTED_ARTIFACT',
    citations: [],
    supersedes: input.supersedes ?? null,
    identity: {
      id: input.id,
      name: input.name,
      created_at: input.created_at,
      parents: input.parents.map((p) => p.identity.id),
      parent_lineage_hashes: parentHashes,
      lineage_hash: null,
    },
    formal: {
      foundation: input.foundation,
      primitives: input.primitives,
      axioms: input.axioms,
      definition: input.definition,
      native: {
        schema: FOUNDRY_NATIVE_SCHEMA,
        semantics:
          'Terms are variables, constants, or operator applications. Semantics is the ' +
          'rewrite relation generated by the declared rules, executed by the trusted kernel.',
        kernel_executable: true,
      },
      operations: input.operations,
      invalid_operations: input.invalid_operations,
      inference_rules: input.inference_rules,
      identity_conditions: input.identity_conditions,
      equivalence_conditions: input.equivalence_conditions,
      invariants: input.invariants,
    },
    behavior: {
      examples: input.examples,
      counterexamples: input.counterexamples,
      boundary_cases: input.boundary_cases,
      consequences: input.consequences,
      model_attempts: input.model_attempts,
    },
    validation: {
      contradiction_tests: input.contradiction_tests,
      usefulness_tests: input.usefulness_tests,
      conventional_comparison: input.conventional_comparison,
    },
    status: {
      formal: status,
      // Never anything else at birth. There is no corpus, so there is no
      // transition out of this except through transitionNovelty().
      novelty: 'PRIOR_ART_UNCHECKED',
      utility: input.usefulness_tests.some((t) => t.advantage)
        ? 'EXPERIMENTALLY_USEFUL'
        : input.usefulness_tests.length > 0
          ? 'NO_MEASURED_ADVANTAGE'
          : 'UNTESTED',
      confidence: input.confidence,
      distinguishing_behavior: null,
      translation_witness: null,
      cause_of_death: cause,
    },
  };

  record.identity.lineage_hash = computeLineageHash(record);
  return record;
}

/* ------------------------------------------------------------------ *
 * Admission                                                           *
 * ------------------------------------------------------------------ */

export interface AdmissionResult {
  ok: boolean;
  rejections: ClassRejectionCode[];
  notes: string[];
}

export function admitConstructedArtifact(record: GenesisRecord): AdmissionResult {
  const rejections: ClassRejectionCode[] = [];
  const notes: string[] = [];

  if (record.epistemic_class !== 'CONSTRUCTED_ARTIFACT') {
    rejections.push('UNKNOWN_EPISTEMIC_CLASS');
  }
  if (Array.isArray(record.citations) && record.citations.length > 0) {
    rejections.push('CONSTRUCTED_ARTIFACT_CARRIES_CITATIONS');
    notes.push(
      'A construction that cites a source is reporting, not proposing. Route it to the evidence gate.',
    );
  }

  const definition = classifyStatement({
    text: record.formal.definition,
    declared_class: 'CONSTRUCTED_ARTIFACT',
  });
  for (const code of definition.rejections) {
    if (!rejections.includes(code)) rejections.push(code);
  }

  for (const axiom of record.formal.axioms) {
    for (const code of classifyAxiom(axiom).rejections) {
      if (!rejections.includes(code)) rejections.push(code);
    }
  }

  if (!record.formal.native.kernel_executable) {
    notes.push('Native form must remain kernel-executable even when untranslatable to notation.');
  }

  return { ok: rejections.length === 0, rejections, notes };
}
