import { canonicalRule, findWitness } from './equivalence.ts';
import type { Foundation, OpSpec, Rule, Term } from './types.ts';

/* ------------------------------------------------------------------ *
 * From-scratch generation.                                            *
 *                                                                     *
 * Concepts come from declared minimal seeds, not retrieved papers.    *
 * Hard rule: no new names without new formal behavior. A proposal     *
 * that adds no operation, rule, or invariant its parent lacks is      *
 * rejected before it can reach the registry.                          *
 * ------------------------------------------------------------------ */

/** Candidate seed primitives. Candidates only — never mandatory foundations. */
export const CANDIDATE_SEED_PRIMITIVES = [
  'distinction',
  'state',
  'relation',
  'transformation',
  'composition',
  'repetition',
  'boundary',
  'possibility',
  'constraint',
  'information',
  'uncertainty',
] as const;

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ------------------------------------------------------------------ *
 * Three seed foundations.                                             *
 *                                                                     *
 * Primitive sets are disjoint. Each carries at least one rule with no *
 * interdefinable counterpart in the others: F1's involution, F2's     *
 * distribution of a unary over a binary, F3's identity-position rule  *
 * that forces a collapse instead of preserving its argument.          *
 * ------------------------------------------------------------------ */

export const DISTINCTION_ALGEBRA: Foundation = {
  id: 'F1-distinction',
  name: 'Distinction algebra',
  primitives: ['distinction', 'mark', 'void', 'unit'],
  constants: ['void', 'unit'],
  operations: [
    { name: 'mark', arity: 1 },
    { name: 'join', arity: 2 },
  ],
  rules: [
    { id: 'f1-involution', lhs: O('mark', O('mark', V('x'))), rhs: V('x') },
    { id: 'f1-void-left', lhs: O('join', C('void'), V('x')), rhs: V('x') },
    { id: 'f1-void-right', lhs: O('join', V('x'), C('void')), rhs: V('x') },
  ],
  // Without a distinctness assertion the contradiction search has nothing it
  // can possibly report, and "no contradiction found" means nothing.
  distinct: [['void', 'unit']],
  invariants: [
    'marking twice returns the original distinction',
    'void is inert under joining',
    'void and unit are distinct: deriving one from the other is a contradiction',
  ],
};

export const CONSTRAINT_FLOW: Foundation = {
  id: 'F2-constraint',
  name: 'Constraint flow',
  primitives: ['constraint', 'slack', 'tightening', 'meeting', 'blockage'],
  constants: ['free', 'blocked'],
  operations: [
    { name: 'tighten', arity: 1 },
    { name: 'relax', arity: 1 },
    { name: 'meet', arity: 2 },
  ],
  rules: [
    { id: 'f2-undo', lhs: O('relax', O('tighten', V('x'))), rhs: V('x') },
    { id: 'f2-free-left', lhs: O('meet', C('free'), V('x')), rhs: V('x') },
    {
      id: 'f2-distribute',
      lhs: O('tighten', O('meet', V('x'), V('y'))),
      rhs: O('meet', O('tighten', V('x')), O('tighten', V('y'))),
    },
  ],
  distinct: [['free', 'blocked']],
  invariants: [
    'relaxing a tightening is a no-op',
    'tightening distributes over meeting — no F1 or F3 rule interdefines this',
    'free and blocked are distinct: deriving one from the other is a contradiction',
  ],
};

export const UNCERTAINTY_BOUNDARY: Foundation = {
  id: 'F3-uncertainty',
  name: 'Uncertainty boundary',
  primitives: ['uncertainty', 'boundary', 'spreading', 'collapsing', 'diffusion'],
  constants: ['sharp', 'diffuse'],
  operations: [
    { name: 'spread', arity: 1 },
    { name: 'collapse', arity: 1 },
    { name: 'overlay', arity: 2 },
  ],
  rules: [
    { id: 'f3-collapse-spread', lhs: O('collapse', O('spread', V('x'))), rhs: V('x') },
    {
      id: 'f3-idempotent',
      lhs: O('collapse', O('collapse', V('x'))),
      rhs: O('collapse', V('x')),
    },
    {
      id: 'f3-sharp-forces',
      lhs: O('overlay', C('sharp'), V('x')),
      rhs: O('collapse', V('x')),
    },
  ],
  distinct: [['sharp', 'diffuse']],
  invariants: [
    'collapsing a spread recovers the original',
    'collapse is idempotent — it is not an involution',
    'the sharp element is not an identity: overlaying it forces a collapse',
    'sharp and diffuse are distinct: deriving one from the other is a contradiction',
  ],
};

export function seedFoundations(): Foundation[] {
  return [DISTINCTION_ALGEBRA, CONSTRAINT_FLOW, UNCERTAINTY_BOUNDARY];
}

