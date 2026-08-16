import type { EquivalenceVerdict, Foundation } from './types.ts';

/* ------------------------------------------------------------------ *
 * Prior-art ingestion interface.                                      *
 *                                                                     *
 * A stub, but a real seam. This is the ONLY place NOVELTY_CONFIRMED   *
 * can ever be wired to. While no corpus is attached, that status has  *
 * no reachable transition at all — see status.ts.                     *
 * ------------------------------------------------------------------ */

export interface PriorArtCorpus {
  corpus_id: string;
  description: string;
  record_count: number;
  content_sha256: string;
  /** Search the corpus for a structure equivalent to the given foundation. */
  search(foundation: Foundation): Promise<EquivalenceVerdict[]>;
}

let attached: PriorArtCorpus | null = null;

export function attachPriorArtCorpus(corpus: PriorArtCorpus): void {
  if (!corpus || typeof corpus.search !== 'function' || !corpus.content_sha256) {
    throw new Error('PRIOR_ART_CORPUS_REJECTED: INCOMPLETE_DESCRIPTOR');
  }
  attached = corpus;
}

export function detachPriorArtCorpus(): void {
  attached = null;
}

export function priorArtCorpus(): PriorArtCorpus | null {
  return attached;
}

export function hasPriorArtCorpus(): boolean {
  return attached !== null;
}

export async function searchPriorArt(foundation: Foundation): Promise<{
  available: boolean;
  reason: string | null;
  verdicts: EquivalenceVerdict[];
}> {
  if (!attached) {
    return {
      available: false,
      reason: 'NO_CORPUS_ATTACHED — absence of a found equivalent proves nothing.',
      verdicts: [],
    };
  }
  return { available: true, reason: null, verdicts: await attached.search(foundation) };
}
