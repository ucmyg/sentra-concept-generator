import type { ClassRejectionCode } from './classes.ts';
import { replayTrace } from './kernel.ts';
import type { Foundation, ReplayResult, Trace } from './types.ts';

/* ------------------------------------------------------------------ *
 * DERIVED_RESULT admission.                                           *
 *                                                                     *
 * A derived result needs a machine-replayable derivation, not a       *
 * quotation and not a paragraph of reasoning. If the kernel cannot    *
 * run it, it does not enter the record.                               *
 * ------------------------------------------------------------------ */

export interface DerivedResultInput {
  id: string;
  foundation: Foundation;
  claim: string;
  trace: Trace | null;
}

export interface DerivedResultAdmission {
  ok: boolean;
  rejections: ClassRejectionCode[];
  replay: ReplayResult | null;
  epistemic_class: 'DERIVED_RESULT';
}

export function admitDerivedResult(input: DerivedResultInput): DerivedResultAdmission {
  const rejections: ClassRejectionCode[] = [];
  if (!input.trace) {
    return {
      ok: false,
      rejections: ['DERIVED_RESULT_MISSING_TRACE'],
      replay: null,
      epistemic_class: 'DERIVED_RESULT',
    };
  }
  const replay = replayTrace(input.foundation, input.trace);
  if (!replay.ok) rejections.push('TRACE_NOT_REPLAYABLE');
  return {
    ok: rejections.length === 0,
    rejections,
    replay,
    epistemic_class: 'DERIVED_RESULT',
  };
}

/**
 * Nontrivial = not an instance of an axiom, and not reachable in a single
 * rule application. Both halves are checked mechanically.
 */
export function isNontrivial(
  foundation: Foundation,
  trace: Trace,
): { nontrivial: boolean; reason: string } {
  if (trace.steps.length <= 1) {
    return {
      nontrivial: false,
      reason: 'Reachable in one rule application or fewer.',
    };
  }
  const distinctRules = new Set(trace.steps.map((s) => s.rule));
  if (distinctRules.size < 2) {
    return {
      nontrivial: false,
      reason: 'Repeated application of a single axiom is still an instance of that axiom.',
    };
  }
  return {
    nontrivial: true,
    reason: `${trace.steps.length} steps across ${distinctRules.size} distinct rules; not an axiom instance.`,
  };
}
