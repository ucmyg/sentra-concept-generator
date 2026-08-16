import type { Axiom, EpistemicClass } from './types.ts';

/* ------------------------------------------------------------------ *
 * Misclassification is the central failure mode, so it is checked in  *
 * both directions:                                                    *
 *                                                                     *
 *   - a construction that reports itself as established mathematics   *
 *     is a fabricated sourced claim;                                  *
 *   - an external fact dressed as an axiom is the same violation      *
 *     from the other side.                                            *
 * ------------------------------------------------------------------ */

export const CLASS_REJECTION_CODES = [
  'UNKNOWN_EPISTEMIC_CLASS',
  'ASSERTS_EXTERNAL_FACT',
  'AXIOM_ASSERTS_WORLD_FACT',
  'AXIOM_NOT_DECLARED_AS_ASSUMPTION',
  'CONSTRUCTED_ARTIFACT_CARRIES_CITATIONS',
  'SOURCED_CLAIM_WITHOUT_EVIDENCE',
  'DERIVED_RESULT_MISSING_TRACE',
  'TRACE_NOT_REPLAYABLE',
] as const;
export type ClassRejectionCode = (typeof CLASS_REJECTION_CODES)[number];

/**
 * Phrases that report a statement as established outside this system.
 * A CONSTRUCTED_ARTIFACT is proposed; the moment its prose reports, it
 * needs packets and belongs on the evidence-gate path instead.
 */
const EXTERNAL_ASSERTION = new RegExp(
  [
    'well[- ]established',
    'it is known that',
    'it is well known',
    'widely accepted',
    'studies (?:show|have shown)',
    'research (?:shows|has shown)',
    'in the literature',
    'prior work (?:shows|has shown)',
    'has been (?:shown|proven|demonstrated) (?:that|in|by)',
    'according to',
    'the standard result',
    'classical(?:ly)? known',
  ].join('|'),
  'i',
);

/**
 * Phrases that make a claim about the world rather than a stipulation of
 * the system. Axioms must read as assumptions, never as observations.
 */
const WORLD_FACT = new RegExp(
  [
    '\\bobserved\\b',
    '\\bempirical(?:ly)?\\b',
    '\\bin (?:real|actual|live|practice)\\b',
    '\\bmarkets?\\b',
    '\\bdata (?:shows|show|indicates)\\b',
    '\\bmeasured in\\b',
    '\\bhistorical(?:ly)?\\b',
    '\\bin the physical world\\b',
  ].join('|'),
  'i',
);

export interface ClassificationInput {
  text: string;
  declared_class: EpistemicClass;
}

export interface ClassificationResult {
  ok: boolean;
  epistemic_class: EpistemicClass | null;
  rejections: ClassRejectionCode[];
}

export function classifyStatement(input: ClassificationInput): ClassificationResult {
  const rejections: ClassRejectionCode[] = [];
  const known: EpistemicClass[] = ['SOURCED_CLAIM', 'CONSTRUCTED_ARTIFACT', 'DERIVED_RESULT'];
  if (!known.includes(input.declared_class)) {
    return { ok: false, epistemic_class: null, rejections: ['UNKNOWN_EPISTEMIC_CLASS'] };
  }
  const text = String(input.text ?? '');
  if (input.declared_class !== 'SOURCED_CLAIM' && EXTERNAL_ASSERTION.test(text)) {
    rejections.push('ASSERTS_EXTERNAL_FACT');
  }
  return {
    ok: rejections.length === 0,
    epistemic_class: rejections.length === 0 ? input.declared_class : null,
    rejections,
  };
}

export function classifyAxiom(axiom: Axiom): ClassificationResult {
  const rejections: ClassRejectionCode[] = [];
  if (axiom.kind !== 'ASSUMPTION_OF_SYSTEM') {
    rejections.push('AXIOM_NOT_DECLARED_AS_ASSUMPTION');
  }
  const text = String(axiom.statement ?? '');
  if (WORLD_FACT.test(text)) rejections.push('AXIOM_ASSERTS_WORLD_FACT');
  if (EXTERNAL_ASSERTION.test(text)) rejections.push('ASSERTS_EXTERNAL_FACT');
  return {
    ok: rejections.length === 0,
    epistemic_class: rejections.length === 0 ? 'CONSTRUCTED_ARTIFACT' : null,
    rejections,
  };
}
