import { sha256, stableStringify } from '../canonical-json.ts';

import type { ScreenOutcome, ScreenResult } from './screen.ts';

/* ------------------------------------------------------------------ *
 * THE SCREENING LEDGER                                                *
 *                                                                     *
 * Every verdict the screener issues, written down, hash-chained, and  *
 * never rewritten.                                                    *
 *                                                                     *
 * Why this exists: an audit of every historical EQUIVALENT_TO_KNOWN   *
 * verdict was ordered and came back empty — not because the killer    *
 * never fired, but because screen.ts persisted nothing. Every kill it *
 * ever issued lived in process memory and died at exit.               *
 *                                                                     *
 * A verdict that cannot be audited cannot be reversed, so an error in *
 * it is permanent by construction. That is worse than a verdict found *
 * to be wrong: a wrong verdict on the record can be given back.       *
 *                                                                     *
 * Corrections are APPENDS carrying `supersedes`. There is no update   *
 * and no delete. A reversal does not erase the original kill; it sits *
 * after it in the chain, pointing back at it, saying what it got      *
 * wrong. Both stay readable forever.                                  *
 * ------------------------------------------------------------------ */

export type LedgerEntryKind =
  /** The original verdict as issued by a screening run. */
  | 'VERDICT'
  /** A re-examination that upholds an earlier verdict, citing honest evidence. */
  | 'CONFIRMED'
  /** A re-examination that overturns it. The concept returns to the pipeline. */
  | 'REVERSED'
  /** The original carried no evidence, so it can be neither upheld nor
   *  overturned. Treated as reversed for pipeline purposes: an unproven
   *  terminal verdict cannot stand. */
  | 'VERDICT_UNVERIFIABLE';

export interface ScreenLedgerEntry {
  seq: number;
  kind: LedgerEntryKind;
  run_seed: string;
  candidate_id: string;
  parent_id: string;
  outcome: ScreenOutcome;
  detail: string;
  /** Present for terminal verdicts. Absent evidence is itself recorded. */
  evidence: unknown;
  /** Set on CONFIRMED / REVERSED / VERDICT_UNVERIFIABLE — the seq it revisits. */
  supersedes: number | null;
  /** Why this entry was written, in words, for whoever reads it later. */
  cause: string | null;
  prev_hash: string;
  entry_hash: string;
}

const GENESIS_HASH = '0'.repeat(64);

/** Hash covers the entry with its own hash blanked, chained to the previous. */
function computeEntryHash(entry: Omit<ScreenLedgerEntry, 'entry_hash'>): string {
  return sha256(`${stableStringify({ ...entry, entry_hash: null })}\n${entry.prev_hash}`);
}

export class ScreenLedger {
  readonly #entries: ScreenLedgerEntry[] = [];

  get length(): number {
    return this.#entries.length;
  }

  #tipHash(): string {
    return this.#entries.at(-1)?.entry_hash ?? GENESIS_HASH;
  }

  #append(
    fields: Omit<ScreenLedgerEntry, 'seq' | 'prev_hash' | 'entry_hash'>,
  ): ScreenLedgerEntry {
    const prev_hash = this.#tipHash();
    const skeleton = { ...fields, seq: this.#entries.length, prev_hash };
    const entry: ScreenLedgerEntry = { ...skeleton, entry_hash: computeEntryHash(skeleton) };
    Object.freeze(entry);
    this.#entries.push(entry);
    return entry;
  }

  /** Record a verdict exactly as the screener issued it. */
  record(runSeed: string, result: ScreenResult): ScreenLedgerEntry {
    return this.#append({
      kind: 'VERDICT',
      run_seed: runSeed,
      candidate_id: result.candidate_id,
      parent_id: result.parent_id,
      outcome: result.outcome,
      detail: result.detail,
      evidence: result.equivalence_evidence ?? null,
      supersedes: null,
      cause: null,
    });
  }

  /**
   * Re-examine an earlier verdict and append the finding. The original is
   * never touched — this is the correction, sitting after it in the chain.
   */
  revisit(
    seq: number,
    kind: Exclude<LedgerEntryKind, 'VERDICT'>,
    cause: string,
  ): ScreenLedgerEntry {
    const original = this.#entries[seq];
    if (!original) throw new Error(`LEDGER_REVISIT_REJECTED: NO_SUCH_ENTRY:${seq}`);
    if (original.kind !== 'VERDICT') {
      throw new Error(`LEDGER_REVISIT_REJECTED: NOT_AN_ORIGINAL_VERDICT:${seq}`);
    }
    return this.#append({
      kind,
      run_seed: original.run_seed,
      candidate_id: original.candidate_id,
      parent_id: original.parent_id,
      outcome: original.outcome,
      detail: original.detail,
      evidence: original.evidence,
      supersedes: seq,
      cause,
    });
  }

  /** Frozen view. Callers cannot splice, push, or reorder the ledger. */
  all(): readonly ScreenLedgerEntry[] {
    return Object.freeze(this.#entries.slice());
  }

  /**
   * Every terminal verdict, with whether its evidence survives inspection.
   *
   * This is the query the tainted-history audit needed and did not have. A
   * kill whose `evidence` is null is UNVERIFIABLE by definition — nobody can
   * check a proof that was never written down.
   */
  terminalVerdicts(): readonly ScreenLedgerEntry[] {
    return Object.freeze(
      this.#entries.filter((e) => e.kind === 'VERDICT' && e.outcome === 'EQUIVALENT_TO_KNOWN'),
    );
  }

  /** The live ruling on an entry: its latest revisit, or the original. */
  currentKind(seq: number): LedgerEntryKind | null {
    const original = this.#entries[seq];
    if (!original) return null;
    const revisits = this.#entries.filter((e) => e.supersedes === seq);
    return revisits.at(-1)?.kind ?? original.kind;
  }

  /**
   * Load entries that came from somewhere untrusted — a file on disk, another
   * process — WITHOUT recomputing their hashes. Nothing here is believed. Call
   * `verify()` on the result; that is the whole point of loading this way.
   */
  static fromEntries(entries: readonly ScreenLedgerEntry[]): ScreenLedger {
    const ledger = new ScreenLedger();
    for (const e of entries) ledger.#entries.push(Object.freeze({ ...e }));
    return ledger;
  }

  /**
   * Recompute every hash. Any edit anywhere breaks the chain from there on.
   *
   * Chaining uses the RECOMPUTED hash of the previous entry, never its stored
   * one — same reasoning as lineage hashing in genesis.ts. Trusting a stored
   * hash would let an edited entry keep a valid-looking tail behind it, which
   * is exactly the forgery this ledger exists to make impossible.
   */
  verify(): { ok: boolean; broken: Array<{ seq: number; reason: string }> } {
    const broken: Array<{ seq: number; reason: string }> = [];
    let expectedPrev = GENESIS_HASH;
    for (const entry of this.#entries) {
      if (entry.prev_hash !== expectedPrev) {
        broken.push({ seq: entry.seq, reason: 'PREV_HASH_MISMATCH' });
      }
      const { entry_hash, ...rest } = entry;
      const recomputed = computeEntryHash(rest);
      if (recomputed !== entry_hash) {
        broken.push({ seq: entry.seq, reason: 'ENTRY_HASH_MISMATCH' });
      }
      expectedPrev = recomputed;
    }
    return { ok: broken.length === 0, broken };
  }

  /** Newline-delimited canonical JSON — the on-disk form is append-only too. */
  toJSONL(): string {
    return this.#entries.map((e) => stableStringify(e)).join('\n');
  }
}
