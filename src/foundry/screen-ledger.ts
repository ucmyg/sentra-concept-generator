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
  /** Opens a run. Carries the provenance that lets a later reader decide, by
   *  comparison rather than trust, what this run could possibly have covered. */
  | 'RUN_HEADER'
  /** A fact about the record itself — an incident, a loss, a closing tally.
   *  Bound to no candidate. The chain records its own history too. */
  | 'OBSERVATION'
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
  /** Empty for RUN_HEADER / OBSERVATION — those are bound to no candidate. */
  candidate_id: string;
  /**
   * Content-derived identity: sha256 over the parent, the introduced operation
   * and the candidate rule.
   *
   * candidate_id is POSITIONAL — "<parent>-gen-<op>-<index>" — and the index is
   * the position within that run's batch. Under sampling the batch is a seeded
   * shuffle, so the same candidate_id names a DIFFERENT rule in every run. An
   * audit that compared two runs by candidate_id would report a pile of
   * reversals that are pure aliasing, and that is exactly what happened when
   * the audit run was first compared against the exhaustive one: 22 of 36
   * verdicts appeared to have flipped and not one of them had.
   *
   * Empty for RUN_HEADER / OBSERVATION.
   */
  candidate_hash: string;
  parent_id: string;
  /** Null for RUN_HEADER / OBSERVATION. Readers filtering on kind==='VERDICT'
   *  are unaffected; nothing that was a verdict became nullable. */
  outcome: ScreenOutcome | null;
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

/**
 * The identity a cross-run audit must key on. Derived from what the candidate
 * IS — its parent, the operation it introduces, and its rule — never from
 * where it happened to sit in some run's batch.
 */
export function candidateHash(result: ScreenResult): string {
  return sha256(
    stableStringify({
      parent_id: result.parent_id,
      operation: { name: result.new_operation.name, arity: result.new_operation.arity },
      rule: result.rule,
    }),
  );
}

/** Called with each entry the instant it is appended, before control returns. */
export type LedgerSink = (entry: ScreenLedgerEntry) => void;

export class ScreenLedger {
  readonly #entries: ScreenLedgerEntry[] = [];
  readonly #sink: LedgerSink | null;

  /**
   * A sink makes the ledger crash-safe. Without one, every verdict of a
   * multi-hour run lives in this array until the process chooses to write it
   * out — and a session that dies at hour three leaves nothing, which is the
   * exact failure this ledger was built to end. With one, each entry is
   * durable at the moment it is decided and a killed process leaves a valid
   * partial chain that a resume can append to.
   */
  constructor(sink?: LedgerSink) {
    this.#sink = sink ?? null;
  }

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
    // Durable before the caller continues. If the sink throws, the run stops:
    // continuing to screen while verdicts are silently not landing is the
    // in-memory-history bug wearing a disguise.
    this.#sink?.(entry);
    return entry;
  }

  /**
   * Open a run. `provenance` is free-form and is what a future reader compares
   * against another run's header to decide whether this run's coverage was a
   * superset — exhaustive flag, enumeration bounds, operation set, sample size.
   * Narration in a chat log proves nothing; this is in the chain.
   */
  openRun(runSeed: string, provenance: unknown, cause: string): ScreenLedgerEntry {
    return this.#append({
      kind: 'RUN_HEADER',
      run_seed: runSeed,
      candidate_id: '',
      candidate_hash: '',
      parent_id: '',
      outcome: null,
      detail: 'run header',
      evidence: provenance,
      supersedes: null,
      cause,
    });
  }

  /**
   * Record a fact about the record itself: an incident, a destroyed artifact,
   * a closing tally. A ledger that only ever documents other people's failures
   * is decoration — this is how it documents its own.
   */
  observe(runSeed: string, detail: string, payload: unknown, cause: string): ScreenLedgerEntry {
    return this.#append({
      kind: 'OBSERVATION',
      run_seed: runSeed,
      candidate_id: '',
      candidate_hash: '',
      parent_id: '',
      outcome: null,
      detail,
      evidence: payload,
      supersedes: null,
      cause,
    });
  }

  /** Record a verdict exactly as the screener issued it. */
  record(runSeed: string, result: ScreenResult): ScreenLedgerEntry {
    return this.#append({
      kind: 'VERDICT',
      run_seed: runSeed,
      candidate_id: result.candidate_id,
      candidate_hash: candidateHash(result),
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
      candidate_hash: original.candidate_hash,
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
  static fromEntries(entries: readonly ScreenLedgerEntry[], sink?: LedgerSink): ScreenLedger {
    const ledger = new ScreenLedger(sink);
    // Pushed directly, NOT through #append: loading must not re-hash and must
    // not re-emit to the sink. A resume appends after these; it never rewrites
    // them, so a killed run's partial chain is extended, not restarted.
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
