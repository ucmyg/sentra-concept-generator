import { sha256, stableStringify } from '../canonical-json.ts';

import { checkEquivalence } from './equivalence.ts';
import type { EquivalenceVerdict, Foundation } from './types.ts';
import type { PriorArtCorpus, SearchRecordCheck } from './prior-art.ts';

/* ------------------------------------------------------------------ *
 * Prior-art corpus.                                                   *
 *                                                                     *
 * This is the one place the two subsystems touch, so it is the place  *
 * to be most careful about which direction each statement points.     *
 *                                                                     *
 *   A corpus ENTRY is a SOURCED CLAIM. "The monoid axioms are these"  *
 *   is a statement about existing mathematics. It requires verified   *
 *   evidence and a passage hash, exactly like any other external      *
 *   claim, and ingestion refuses it otherwise.                        *
 *                                                                     *
 *   A comparison RESULT is a CONSTRUCTED artifact. "This foundation   *
 *   is interpretable in that structure" is something we derived, not  *
 *   something we read. It needs a witness, not a citation.            *
 *                                                                     *
 * Getting this backwards in either direction is the failure mode the  *
 * whole build is arranged against: a citation standing in for a       *
 * proof, or a construction posing as established fact.                *
 * ------------------------------------------------------------------ */

export const CORPUS_REJECTION_CODES = [
  'CORPUS_ENTRY_MISSING_EVIDENCE',
  'CORPUS_ENTRY_MISSING_PASSAGE',
  'CORPUS_ENTRY_PASSAGE_HASH_MISMATCH',
  'CORPUS_ENTRY_MISSING_SOURCE_ID',
  'CORPUS_ENTRY_MISSING_LOCATOR',
  'CORPUS_ENTRY_MISSING_STRUCTURE',
  'CORPUS_ENTRY_DUPLICATE_ID',
] as const;
export type CorpusRejectionCode = (typeof CORPUS_REJECTION_CODES)[number];

/** The evidence a corpus entry must carry. Mirrors the evidence gate's shape. */
export interface CorpusEvidence {
  source_id: string;
  packet_id: string;
  locator_type: string;
  locator_value: string;
  passage: string;
  passage_sha256: string;
}

export interface CorpusEntry {
  entry_id: string;
  /** Human name of the known structure, e.g. "monoid". */
  name: string;
  /** The structure itself, in the Foundry's own Foundation shape. */
  structure: Foundation;
  /** Required. A corpus entry reports; it does not propose. */
  evidence: CorpusEvidence;
}

export interface IngestionResult {
  ok: boolean;
  admitted: CorpusEntry[];
  rejected: Array<{ entry_id: string; rejections: CorpusRejectionCode[] }>;
}

/**
 * Validate a corpus entry as a SOURCED CLAIM. The passage hash is recomputed,
 * never trusted — a stored hash that nobody recomputes is decoration.
 */
export function validateCorpusEntry(entry: CorpusEntry): CorpusRejectionCode[] {
  const rejections: CorpusRejectionCode[] = [];
  const e = entry?.evidence;
  if (!e || typeof e !== 'object') {
    rejections.push('CORPUS_ENTRY_MISSING_EVIDENCE');
    return rejections;
  }
  if (typeof e.source_id !== 'string' || e.source_id.length === 0) {
    rejections.push('CORPUS_ENTRY_MISSING_SOURCE_ID');
  }
  if (
    typeof e.locator_type !== 'string' ||
    e.locator_type.length === 0 ||
    typeof e.locator_value !== 'string' ||
    e.locator_value.length === 0
  ) {
    rejections.push('CORPUS_ENTRY_MISSING_LOCATOR');
  }
  if (typeof e.passage !== 'string' || e.passage.trim().length === 0) {
    rejections.push('CORPUS_ENTRY_MISSING_PASSAGE');
  } else if (sha256(e.passage) !== e.passage_sha256) {
    rejections.push('CORPUS_ENTRY_PASSAGE_HASH_MISMATCH');
  }
  const s = entry.structure;
  if (!s || !Array.isArray(s.rules) || !Array.isArray(s.operations)) {
    rejections.push('CORPUS_ENTRY_MISSING_STRUCTURE');
  }
  return rejections;
}

