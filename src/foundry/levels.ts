/* ------------------------------------------------------------------ *
 * The level scale, and the honesty rule that governs it.              *
 *                                                                     *
 * Project Genesis, Charter v2 §3. A candidate is BORN at level 0 or 1 *
 * and climbs only by surviving evidence. The default-down rule is the *
 * whole point of this module: when the recorded evidence is short of  *
 * a claim, the claim loses, silently and mechanically, and the reason *
 * is written down. Nothing here decides what is true — it decides how *
 * loudly we are allowed to say it.                                    *
 * ------------------------------------------------------------------ */

export type Level = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const LEVEL_NAMES: Record<Level, string> = {
  0: 'NOTATIONAL_CHANGE',
  1: 'REPRESENTATIONAL_CHANGE',
  2: 'ALGORITHMIC_CHANGE',
  3: 'CONCEPTUAL_REORGANIZATION',
  4: 'GENERALIZATION',
  5: 'NEW_FORMAL_STRUCTURE',
  6: 'NEW_FOUNDATION',
  7: 'NEW_MATHEMATICAL_ECOSYSTEM',
};

/**
 * Every statement in every record and report carries exactly one of these.
 * Novelty status is a separate axis attached to concepts; it is never a
 * statement label, which is the confusion this type exists to prevent.
 */
export type StatementLabel =
  | 'VERIFIED_EXTERNAL_FACT'
  | 'CONSTRUCTED_DEFINITION'
  | 'DECLARED_AXIOM'
  | 'HYPOTHESIS'
  | 'CONJECTURE'
  | 'DERIVED_RESULT'
  | 'EXPERIMENTAL_RESULT'
  | 'UNKNOWN';

export type ReductionOutcome =
  /** No embedding was attempted, or the attempt was not recorded. */
  | 'NOT_ATTEMPTED'
  /** A faithful embedding into a standard structure was found. */
  | 'LOSSLESS_EMBEDDING'
  /** An embedding was found, and what it loses has been recorded. */
  | 'EMBEDDING_WITH_LOSS'
  /** Recorded, good-faith attempts, all of which failed. */
  | 'NO_EMBEDDING_FOUND';

export type BenchmarkOutcome =
  | 'NOT_RUN'
  | 'PREREGISTERED_NO_ADVANTAGE'
  | 'PREREGISTERED_ADVANTAGE';

export interface LevelEvidence {
  /** FORMALIZED in the Charter's sense: it executes in the kernel. */
  formalized: boolean;
  reduction: ReductionOutcome;
  benchmark: BenchmarkOutcome;
}

/* ------------------------------------------------------------------ *
 * The corpus-derived ceiling.                                         *
 *                                                                     *
 * NO_EMBEDDING_FOUND is only ever as strong as the corpus it survived.*
 * A candidate that escapes a corpus of four near-identical algebras   *
 * has demonstrated that it is not those four algebras. That is not a  *
 * conceptual reorganization; "not being a monoid" is not a discovery. *
 *                                                                     *
 * So the strength of a survived reduction attack is COMPUTED from how *
 * much distinct structural ground was actually attacked into, and the *
 * cap lifts by itself as targets land. It is never asserted, and no   *
 * caller can raise it by claiming harder.                             *
 * ------------------------------------------------------------------ */

export interface CorpusCoverage {
  /** Families with at least one target the kernel can actually execute. */
  families_fully_covered: readonly string[];
  /** Families with a target that covers part of the family, per its rationale. */
  families_partially_covered: readonly string[];
  /**
   * Families declared inexpressible in an oriented equational theory. These
   * are NOT held against the corpus — refusing to fake a target is honest —
   * but they are named, because a claim of broad survival should show what
   * was never in the room.
   */
  families_not_expressible: readonly string[];
  /** Total reduction targets actually checked against. */
  targets_checked: number;
}

/**
 * A partially covered family counts for half. It caught something real, and it
 * left something real unattacked; neither pretending otherwise is honest.
 */
const PARTIAL_FAMILY_WEIGHT = 0.5;

/**
 * Effective families -> the highest level a survived attack can support.
 *
 * The bottom rung is deliberately 1.5 rather than 2: at half weight that is
 * one full family plus one partial, the thinnest corpus that has attacked
 * more than a single kind of structure. Without that rung, a corpus of one
 * family and a corpus of NOTHING land identically, and "we attacked a little"
 * would be indistinguishable from "we never looked" — which is the exact
 * collapse this whole module exists to prevent.
 */
const CORPUS_LADDER: ReadonlyArray<{ minEffectiveFamilies: number; ceiling: Level }> = [
  { minEffectiveFamilies: 6, ceiling: 5 },
  { minEffectiveFamilies: 4, ceiling: 3 },
  { minEffectiveFamilies: 1.5, ceiling: 2 },
  { minEffectiveFamilies: 0, ceiling: 1 },
];

