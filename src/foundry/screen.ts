import { criticalPairs } from './confluence.ts';
import { criticalSeeds, findContradiction } from './contradiction.ts';
import { searchDerivation } from './derive-search.ts';
import { isNontrivial } from './derived.ts';
import { checkEquivalence, KNOWN_TEMPLATES } from './equivalence.ts';
import { proposeConcept } from './generator.ts';
import { isVar, terminationProbe } from './kernel.ts';
import {
  CANDIDATE_OPERATIONS,
  DEFAULT_ENUMERATION_BOUND,
  enumerateRuleCandidates,
  seededSample,
  type EnumerationBound,
} from './enumerate.ts';
import { ScreenLedger } from './screen-ledger.ts';
import type { Foundation, OpSpec, Rule, Term } from './types.ts';

/* ------------------------------------------------------------------ *
 * Screening.                                                          *
 *                                                                     *
 * Every candidate walks the same gauntlet in the same order, and the  *
 * order is chosen so the cheap disqualifiers run before the expensive *
 * ones. A candidate's outcome is recorded whether it lives or dies —  *
 * the deaths are the evidence that the gate does anything at all.     *
 * ------------------------------------------------------------------ */

export type ScreenOutcome =
  | 'REJECTED_BY_PROPOSAL'
  | 'DEGENERATE_CONSTANT'
  | 'NON_TERMINATING'
  | 'CONTRADICTORY'
  | 'NON_CONFLUENT'
  | 'NO_DERIVATION'
  | 'TRIVIAL_ONLY'
  | 'EQUIVALENT_TO_KNOWN'
  | 'SURVIVED';

export interface ScreenResult {
  candidate_id: string;
  parent_id: string;
  rule: Rule;
  new_operation: OpSpec;
  outcome: ScreenOutcome;
  detail: string;
  foundation: Foundation | null;
  /**
   * Present exactly when outcome is EQUIVALENT_TO_KNOWN. Equivalence is a
   * terminal verdict, so it may not be reported as a bare label — the
   * interpretation that justifies it, and the gate ruling that admitted that
   * interpretation, travel with it as first-class machine-readable evidence.
   *
   * A kill whose evidence is absent is not a kill that can be audited later,
   * and an unauditable terminal verdict is one nobody can ever reverse.
   */
  equivalence_evidence?: {
    target_id: string;
    stage: string;
    interpretation_witness: unknown;
    witness_gate: unknown;
    notes: string[];
  };
}

function collectVars(t: Term, into: Set<string>): void {
  if (isVar(t)) into.add(t.v);
  else if ('args' in t) for (const a of (t as { args: Term[] }).args) collectVars(a, into);
}

/**
 * Does this rule's output depend on its input at all?
 *
 * True when at least one variable bound on the left survives to the right.
 * A projection like gen_b(x,y) -> mark(y) passes: it drops one argument but
 * still says something about the other. A constant like gen_u(x) -> unit
 * fails: applied to anything, it answers the same, so the operation is a
 * name for a value rather than a transformation.
 */
export function isInformationPreserving(rule: Rule): boolean {
  const lhsVars = new Set<string>();
  const rhsVars = new Set<string>();
  collectVars(rule.lhs, lhsVars);
  collectVars(rule.rhs, rhsVars);
  if (lhsVars.size === 0) return true; // a ground rule states a specific fact
  for (const v of rhsVars) if (lhsVars.has(v)) return true;
  return false;
}

export interface ScreenBounds {
  contradiction: { maxDepth: number; maxTerms: number };
  /** maxTerms bounds how many ground start terms are probed, not the search. */
  termination: { maxSteps: number; maxTerms: number; maxSize: number };
  equivalenceModelSize: number;
}

export const DEFAULT_SCREEN_BOUNDS: ScreenBounds = {
  contradiction: { maxDepth: 4, maxTerms: 120 },
  termination: { maxSteps: 60, maxTerms: 60, maxSize: 400 },
  equivalenceModelSize: 2,
};

