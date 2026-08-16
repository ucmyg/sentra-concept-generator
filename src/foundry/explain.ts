import { isApp, isConst, isVar } from './kernel.ts';
import type { GenesisRecord, Term, Trace } from './types.ts';

/* ------------------------------------------------------------------ *
 * Human-readable explanation layer.                                   *
 *                                                                     *
 * Commentary only. It is clearly marked as such and it never          *
 * substitutes for, overrides, or is checked instead of the formal     *
 * record. If prose and record disagree, the record is right.          *
 * ------------------------------------------------------------------ */

export const COMMENTARY_BANNER =
  'COMMENTARY — non-authoritative. The genesis record and kernel traces are authoritative.';

export function renderTerm(t: Term): string {
  if (isVar(t)) return t.v;
  if (isConst(t)) return t.c;
  if (!isApp(t)) return '?';
  return `${t.op}(${t.args.map(renderTerm).join(', ')})`;
}

export function explainTrace(trace: Trace): string {
  const lines = [`start: ${renderTerm(trace.start)}`];
  trace.steps.forEach((s, i) => {
    lines.push(
      `  step ${i + 1}: apply ${s.rule} at position [${s.path.join('.') || 'root'}] -> ${renderTerm(s.result)}`,
    );
  });
  return lines.join('\n');
}

export function explainRecord(record: GenesisRecord): string {
  const s = record.status;
  const lines: string[] = [
    COMMENTARY_BANNER,
    '',
    `${record.identity.name} (${record.identity.id})`,
    `lineage: ${record.identity.lineage_hash?.slice(0, 16)}…${
      record.identity.parents.length ? ` from [${record.identity.parents.join(', ')}]` : ' (root)'
    }`,
    '',
    record.formal.definition,
    '',
    `primitives: ${record.formal.primitives.join(', ')}`,
    `operations: ${record.formal.operations.map((o) => `${o.name}/${o.arity}`).join(', ')}`,
    `invariants: ${record.formal.invariants.join('; ') || 'none declared'}`,
    '',
    `formal: ${s.formal}   novelty: ${s.novelty}   utility: ${s.utility}   confidence: ${s.confidence}`,
  ];
  if (s.cause_of_death) lines.push(`cause of death: ${s.cause_of_death}`);
  if (record.behavior.consequences.length > 0) {
    lines.push('', 'derived consequences:');
    for (const c of record.behavior.consequences) {
      lines.push(`  ${c.id}: ${c.claim} — ${c.nontrivial ? 'nontrivial' : 'trivial'} (${c.nontrivial_reason})`);
    }
  }
  const contradiction = record.validation.contradiction_tests.find((t) => t.found);
  if (contradiction?.proof) {
    lines.push(
      '',
      `contradiction: the term ${renderTerm(contradiction.proof.term)} derives both ` +
        `${contradiction.proof.distinct_pair[0]} and ${contradiction.proof.distinct_pair[1]}, ` +
        'which this system declares distinct.',
      explainTrace(contradiction.proof.left),
      explainTrace(contradiction.proof.right),
    );
  }
  lines.push(
    '',
    'Novelty note: PRIOR_ART_UNCHECKED means exactly that. No corpus is attached, so ' +
      'nothing here is claimed to be new mathematics.',
  );
  return lines.join('\n');
}
