import { computeLineageHash } from './genesis.ts';
import { hasPriorArtCorpus, priorArtCorpus } from './prior-art.ts';
import type {
  FormalStatus,
  GenesisRecord,
  NoveltyStatus,
  TranslationWitness,
  UtilityStatus,
} from './types.ts';

/* ------------------------------------------------------------------ *
 * Three orthogonal axes. Transitions are a table, not a convention.   *
 * ------------------------------------------------------------------ */

const FORMAL_EDGES: Record<FormalStatus, FormalStatus[]> = {
  GENERATED_CANDIDATE: ['FORMALIZED', 'CONTRADICTORY'],
  FORMALIZED: ['INTERNALLY_CONSISTENT', 'CONTRADICTORY'],
  INTERNALLY_CONSISTENT: ['DERIVATION_VERIFIED', 'CONTRADICTORY'],
  DERIVATION_VERIFIED: ['CONTRADICTORY'],
  // Terminal. A contradiction is a recorded outcome, not a stage to leave.
  CONTRADICTORY: [],
};

const UTILITY_EDGES: Record<UtilityStatus, UtilityStatus[]> = {
  UNTESTED: ['EXPERIMENTALLY_USEFUL', 'NO_MEASURED_ADVANTAGE'],
  EXPERIMENTALLY_USEFUL: ['NO_MEASURED_ADVANTAGE'],
  NO_MEASURED_ADVANTAGE: ['EXPERIMENTALLY_USEFUL'],
};

/**
 * Novelty edges are computed, not literal, because one of them does not
 * exist while no corpus is attached. There is no way to spell
 * NOVELTY_CONFIRMED into the table by hand.
 */
function noveltyEdges(): Record<NoveltyStatus, NoveltyStatus[]> {
  const corpus = hasPriorArtCorpus();
  return {
    PRIOR_ART_UNCHECKED: [
      'EXISTING_EQUIVALENT_FOUND',
      'POSSIBLY_NOVEL',
      ...(corpus ? (['NOVELTY_CONFIRMED'] as NoveltyStatus[]) : []),
    ],
    POSSIBLY_NOVEL: [
      'EXISTING_EQUIVALENT_FOUND',
      ...(corpus ? (['NOVELTY_CONFIRMED'] as NoveltyStatus[]) : []),
    ],
    EXISTING_EQUIVALENT_FOUND: [],
    NOVELTY_CONFIRMED: ['EXISTING_EQUIVALENT_FOUND'],
  };
}

export interface NoveltyEvidence {
  distinguishing_behavior?: string;
  witness?: TranslationWitness | null;
  /**
   * The record of an actual prior-art search. Attaching a corpus is not
   * evidence of anything; SEARCHING it exhaustively and finding nothing is.
   */
  corpus_search?: {
    corpus_id: string;
    corpus_content_sha256: string;
    foundation_id: string;
    entries_compared: number;
    entries_total: number;
    exhaustive: boolean;
    equivalents: unknown[];
    /** Written by the corpus that ran the search. Verified, never trusted. */
    search_sha256: string;
  } | null;
}

function revise(
  record: GenesisRecord,
  patch: Partial<GenesisRecord['status']>,
  suffix: string,
): GenesisRecord {
  const parentHash = computeLineageHash(record);
  const revised: GenesisRecord = {
    ...record,
    supersedes: record.identity.id,
    identity: {
      ...record.identity,
      id: `${record.identity.id}#${suffix}`,
      parents: [record.identity.id],
      parent_lineage_hashes: [parentHash],
      lineage_hash: null,
    },
    status: { ...record.status, ...patch },
  };
  revised.identity.lineage_hash = computeLineageHash(revised);
  return revised;
}

