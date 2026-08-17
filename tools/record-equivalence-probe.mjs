/*
 * The audit close carried a caveat: EQUIVALENT_TO_KNOWN was 0 across 767 and
 * the killer had never been watched fire on real input. The probe settles the
 * reachability half of that and leaves the semantic half open. Both halves go
 * on the chain, because a caveat that is only partly retired is the easiest
 * kind to later remember as fully retired.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { stableStringify } from '../src/canonical-json.ts';
import { loadRun } from '../src/foundry/run-store.ts';
import { ScreenLedger } from '../src/foundry/screen-ledger.ts';

const P = 'foundry-ledger/incidents.jsonl';
const sink = (e) => appendFileSync(P, `${stableStringify(e)}\n`, 'utf8');
const l = existsSync(P) ? loadRun(P, sink) : new ScreenLedger(sink);

const ID = 'PROBE-2026-08-16-equivalence-reachability';
if (l.all().some((e) => e.evidence?.probe_id === ID)) {
  console.log('already recorded');
  process.exit(0);
}

l.observe(
  'ledger-integrity',
  'equivalence killer observed firing on real enumerated input',
  {
    probe_id: ID,
    tool: 'tools/probe-equivalence.mjs',
    input: 'foundry-ledger/runs/exhaustive-hashed-0001/survivors.json — 128 survivors of the reference run',
    probes: {
      rename: {
        question: 'is a survivor equivalent to itself with its introduced operation renamed?',
        asked: 128,
        equivalent: 128,
        reading: 'the EQUIVALENT_TO_KNOWN branch is reachable on real candidates',
      },
      pairwise: {
        question: 'is any survivor equivalent to any other?',
        asked: 8128,
        of: 8128,
        truncated: false,
        equivalent: 0,
        reading:
          'agrees with every in-run answer — screening already asked each candidate against every earlier survivor',
      },
    },
    retires: 'the reachability half of the audit-close caveat: the zero is a fact about the candidates, not a detector wired shut',
    still_open:
      'every YES came from renaming. No candidate has ever been identified with a structure it merely encodes — different symbols, different rule shapes, same mathematics. The interpretation-stage killer remains unobserved.',
    supersedes_caveat_in: 'AUDIT-CLOSE-2026-08-16',
  },
  'a detector nobody has watched fire is unproven — so it was watched, and what was seen is written down exactly',
);

console.log('recorded, chain entries:', l.length, 'verified:', l.verify().ok);