/* ------------------------------------------------------------------ *
 * THE STRENGTH BAR                                                    *
 *                                                                     *
 * The ceiling is supposed to measure scrutiny. But it is computed     *
 * from family COUNTS, and a count cannot tell a hard attack from a    *
 * lazy one — so one tasting per family raises the cap exactly as much *
 * as one real assault. That turns the ceiling into a number a weak    *
 * mechanism inflates, which is the kill-rate-floor disease one level  *
 * up: RATE_ASSERTION caught tests that pass without proving what they *
 * name; this catches coverage that counts without attacking what it   *
 * names.                                                              *
 *                                                                     *
 * So a family reaches the ceiling only if BOTH hold:                  *
 *   (a) its target passed the standing triple — a formal definition,  *
 *       a planted re-skin that demonstrably DIES to it, and a         *
 *       genuinely distinct system that demonstrably SURVIVES it;      *
 *   (b) the embedding search ran at declared full strength, with its  *
 *       parameters recorded.                                          *
 *                                                                     *
 * An attempt below the bar is not discarded. It is ATTEMPTED_NOT_     *
 * COVERED: real evidence, on the chain, moving the ceiling by zero.   *
 * ------------------------------------------------------------------ */

export interface FamilyAttempt {
  family: string;
  /** What this attempt would claim if it clears the bar. */
  claims: 'FULL' | 'PARTIAL';
  /** The standing triple. Every leg must be demonstrated, not asserted. */
  target_triple: {
    has_formal_definition: boolean;
    planted_reskin_died: boolean;
    distinct_system_survived: boolean;
  };
  search: {
    /** True only when the search ran at the declared full strength. */
    declared_full_strength: boolean;
    /** Recorded in the run header like every other provenance field. */
    parameters: unknown;
  };
}

export type AttemptRejection =
  | 'NO_FORMAL_DEFINITION'
  | 'PLANTED_RESKIN_SURVIVED'
  | 'DISTINCT_SYSTEM_DIED'
  | 'SEARCH_BELOW_FULL_STRENGTH'
  | 'SEARCH_PARAMETERS_NOT_RECORDED';

export interface AttemptRuling {
  family: string;
  admitted: boolean;
  /** Empty exactly when admitted. */
  reasons: readonly AttemptRejection[];
}

/** Why an attempt does or does not reach the ceiling. Never partial credit. */
export function ruleOnAttempt(attempt: FamilyAttempt): AttemptRuling {
  const reasons: AttemptRejection[] = [];
  if (!attempt.target_triple.has_formal_definition) reasons.push('NO_FORMAL_DEFINITION');
  if (!attempt.target_triple.planted_reskin_died) reasons.push('PLANTED_RESKIN_SURVIVED');
  if (!attempt.target_triple.distinct_system_survived) reasons.push('DISTINCT_SYSTEM_DIED');
  if (!attempt.search.declared_full_strength) reasons.push('SEARCH_BELOW_FULL_STRENGTH');
  if (attempt.search.parameters === null || attempt.search.parameters === undefined) {
    reasons.push('SEARCH_PARAMETERS_NOT_RECORDED');
  }
  return { family: attempt.family, admitted: reasons.length === 0, reasons };
}

export interface AdmittedCoverage {
  coverage: CorpusCoverage;
  rulings: readonly AttemptRuling[];
  /** Named, because evidence that moved the ceiling zero is still evidence. */
  attempted_not_covered: readonly AttemptRuling[];
}

/**
 * Build the coverage the ceiling is computed from, admitting only attempts that
 * clear the bar. Families that fail are reported, never silently dropped —
 * a coverage table that hides its failed attacks is a coverage table that lies
 * about how hard anyone tried.
 */
export function admitCoverage(
  attempts: readonly FamilyAttempt[],
  notExpressible: readonly string[] = [],
): AdmittedCoverage {
  const rulings = attempts.map(ruleOnAttempt);
  const admittedFamilies = new Set(rulings.filter((r) => r.admitted).map((r) => r.family));
  const admitted = attempts.filter((a) => admittedFamilies.has(a.family));
  return {
    coverage: {
      families_fully_covered: admitted.filter((a) => a.claims === 'FULL').map((a) => a.family),
      families_partially_covered: admitted
        .filter((a) => a.claims === 'PARTIAL')
        .map((a) => a.family),
      families_not_expressible: notExpressible,
      targets_checked: admitted.length,
    },
    rulings,
    attempted_not_covered: rulings.filter((r) => !r.admitted),
  };
}

export interface CorpusCeiling {
  ceiling: Level;
  effective_families: number;
  derivation: string;
}

export function corpusCeiling(coverage: CorpusCoverage): CorpusCeiling {
  const full = coverage.families_fully_covered.length;
  const partial = coverage.families_partially_covered.length;
  const effective = full + partial * PARTIAL_FAMILY_WEIGHT;
  const rung = CORPUS_LADDER.find((r) => effective >= r.minEffectiveFamilies) ?? {
    ceiling: 1 as Level,
  };
  return {
    ceiling: rung.ceiling,
    effective_families: effective,
    derivation:
      `CORPUS_COVERAGE: ${coverage.targets_checked} target(s) across ` +
      `${full} fully covered famil(ies) [${coverage.families_fully_covered.join(', ') || 'none'}] and ` +
      `${partial} partially covered [${coverage.families_partially_covered.join(', ') || 'none'}], ` +
      `weighting partial at ${PARTIAL_FAMILY_WEIGHT} => ${effective} effective famil(ies), ` +
      `which supports level ${rung.ceiling} at most. ` +
      `Not expressible in the target language, and therefore never attacked: ` +
      `[${coverage.families_not_expressible.join(', ') || 'none'}]. ` +
      'This ceiling rises on its own as targets land. It cannot be raised by claiming.',
  };
}