export interface DifferenceReport {
  substantially_different: boolean;
  disjoint_primitives: boolean;
  shared_primitives: string[];
  non_interdefinable_rules: Record<string, string[]>;
  equivalent_pairs: Array<[string, string]>;
}

/**
 * Substantially different = nearly disjoint primitive sets, no pair
 * equivalent under a translation witness, and at least one rule per
 * foundation with no canonical counterpart elsewhere.
 */
export function assessDifference(foundations: Foundation[]): DifferenceReport {
  const shared: string[] = [];
  for (let i = 0; i < foundations.length; i += 1) {
    for (let j = i + 1; j < foundations.length; j += 1) {
      for (const p of foundations[i]!.primitives) {
        if (foundations[j]!.primitives.includes(p) && !shared.includes(p)) shared.push(p);
      }
    }
  }
  const equivalentPairs: Array<[string, string]> = [];
  for (let i = 0; i < foundations.length; i += 1) {
    for (let j = i + 1; j < foundations.length; j += 1) {
      if (findWitness(foundations[i]!, foundations[j]!)) {
        equivalentPairs.push([foundations[i]!.id, foundations[j]!.id]);
      }
    }
  }
  const unique: Record<string, string[]> = {};
  for (const f of foundations) {
    const others = new Set(
      foundations
        .filter((g) => g.id !== f.id)
        .flatMap((g) => g.rules.map((r) => shapeOf(r))),
    );
    unique[f.id] = f.rules.filter((r) => !others.has(shapeOf(r))).map((r) => r.id);
  }
  return {
    substantially_different:
      shared.length === 0 &&
      equivalentPairs.length === 0 &&
      Object.values(unique).every((list) => list.length > 0),
    disjoint_primitives: shared.length === 0,
    shared_primitives: shared,
    non_interdefinable_rules: unique,
    equivalent_pairs: equivalentPairs,
  };
}

/** Rule shape with every name erased — only the structure survives. */
function shapeOf(rule: Rule): string {
  const opNames = new Map<string, string>();
  const constNames = new Map<string, string>();
  const canon = canonicalRule(rule);
  return canon
    .replace(/[a-z0-9_-]+\(/gi, (m) => {
      if (!opNames.has(m)) opNames.set(m, `op${opNames.size}(`);
      return opNames.get(m)!;
    })
    .replace(/«[^»]+»/g, (m) => {
      if (!constNames.has(m)) constNames.set(m, `«k${constNames.size}»`);
      return constNames.get(m)!;
    });
}

/* ------------------------------------------------------------------ *
 * Concept proposal                                                    *
 * ------------------------------------------------------------------ */

export interface ConceptProposal {
  id: string;
  name: string;
  parent: Foundation;
  addedOperations: OpSpec[];
  addedRules: Rule[];
  addedInvariants: string[];
  addedPrimitives?: string[];
  addedConstants?: string[];
  intendedPattern?: string;
}

export interface ProposalResult {
  ok: boolean;
  rejections: string[];
  foundation: Foundation | null;
  intended_pattern: string;
}

export function proposeConcept(proposal: ConceptProposal): ProposalResult {
  const rejections: string[] = [];
  const addedOps = proposal.addedOperations ?? [];
  const addedRules = proposal.addedRules ?? [];
  const addedInvariants = proposal.addedInvariants ?? [];

  if (addedOps.length === 0 && addedRules.length === 0 && addedInvariants.length === 0) {
    rejections.push('NO_NEW_FORMAL_BEHAVIOR');
  }

  const parentRuleShapes = new Set(proposal.parent.rules.map((r) => canonicalRule(r)));
  const genuinelyNewRules = addedRules.filter((r) => !parentRuleShapes.has(canonicalRule(r)));
  if (addedRules.length > 0 && genuinelyNewRules.length === 0 && addedOps.length === 0) {
    rejections.push('RULES_ALREADY_PRESENT_IN_PARENT');
  }

  const knownOps = new Set(proposal.parent.operations.map((o) => o.name));
  for (const op of addedOps) {
    if (knownOps.has(op.name)) rejections.push(`OPERATION_ALREADY_DECLARED:${op.name}`);
  }

  if (rejections.length > 0) {
    return { ok: false, rejections, foundation: null, intended_pattern: proposal.intendedPattern ?? '' };
  }

  const foundation: Foundation = {
    id: proposal.id,
    name: proposal.name,
    parent_id: proposal.parent.id,
    primitives: [...proposal.parent.primitives, ...(proposal.addedPrimitives ?? [])],
    constants: [...proposal.parent.constants, ...(proposal.addedConstants ?? [])],
    operations: [...proposal.parent.operations, ...addedOps],
    rules: [...proposal.parent.rules, ...addedRules],
    distinct: [...proposal.parent.distinct],
    invariants: [...proposal.parent.invariants, ...addedInvariants],
  };

  return {
    ok: true,
    rejections: [],
    foundation,
    intended_pattern: proposal.intendedPattern ?? '',
  };
}
