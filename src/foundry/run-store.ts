import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stableStringify } from '../canonical-json.ts';

import { ScreenLedger, type LedgerSink, type ScreenLedgerEntry } from './screen-ledger.ts';

/* ------------------------------------------------------------------ *
 * RUN-SCOPED OUTPUT                                                   *
 *                                                                     *
 * The screening entrypoint used to write screen-ledger.jsonl and      *
 * survivors.json at fixed paths. Every invocation destroyed the       *
 * previous one's verdicts. That fired twice: once on the 20:26        *
 * throwaway run, and again at 22:23 when a corpus run overwrote the   *
 * exhaustive re-screen — forty minutes after the law was written down *
 * saying in-memory verdicts are not history.                          *
 *                                                                     *
 * Hash chains protect integrity, not existence. A tamper-proof ledger *
 * is still one overwrite from gone. So the fix is structural, not     *
 * procedural: there is no shared mutable filename for anything        *
 * verdict-bearing. Each run gets its own directory, created with      *
 * recursive:false so a collision is an EEXIST throw and never a       *
 * silent clobber.                                                     *
 * ------------------------------------------------------------------ */

/**
 * Ledger runs live OUTSIDE foundry-out, which is gitignored. A durable record
 * that no backup and no commit ever sees has no existence guarantee at all.
 */
export const DEFAULT_LEDGER_ROOT = 'foundry-ledger';

export interface RunHandle {
  runId: string;
  dir: string;
  ledgerPath: string;
  /** Attach to a ScreenLedger to make every verdict durable when issued. */
  sink: LedgerSink;
  /** Non-verdict-bearing artifacts, written run-scoped like everything else. */
  writeArtifact(name: string, contents: string): string;
}

/**
 * Claim a fresh run directory. Never reuses one — the suffix walks forward
 * until an unused name is found, so re-running the same seed cannot destroy
 * the earlier run's verdicts.
 */
export function openRunDir(root: string, seed: string): RunHandle {
  const runsRoot = resolve(root, 'runs');
  mkdirSync(runsRoot, { recursive: true });

  const slug = seed.replace(/[^a-zA-Z0-9._-]/g, '_') || 'run';
  for (let n = 1; ; n += 1) {
    const runId = `${slug}-${String(n).padStart(4, '0')}`;
    const dir = resolve(runsRoot, runId);
    try {
      // recursive:false is the whole guarantee. An existing run throws here.
      mkdirSync(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
    const ledgerPath = resolve(dir, 'screen-ledger.jsonl');
    return {
      runId,
      dir,
      ledgerPath,
      sink: (entry) => appendFileSync(ledgerPath, `${stableStringify(entry)}\n`, 'utf8'),
      writeArtifact(name, contents) {
        const path = resolve(dir, name);
        writeFileSync(path, contents, 'utf8');
        return path;
      },
    };
  }
}

/** Every run directory under a ledger root, in claim order. */
export function listRuns(root: string): string[] {
  try {
    return readdirSync(resolve(root, 'runs'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Read a run's chain back off disk WITHOUT trusting it. Blank lines and a
 * truncated final line — the signature of a process killed mid-write — are
 * dropped, because a partial chain is still a valid chain up to where it
 * stopped. Call verify() on the result; that is the point of loading this way.
 */
export function loadRun(ledgerPath: string, sink?: LedgerSink): ScreenLedger {
  const raw = readFileSync(ledgerPath, 'utf8');
  const entries: ScreenLedgerEntry[] = [];
  let truncated = false;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as ScreenLedgerEntry);
    } catch {
      // Truncated tail from a killed process. Everything before it stands.
      truncated = true;
      break;
    }
  }

  // A resume that appends onto a half-written final line welds its first new
  // entry to the corpse of the old one and destroys BOTH. So when we are
  // resuming for real — sink present — the partial line is cut off disk first.
  // Nothing complete is discarded: only the fragment that was never an entry.
  if (sink && truncated) {
    writeFileSync(ledgerPath, entries.map((e) => `${stableStringify(e)}\n`).join(''), 'utf8');
  }

  return ScreenLedger.fromEntries(entries, sink);
}