/**
 * Screen one candidate rule as an extension of its parent.
 *
 * `known` is every structure this candidate must be distinct from — the
 * parent, the sibling foundations, and every candidate that already
 * survived this run. Without that last part the run happily reports the
 * same discovery three hundred times.
 */
export function screenCandidate(
  parent: Foundation,
  rule: Rule,
  newOp: OpSpec,
  known: readonly Foundation[],
  index: number,
  bounds: ScreenBounds = DEFAULT_SCREEN_BOUNDS,
): ScreenResult {
  const id = `${parent.id}-gen-${newOp.name}-${index}`;
  const base = { candidate_id: id, parent_id: parent.id, rule, new_operation: newOp };
  // Constraining an operation the parent already has adds a rule, not a symbol.
  const isFresh = !parent.operations.some((o) => o.name === newOp.name);

  const proposal = proposeConcept({
    id,
    name: `Enumerated extension ${index} of ${parent.name}`,
    parent,
    addedOperations: isFresh ? [newOp] : [],
    addedRules: [{ ...rule, id: `${id}-rule` }],
    addedInvariants: [`${newOp.name} is constrained by one further declared rule`],
    intendedPattern: 'Enumerated candidate. Proposed by search, not by intent.',
  });
  if (!proposal.ok || !proposal.foundation) {
    return {
      ...base,
      outcome: 'REJECTED_BY_PROPOSAL',
      detail: proposal.rejections.join(', '),
      foundation: null,
    };
  }
  const f = proposal.foundation;

  // Degeneracy is not inconsistency, which is exactly why it slipped through.
  // A rule whose right side mentions none of its left-side variables discards
  // its input: gen_u(x) -> mark(unit) is a constant function wearing the
  // costume of an operation. It is terminating, consistent, confluent, and
  // distinct from everything — it passes every question the gauntlet asks,
  // because none of those questions were about whether it does anything.
  if (!isInformationPreserving(rule)) {
    return {
      ...base,
      outcome: 'DEGENERATE_CONSTANT',
      detail:
        'the right side mentions no variable from the left: this rule discards its ' +
        'argument, so the operation carries no information about what it was applied to',
      foundation: f,
    };
  }

  // Cheapest first: a non-terminating rule set makes every later question
  // undecidable within our bounds, so there is nothing to be gained by asking.
  //
  // The probe needs start terms. Ground instances of the rules' left sides are
  // exactly where rules can fire and collide, so they are where divergence
  // shows up first. Probing with no start term at all — which is what this
  // gate did before — reports TERMINATED for every candidate ever screened.
  for (const seed of criticalSeeds(f).slice(0, bounds.termination.maxTerms)) {
    const term = terminationProbe(f, seed, {
      maxSteps: bounds.termination.maxSteps,
      maxSize: bounds.termination.maxSize,
    });
    if (term.status !== 'TERMINATED') {
      return {
        ...base,
        outcome: 'NON_TERMINATING',
        detail:
          `${term.status} from a ground instance after ${term.steps_taken} step(s), ` +
          `largest term seen ${term.max_term_size}`,
        foundation: f,
      };
    }
  }

  const contra = findContradiction(f, bounds.contradiction);
  if (contra.found) {
    return {
      ...base,
      outcome: 'CONTRADICTORY',
      detail: contra.proof ? 'contradiction proof recorded' : 'contradiction found',
      foundation: f,
    };
  }

  const conf = criticalPairs(f);
  if (conf.status === 'NON_CONFLUENT') {
    return {
      ...base,
      outcome: 'NON_CONFLUENT',
      detail: `${conf.unjoined.length} unjoined critical pair(s)`,
      foundation: f,
    };
  }

  const trace = searchDerivation(f);
  if (!trace) {
    return {
      ...base,
      outcome: 'NO_DERIVATION',
      detail: 'no derivation within the search bound',
      foundation: f,
    };
  }
  const verdict = isNontrivial(f, trace);
  if (!verdict.nontrivial) {
    return { ...base, outcome: 'TRIVIAL_ONLY', detail: verdict.reason, foundation: f };
  }

  for (const other of known) {
    const eq = checkEquivalence(f, other, {
      maxModelSize: bounds.equivalenceModelSize,
      interpretation: true,
    });
    if (eq.equivalent) {
      return {
        ...base,
        outcome: 'EQUIVALENT_TO_KNOWN',
        detail: `equivalent to ${other.id}`,
        foundation: f,
        equivalence_evidence: {
          target_id: other.id,
          stage: eq.stage,
          interpretation_witness: eq.interpretation_witness ?? eq.witness ?? null,
          witness_gate: eq.witness_gate ?? null,
          notes: eq.notes,
        },
      };
    }
  }

  return {
    ...base,
    outcome: 'SURVIVED',
    detail: `terminating, consistent, ${conf.status}, non-trivial, distinct from ${known.length} known structure(s)`,
    foundation: f,
  };
}