export interface PriorArtSearchRecord {
  corpus_id: string;
  corpus_content_sha256: string;
  foundation_id: string;
  entries_compared: number;
  entries_total: number;
  /** True only when every entry was compared — no truncation, no budget cut. */
  exhaustive: boolean;
  equivalents: Array<{ entry_id: string; name: string; verdict: EquivalenceVerdict }>;
  verdicts: EquivalenceVerdict[];
  /**
   * Seal over every other field, written by the corpus that ran the search.
   * A search record is a report of something that happened. Editing one —
   * blanking the equivalents, widening the coverage — produces a document
   * that describes a search nobody ran, and the seal is what tells them apart.
   */
  search_sha256: string;
}

/** The sealed content of a search record: everything except the seal itself. */
export function sealSearchRecord(record: Omit<PriorArtSearchRecord, 'search_sha256'>): string {
  return sha256(
    stableStringify({
      corpus_id: record.corpus_id,
      corpus_content_sha256: record.corpus_content_sha256,
      foundation_id: record.foundation_id,
      entries_compared: record.entries_compared,
      entries_total: record.entries_total,
      exhaustive: record.exhaustive,
      equivalents: record.equivalents,
      verdicts: record.verdicts,
    }),
  );
}

export class InMemoryPriorArtCorpus implements PriorArtCorpus {
  readonly corpus_id: string;
  readonly description: string;
  readonly #entries: CorpusEntry[] = [];

  constructor(corpus_id: string, description: string) {
    this.corpus_id = corpus_id;
    this.description = description;
  }

  get record_count(): number {
    return this.#entries.length;
  }

  get content_sha256(): string {
    return sha256(
      stableStringify(
        this.#entries.map((e) => ({
          entry_id: e.entry_id,
          structure: e.structure,
          passage_sha256: e.evidence.passage_sha256,
        })),
      ),
    );
  }

  entries(): readonly CorpusEntry[] {
    return Object.freeze(this.#entries.slice());
  }

  /** Ingestion is the evidence gate for corpus entries. No evidence, no entry. */
  ingest(entries: CorpusEntry[]): IngestionResult {
    const admitted: CorpusEntry[] = [];
    const rejected: IngestionResult['rejected'] = [];
    for (const entry of entries) {
      const rejections = validateCorpusEntry(entry);
      if (this.#entries.some((x) => x.entry_id === entry.entry_id)) {
        rejections.push('CORPUS_ENTRY_DUPLICATE_ID');
      }
      if (rejections.length > 0) {
        rejected.push({ entry_id: entry?.entry_id ?? '<missing>', rejections });
        continue;
      }
      this.#entries.push(entry);
      admitted.push(entry);
    }
    return { ok: rejected.length === 0, admitted, rejected };
  }

  /** Compare a foundation against every entry. Interpretation witnesses on. */
  searchDetailed(foundation: Foundation): PriorArtSearchRecord {
    const verdicts: EquivalenceVerdict[] = [];
    const equivalents: PriorArtSearchRecord['equivalents'] = [];
    let compared = 0;
    for (const entry of this.#entries) {
      const verdict = checkEquivalence(foundation, entry.structure, {
        maxModelSize: 3,
        interpretation: true,
      });
      compared += 1;
      verdicts.push(verdict);
      if (verdict.equivalent) {
        equivalents.push({ entry_id: entry.entry_id, name: entry.name, verdict });
      }
    }
    const unsealed = {
      corpus_id: this.corpus_id,
      corpus_content_sha256: this.content_sha256,
      foundation_id: foundation.id,
      entries_compared: compared,
      entries_total: this.#entries.length,
      exhaustive: compared === this.#entries.length,
      equivalents,
      verdicts,
    };
    return { ...unsealed, search_sha256: sealSearchRecord(unsealed) };
  }

  /**
   * Does this record describe a search this corpus ran, against the corpus as
   * it stands right now? Both halves matter. A record that was true last week
   * is not false because someone lied — it is false because we learned more.
   */
  verifySearchRecord(record: unknown): SearchRecordCheck {
    const r = record as PriorArtSearchRecord | null;
    if (!r || typeof r !== 'object') return { ok: false, reason: 'UNSEALED' };
    if (r.corpus_id !== this.corpus_id) return { ok: false, reason: 'CORPUS_MISMATCH' };
    if (typeof r.search_sha256 !== 'string' || sealSearchRecord(r) !== r.search_sha256) {
      return { ok: false, reason: 'UNSEALED' };
    }
    if (r.corpus_content_sha256 !== this.content_sha256) return { ok: false, reason: 'STALE' };
    return { ok: true, reason: null };
  }

  async search(foundation: Foundation): Promise<EquivalenceVerdict[]> {
    return this.searchDetailed(foundation).verdicts;
  }
}
