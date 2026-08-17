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
export function levelCeiling(claimed: Level, evidence: LevelEvidence): LevelVerdict {
  const { ceiling, reason } = ceilingFor(evidence);
  if (claimed <= ceiling) {
    return { level: claimed, capped: false, claimed, ceiling, reason };
  }
  return { level: ceiling, capped: true, claimed, ceiling, reason };
}