export interface ScreenRunOptions {
  seed?: string;
  /** Candidates screened per (parent, operation) pair. Omit to screen all. */
  sampleSize?: number;
  enumeration?: EnumerationBound;
  bounds?: ScreenBounds;
  operations?: readonly OpSpec[];
}

export interface ScreenRunReport {
  seed: string;
  candidates_enumerated: number;
  candidates_screened: number;
  results: ScreenResult[];
  survivors: ScreenResult[];
  tally: Record<ScreenOutcome, number>;
  /**
   * Every verdict this run issued, hash-chained and append-only. The tally
   * above is a summary; this is the record. Summaries cannot be audited.
   */
  ledger: ScreenLedger;
}

export function runScreen(
  parents: readonly Foundation[],
  options: ScreenRunOptions = {},
): ScreenRunReport {
  const seed = options.seed ?? 'screen-default';
  const enumeration = options.enumeration ?? DEFAULT_ENUMERATION_BOUND;
  const bounds = options.bounds ?? DEFAULT_SCREEN_BOUNDS;
  const operations = options.operations ?? CANDIDATE_OPERATIONS;

  const ledger = new ScreenLedger();
  const results: ScreenResult[] = [];
  const survivors: ScreenResult[] = [];
  let enumerated = 0;

  for (const parent of parents) {
    for (const op of operations) {
      const all = enumerateRuleCandidates(parent, op, enumeration);
      enumerated += all.length;
      const batch =
        options.sampleSize === undefined
          ? all
          : seededSample(all, options.sampleSize, `${seed}:${parent.id}:${op.name}`);

      for (let i = 0; i < batch.length; i += 1) {
        // The reduction corpus comes FIRST and is always present. Without it
        // a candidate was only ever checked against its own siblings, so
        // "distinct from 3 known structure(s)" was the whole of a survival
        // claim and the 15 declared reduction targets were never consulted.
        // A survival earned without facing the corpus is not a survival.
        //
        // Survivors join immediately after, so a later candidate that merely
        // re-skins an earlier one is caught inside a single run.
        const known = [
          ...KNOWN_TEMPLATES,
          ...parents.filter((p) => p.id !== parent.id),
          parent,
          ...survivors.map((s) => s.foundation!),
        ];
        const result = screenCandidate(parent, batch[i]!.rule, op, known, i, bounds);
        results.push(result);
        // Written down at the moment it is issued. A verdict that lives only
        // in this array dies when the process does, and an unauditable
        // terminal verdict can never be reversed.
        ledger.record(seed, result);
        if (result.outcome === 'SURVIVED') survivors.push(result);
      }
    }
  }

  const tally = {
    REJECTED_BY_PROPOSAL: 0,
    DEGENERATE_CONSTANT: 0,
    NON_TERMINATING: 0,
    CONTRADICTORY: 0,
    NON_CONFLUENT: 0,
    NO_DERIVATION: 0,
    TRIVIAL_ONLY: 0,
    EQUIVALENT_TO_KNOWN: 0,
    SURVIVED: 0,
  } as Record<ScreenOutcome, number>;
  for (const r of results) tally[r.outcome] += 1;

  return {
    seed,
    candidates_enumerated: enumerated,
    candidates_screened: results.length,
    results,
    survivors,
    tally,
    ledger,
  };
}