export interface LevelVerdict {
  level: Level;
  /** True when the claim exceeded what the evidence supports. */
  capped: boolean;
  claimed: Level;
  ceiling: Level;
  reason: string;
}

/**
 * The highest level the recorded evidence can defend, and why it stops there.
 *
 * Read the ladder bottom-up: prose stops at 0, because a definition that has
 * never executed has not demonstrated even a representational change. An
 * unattempted reduction stops at 1 — "we did not check" is not evidence of
 * anything. A lossless embedding stops at 2 and the novelty claim is dead,
 * though the embedding itself is a keeper. An embedding with recorded loss
 * reaches 4, because the loss is the interesting object and generalization is
 * the honest name for it. Only a survived reduction attack opens 3 and 4, and
 * only a pre-registered measured advantage on top of that opens 5.
 *
 * 6 and 7 are not reachable through this function by design. A new foundation
 * or a new ecosystem is a claim about many concepts at once, and it goes
 * through the operator gate with its evidence in hand — never through an
 * automatic classifier.
 */
function ceilingFor(evidence: LevelEvidence): { ceiling: Level; reason: string } {
  if (!evidence.formalized) {
    return {
      ceiling: 0,
      reason:
        'NOT_FORMALIZED: no executable representation loads in the kernel, so the ' +
        'artifact is a note. Precise-looking prose is not a representational change.',
    };
  }
  switch (evidence.reduction) {
    case 'NOT_ATTEMPTED':
      return {
        ceiling: 1,
        reason:
          'REDUCTION_ATTACK_NOT_ATTEMPTED: the candidate is presumed to be existing ' +
          'mathematics wearing a new name until an embedding has been tried and recorded.',
      };
    case 'LOSSLESS_EMBEDDING':
      return {
        ceiling: 2,
        reason:
          'LOSSLESS_EMBEDDING: the candidate embeds faithfully into a standard structure. ' +
          'The novelty claim is dead; keep the embedding, it is a useful translation.',
      };
    case 'EMBEDDING_WITH_LOSS':
      return {
        ceiling: 4,
        reason:
          'EMBEDDING_WITH_LOSS: an embedding exists and what it loses is recorded. The ' +
          'lost structure is what the candidate contributes, which is a generalization ' +
          'at best until a benchmark is built around exactly that loss.',
      };
    case 'NO_EMBEDDING_FOUND':
      if (evidence.benchmark === 'PREREGISTERED_ADVANTAGE') {
        return {
          ceiling: 5,
          reason:
            'NO_EMBEDDING_FOUND with a pre-registered measured advantage: eligible for ' +
            'NEW_FORMAL_STRUCTURE. Levels 6 and 7 are never assigned automatically.',
        };
      }
      return {
        ceiling: 4,
        reason:
          evidence.benchmark === 'PREREGISTERED_NO_ADVANTAGE'
            ? 'NO_PREREGISTERED_ADVANTAGE: the reduction attack was survived but the ' +
              'pre-registered benchmark measured no advantage. A null result is reported, ' +
              'never rescued.'
            : 'NO_PREREGISTERED_ADVANTAGE: the reduction attack was survived but no ' +
              'pre-registered benchmark has been run, so level 5 is not available.',
      };
  }
}

/**
 * Classify a claimed level against recorded evidence.
 *
 * A claim below the ceiling is left exactly where it was put: evidence permits
 * a level, it never compels one, and quietly promoting a modest claim is the
 * same labeling violation as quietly defending an inflated one.
 */
export function levelCeiling(
  claimed: Level,
  evidence: LevelEvidence,
  coverage?: CorpusCoverage,
): LevelVerdict {
  let { ceiling, reason } = ceilingFor(evidence);

  // A survived reduction attack is worth exactly as much as the corpus it was
  // survived against. Every other reduction outcome already stands on its own
  // evidence — a lossless embedding is a fact about a target that WAS found,
  // and no amount of corpus changes it. Only NO_EMBEDDING_FOUND is a claim
  // about absence, and absence is only as strong as the search behind it.
  if (evidence.reduction === 'NO_EMBEDDING_FOUND' && coverage) {
    const corpus = corpusCeiling(coverage);
    if (corpus.ceiling < ceiling) {
      ceiling = corpus.ceiling;
      reason =
        `CORPUS_CEILING_BINDS: the evidence would otherwise support a higher level, but ` +
        `NO_EMBEDDING_FOUND is a claim about absence and this corpus cannot support it that far. ` +
        corpus.derivation;
    }
  }

  if (claimed <= ceiling) {
    return { level: claimed, capped: false, claimed, ceiling, reason };
  }
  return { level: ceiling, capped: true, claimed, ceiling, reason };
}