export function transitionNovelty(
  record: GenesisRecord,
  target: NoveltyStatus,
  evidence: NoveltyEvidence,
): GenesisRecord {
  const from = record.status.novelty;

  if (target === 'NOVELTY_CONFIRMED') {
    if (!hasPriorArtCorpus()) {
      throw new Error(
        'NOVELTY_CONFIRMED_REQUIRES_CORPUS: no prior-art corpus is attached, so this ' +
          'transition does not exist. Nothing is new merely because we generated it.',
      );
    }
    // A corpus being attached is not evidence. The search has to have run.
    const search = evidence.corpus_search;
    if (!search) {
      throw new Error(
        'NOVELTY_CONFIRMED_REQUIRES_SEARCH_RECORD: a corpus is attached but no prior-art ' +
          'search was recorded. Having a library is not the same as having read it.',
      );
    }
    if (search.foundation_id !== record.formal.foundation.id) {
      throw new Error(
        `NOVELTY_CONFIRMED_SEARCH_MISMATCH: search covered ${search.foundation_id}, ` +
          `not ${record.formal.foundation.id}.`,
      );
    }
    if (!search.exhaustive || search.entries_compared !== search.entries_total) {
      throw new Error(
        'NOVELTY_CONFIRMED_REQUIRES_EXHAUSTIVE_SEARCH: ' +
          `${search.entries_compared} of ${search.entries_total} entries compared. ` +
          'A truncated search that finds nothing has found nothing.',
      );
    }
    // The record must describe a search THIS corpus ran, against the corpus as
    // it stands now. A true finding goes stale the moment the library grows.
    const corpus = priorArtCorpus()!;
    const check = corpus.verifySearchRecord(search);
    if (!check.ok) {
      if (check.reason === 'CORPUS_MISMATCH') {
        throw new Error(
          `NOVELTY_CONFIRMED_SEARCH_CORPUS_MISMATCH: the search covered corpus ` +
            `${search.corpus_id}, but ${corpus.corpus_id} is what is attached.`,
        );
      }
      if (check.reason === 'STALE') {
        throw new Error(
          'NOVELTY_CONFIRMED_SEARCH_RECORD_STALE: the corpus has changed since this ' +
            'search ran. Finding nothing in a smaller library is a weaker claim; ' +
            'search again against what we know now.',
        );
      }
      throw new Error(
        'NOVELTY_CONFIRMED_SEARCH_RECORD_UNSEALED: this record was not produced by ' +
          'the attached corpus. A description of a search is not a search.',
      );
    }
    if (search.equivalents.length > 0) {
      throw new Error(
        'NOVELTY_CONFIRMED_CONTRADICTED_BY_SEARCH: the prior-art search found ' +
          `${search.equivalents.length} equivalent structure(s).`,
      );
    }
    const argued = String(evidence.distinguishing_behavior ?? record.status.distinguishing_behavior ?? '').trim();
    if (argued.length === 0) {
      throw new Error(
        'NOVELTY_CONFIRMED_REQUIRES_DISTINGUISHING_BEHAVIOR: state what this concept does ' +
          'that no known structure does. Not finding an equivalent is not an argument.',
      );
    }
  }
  if (target === 'POSSIBLY_NOVEL') {
    const argued = String(evidence.distinguishing_behavior ?? '').trim();
    if (argued.length === 0) {
      throw new Error(
        'POSSIBLY_NOVEL_REQUIRES_DISTINGUISHING_BEHAVIOR: state something this concept ' +
          'does that the nearest known structure does not. Failing to find an equivalent ' +
          'proves nothing by itself.',
      );
    }
  }
  if (target === 'EXISTING_EQUIVALENT_FOUND') {
    const w = evidence.witness;
    if (!w || !w.forward_verified || !w.backward_verified) {
      throw new Error(
        'EXISTING_EQUIVALENT_REQUIRES_WITNESS: a verified two-way translation witness is ' +
          'required. Surface similarity is not equivalence.',
      );
    }
  }

  const allowed = noveltyEdges()[from] ?? [];
  if (!allowed.includes(target)) {
    throw new Error(`NOVELTY_TRANSITION_NOT_PERMITTED: ${from} -> ${target}`);
  }

  return revise(
    record,
    {
      novelty: target,
      distinguishing_behavior:
        evidence.distinguishing_behavior ?? record.status.distinguishing_behavior,
      translation_witness: evidence.witness ?? record.status.translation_witness,
    },
    `novelty-${target.toLowerCase()}`,
  );
}

export function transitionFormal(
  record: GenesisRecord,
  target: FormalStatus,
  causeOfDeath: string | null = null,
): GenesisRecord {
  const from = record.status.formal;
  if (!(FORMAL_EDGES[from] ?? []).includes(target)) {
    throw new Error(`FORMAL_TRANSITION_NOT_PERMITTED: ${from} -> ${target}`);
  }
  if (target === 'CONTRADICTORY' && !causeOfDeath) {
    throw new Error('CONTRADICTORY_REQUIRES_CAUSE_OF_DEATH');
  }
  return revise(
    record,
    { formal: target, cause_of_death: causeOfDeath ?? record.status.cause_of_death },
    `formal-${target.toLowerCase()}`,
  );
}

export function transitionUtility(
  record: GenesisRecord,
  target: UtilityStatus,
): GenesisRecord {
  const from = record.status.utility;
  if (!(UTILITY_EDGES[from] ?? []).includes(target)) {
    throw new Error(`UTILITY_TRANSITION_NOT_PERMITTED: ${from} -> ${target}`);
  }
  return revise(record, { utility: target }, `utility-${target.toLowerCase()}`);
}

export { hasPriorArtCorpus };
