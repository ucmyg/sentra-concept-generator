import { criticalPairs } from './confluence.ts';
import { findContradiction } from './contradiction.ts';
import { isNontrivial } from './derived.ts';
import { searchDerivation } from './derive-search.ts';
import { checkEquivalence } from './equivalence.ts';
import { assessDifference, proposeConcept, seedFoundations } from './generator.ts';
import { buildGenesisRecord } from './genesis.ts';
import { findModel } from './models.ts';
import { ConceptRegistry } from './registry.ts';
import {
  measure,
  preregister,
  type BenchmarkGoal,
  type BenchmarkSpec,
  type PreregisteredBenchmark,
} from './benchmark.ts';
import type {
  Axiom,
  Consequence,
  Foundation,
  GenesisInput,
  GenesisRecord,
  OpSpec,
  Rule,
  Term,
} from './types.ts';

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

const RUN_CLOCK = '2026-08-16T00:00:00.000Z';

/* ------------------------------------------------------------------ *
 * Concept proposals, three per foundation.                            *
 * Each adds an operation AND a rule its parent lacks.                 *
 * ------------------------------------------------------------------ */

interface ConceptSeed {
  id: string;
  name: string;
  pattern: string;
  ops: OpSpec[];
  rules: Rule[];
  invariants: string[];
}

const CONCEPT_SEEDS: Record<string, ConceptSeed[]> = {
  'F1-distinction': [
    {
      id: 'F1-C1-decaying-flip',
      name: 'Decaying flip',
      pattern: 'A reversal that does not restore its origin but leaves a residue of one mark.',
      ops: [{ name: 'flip', arity: 1 }],
      rules: [{ id: 'f1c1-decay', lhs: O('flip', O('flip', V('x'))), rhs: O('mark', V('x')) }],
      invariants: ['flip is not an involution: flipping twice marks'],
    },
    {
      id: 'F1-C2-self-fusion',
      name: 'Self-fusion',
      pattern: 'Combining a distinction with itself is not idle; it produces a marked distinction.',
      ops: [{ name: 'fuse', arity: 2 }],
      rules: [{ id: 'f1c2-self', lhs: O('fuse', V('x'), V('x')), rhs: O('mark', V('x')) }],
      invariants: ['fusion is only defined by its diagonal behavior'],
    },
    {
      id: 'F1-C3-depth-distribution',
      name: 'Depth distribution',
      pattern: 'A measurement that passes through joining rather than collapsing it.',
      ops: [{ name: 'depth', arity: 1 }],
      rules: [
        {
          id: 'f1c3-distribute',
          lhs: O('depth', O('join', V('x'), V('y'))),
          rhs: O('join', O('depth', V('x')), O('depth', V('y'))),
        },
      ],
      invariants: ['depth distributes over join'],
    },
  ],
  'F2-constraint': [
    {
      id: 'F2-C1-saturation',
      name: 'Saturation',
      pattern: 'Tightening becomes invisible once saturation is applied — a one-way absorption.',
      ops: [{ name: 'saturate', arity: 1 }],
      rules: [
        { id: 'f2c1-absorb', lhs: O('saturate', O('tighten', V('x'))), rhs: O('saturate', V('x')) },
      ],
      invariants: ['saturation absorbs tightening but not relaxation'],
    },
    {
      id: 'F2-C2-split',
      name: 'Constraint split',
      pattern: 'Splitting a meeting against a third constraint distributes over the meeting.',
      ops: [{ name: 'split', arity: 2 }],
      rules: [
        {
          id: 'f2c2-distribute',
          lhs: O('split', O('meet', V('x'), V('y')), V('z')),
          rhs: O('meet', O('split', V('x'), V('z')), O('split', V('y'), V('z'))),
        },
      ],
      invariants: ['split distributes over meet in its first argument only'],
    },
    {
      id: 'F2-C3-budget-commute',
      name: 'Budget commutation',
      pattern: 'A budget marker commutes past relaxation but is silent about tightening.',
      ops: [{ name: 'budget', arity: 1 }],
      rules: [
        {
          id: 'f2c3-commute',
          lhs: O('budget', O('relax', V('x'))),
          rhs: O('relax', O('budget', V('x'))),
        },
      ],
      invariants: ['budget commutes with relax; its interaction with tighten is deliberately undefined'],
    },
  ],
  'F3-uncertainty': [
    {
      id: 'F3-C1-blur',
      name: 'Blur inversion',
      pattern: 'Blurring a collapse re-opens it into a spread — a partial inverse that is not an inverse.',
      ops: [{ name: 'blur', arity: 1 }],
      rules: [
        { id: 'f3c1-reopen', lhs: O('blur', O('collapse', V('x'))), rhs: O('spread', V('x')) },
      ],
      invariants: ['blur reopens collapse without restoring the original'],
    },
    {
      id: 'F3-C2-pin',
      name: 'Pin distribution',
      pattern: 'Pinning passes through overlay componentwise.',
      ops: [{ name: 'pin', arity: 1 }],
      rules: [
        {
          id: 'f3c2-distribute',
          lhs: O('pin', O('overlay', V('x'), V('y'))),
          rhs: O('overlay', O('pin', V('x')), O('pin', V('y'))),
        },
      ],
      invariants: ['pin distributes over overlay'],
    },
    {
      id: 'F3-C3-haze',
      name: 'Right-sharp haze',
      pattern: 'A second binary operation for which sharpness on the right, not the left, forces collapse.',
      ops: [{ name: 'haze', arity: 2 }],
      rules: [
        { id: 'f3c3-right-sharp', lhs: O('haze', V('x'), C('sharp')), rhs: O('collapse', V('x')) },
      ],
      invariants: ['haze mirrors overlay on the opposite side'],
    },
  ],
};

/* ------------------------------------------------------------------ *
 * Pre-registered benchmarks. Written before any run.                  *
 * ------------------------------------------------------------------ */

/**
 * Fixed start/target pairs, declared here before any run. The metric is
 * "steps to connect these two terms", not "length of whatever the search
 * happened to find" — which is what made the first run's step metric
 * circular.
 */
const BENCHMARK_GOALS: BenchmarkGoal[] = [
  {
    foundation_id: 'F1-distinction',
    start: O('join', C('void'), O('mark', O('mark', C('unit')))),
    target: C('unit'),
    description: 'strip an inert void and undo a double mark',
  },
  {
    foundation_id: 'F2-constraint',
    start: O('meet', C('free'), O('relax', O('tighten', C('blocked')))),
    target: C('blocked'),
    description: 'strip a free meet and undo a tighten/relax pair',
  },
  {
    foundation_id: 'F3-uncertainty',
    start: O('overlay', C('sharp'), O('spread', C('diffuse'))),
    target: C('diffuse'),
    description: 'force a collapse through sharp, then collapse a spread',
  },
];

const BASELINE_BOUND = { maxDepth: 3, maxTerms: 120 };

export const BENCHMARK_SPECS: BenchmarkSpec[] = [
  {
    id: 'bench-reasoning-steps',
    task: 'Steps required to connect a pre-registered start/target pair.',
    metric: 'reasoning_steps',
    baseline_representation: 'GROUND_LOOKUP_TABLE',
    baseline_bound: BASELINE_BOUND,
    comparison: 'LOWER_IS_BETTER',
    margin: 1,
    held_out: false,
    goals: BENCHMARK_GOALS,
  },
  {
    id: 'bench-memory',
    task: 'Peak term size held while connecting the pre-registered goal pair.',
    metric: 'memory',
    baseline_representation: 'GROUND_LOOKUP_TABLE',
    baseline_bound: BASELINE_BOUND,
    comparison: 'LOWER_IS_BETTER',
    margin: 1,
    held_out: false,
    goals: BENCHMARK_GOALS,
  },
  {
    id: 'bench-computation',
    task: 'Rule-firing attempts required to connect the pre-registered goal pair.',
    metric: 'computation',
    baseline_representation: 'GROUND_LOOKUP_TABLE',
    baseline_bound: BASELINE_BOUND,
    comparison: 'LOWER_IS_BETTER',
    margin: 1,
    held_out: false,
    goals: BENCHMARK_GOALS,
  },
  {
    id: 'bench-compositionality',
    task: 'Fraction of rules stated over variables rather than a single ground case.',
    metric: 'compositionality',
    baseline_representation: 'GROUND_LOOKUP_TABLE',
    baseline_bound: BASELINE_BOUND,
    comparison: 'HIGHER_IS_BETTER',
    margin: 1,
    held_out: false,
    goals: BENCHMARK_GOALS,
  },
  {
    id: 'bench-expressiveness',
    task: 'Distinct normal forms over the same bounded set of ground terms.',
    metric: 'expressiveness',
    baseline_representation: 'GROUND_LOOKUP_TABLE',
    baseline_bound: BASELINE_BOUND,
    comparison: 'HIGHER_IS_BETTER',
    margin: 1,
    held_out: false,
    goals: BENCHMARK_GOALS,
  },
];


/**
 * Held-out goals: deeper than the baseline's enumeration bound, and never
 * seeded into it. The lookup table has no entry for these. If a foundation
 * reaches them, it did so by generalizing, which is the only thing that
 * distinguishes an abstraction from a memo.
 */
const HELD_OUT_GOALS: BenchmarkGoal[] = [
  {
    foundation_id: 'F1-distinction',
    start: O('join', C('void'), O('join', O('mark', O('mark', C('unit'))), C('void'))),
    target: C('unit'),
    description: 'HELD OUT: nested inert voids around a double mark',
  },
  {
    foundation_id: 'F2-constraint',
    start: O('meet', C('free'), O('meet', C('free'), O('relax', O('tighten', C('blocked'))))),
    target: C('blocked'),
    description: 'HELD OUT: nested free meets around a tighten/relax pair',
  },
  {
    foundation_id: 'F3-uncertainty',
    start: O('overlay', C('sharp'), O('spread', O('overlay', C('sharp'), O('spread', C('diffuse'))))),
    target: C('diffuse'),
    description: 'HELD OUT: two nested sharp-forced collapses',
  },
];

export const HELD_OUT_SPECS: BenchmarkSpec[] = [
  {
    id: 'bench-generalization-steps',
    task: 'Steps to connect a HELD-OUT start/target pair the baseline table has no entry for.',
    metric: 'reasoning_steps',
    baseline_representation: 'GROUND_LOOKUP_TABLE',
    baseline_bound: BASELINE_BOUND,
    comparison: 'LOWER_IS_BETTER',
    margin: 1,
    held_out: true,
    goals: HELD_OUT_GOALS,
  },
  {
    id: 'bench-generalization-computation',
    task: 'Rule-firing attempts on a HELD-OUT goal pair.',
    metric: 'computation',
    baseline_representation: 'GROUND_LOOKUP_TABLE',
    baseline_bound: BASELINE_BOUND,
    comparison: 'LOWER_IS_BETTER',
    margin: 1,
    held_out: true,
    goals: HELD_OUT_GOALS,
  },
];

/* ------------------------------------------------------------------ * */

function axiomsFor(f: Foundation): Axiom[] {
  return f.rules.map((r) => ({
    id: `ax-${r.id}`,
    statement:
      `Assume, as a stipulation of this system and not as a fact about the world, that ` +
      `${r.id} rewrites its left-hand side to its right-hand side.`,
    kind: 'ASSUMPTION_OF_SYSTEM' as const,
    rule: r,
  }));
}

function consequenceFor(f: Foundation, idSuffix: string): Consequence | null {
  const trace = searchDerivation(f);
  if (!trace) return null;
  const verdict = isNontrivial(f, trace);
  return {
    id: `${f.id}-consequence-${idSuffix}`,
    foundation_id: f.id,
    claim: `The start term reduces through ${trace.steps.length} declared rule applications.`,
    trace,
    nontrivial: verdict.nontrivial,
    nontrivial_reason: verdict.reason,
  };
}

function genesisInputFor(
  f: Foundation,
  opts: {
    id: string;
    name: string;
    definition: string;
    parents: GenesisRecord[];
    consequences: Consequence[];
    maxModelSize: number;
  },
): GenesisInput {
  const contradiction = findContradiction(f, { maxDepth: 4, maxTerms: 120 });
  const model = findModel(f, { maxSize: Math.min(opts.maxModelSize, 2), maxAssignments: 250_000 });
  return {
    id: opts.id,
    name: opts.name,
    created_at: RUN_CLOCK,
    parents: opts.parents,
    supersedes: null,
    foundation: f,
    primitives: f.primitives,
    axioms: axiomsFor(f),
    definition: opts.definition,
    operations: f.operations,
    invalid_operations: [
      'applying any operation outside its declared arity',
      'rewriting at a position that does not exist in the term',
      'introducing a constant not declared in the signature',
    ],
    inference_rules: f.rules,
    identity_conditions:
      'Two terms are identical when their canonical serializations agree byte for byte.',
    equivalence_conditions:
      'Two terms are equivalent when the declared rules reduce them to a common term.',
    invariants: f.invariants,
    examples: f.rules.map((r) => ({ label: `instance of ${r.id}`, term: r.lhs })),
    counterexamples: [],
    boundary_cases: [
      'terms consisting of a bare constant, where no rule fires',
      'terms at the declared depth bound of the contradiction search',
    ],
    consequences: opts.consequences,
    model_attempts: [model],
    contradiction_tests: [contradiction],
    usefulness_tests: [],
    conventional_comparison: null,
    confluence: criticalPairs(f),
    confidence: 0.2,
  };
}

/* ------------------------------------------------------------------ * */

export interface FirstGenerationReport {
  seed: string;
  confluence: ReturnType<typeof criticalPairs>[];
  foundations: Foundation[];
  difference: ReturnType<typeof assessDifference>;
  registry: ConceptRegistry;
  consequences: Consequence[];
  benchmarks: PreregisteredBenchmark[];
  kills: Array<{ id: string; cause: string }>;
  rejected_proposals: Array<{ id: string; rejections: string[] }>;
  open_defects: string[];
}

export async function runFirstGeneration(
  options: { seed?: string; maxModelSize?: number } = {},
): Promise<FirstGenerationReport> {
  const seed = options.seed ?? 'default';
  const maxModelSize = options.maxModelSize ?? 3;
  const registry = new ConceptRegistry();
  const foundations = seedFoundations();
  const difference = assessDifference(foundations);
  const consequences: Consequence[] = [];
  const kills: FirstGenerationReport['kills'] = [];
  const rejected: FirstGenerationReport['rejected_proposals'] = [];
  const openDefects: string[] = [];

  const confluenceReports = foundations.map((f) => criticalPairs(f));
  for (const report of confluenceReports) {
    if (report.status === 'NON_CONFLUENT') {
      openDefects.push(
        `NON-CONFLUENT: ${report.foundation_id} has ${report.unjoined.length} critical pair(s) ` +
          'reaching different normal forms. The rule set does not decide what these terms ' +
          'mean. Found by critical-pair analysis, not by inspection.',
      );
    }
    if (report.status === 'UNKNOWN_BUDGET_EXCEEDED') {
      openDefects.push(`CONFLUENCE UNKNOWN: ${report.foundation_id} — ${report.note}`);
    }
  }

  // Benchmarks are pre-registered BEFORE anything is measured.
  const benchmarks = [...BENCHMARK_SPECS, ...HELD_OUT_SPECS].map((spec) =>
    preregister(spec, RUN_CLOCK),
  );

  for (const foundation of foundations) {
    const rootConsequence = consequenceFor(foundation, 'root');
    if (!rootConsequence) {
      openDefects.push(`${foundation.id}: no derivation found within the search bound.`);
      continue;
    }
    if (!rootConsequence.nontrivial) {
      openDefects.push(`${foundation.id}: only trivial derivations found.`);
    }
    consequences.push(rootConsequence);

    const rootRecord = buildGenesisRecord(
      genesisInputFor(foundation, {
        id: foundation.id,
        name: foundation.name,
        definition:
          `A candidate mathematical foundation declared from the seed primitives ` +
          `[${foundation.primitives.join(', ')}]. Proposed here, not reported from anywhere.`,
        parents: [],
        consequences: [rootConsequence],
        maxModelSize,
      }),
    );
    registry.append(rootRecord);
    if (rootRecord.status.cause_of_death) {
      kills.push({ id: rootRecord.identity.id, cause: rootRecord.status.cause_of_death });
    }

    for (const conceptSeed of CONCEPT_SEEDS[foundation.id] ?? []) {
      const proposal = proposeConcept({
        id: conceptSeed.id,
        name: conceptSeed.name,
        parent: foundation,
        addedOperations: conceptSeed.ops,
        addedRules: conceptSeed.rules,
        addedInvariants: conceptSeed.invariants,
        intendedPattern: conceptSeed.pattern,
      });
      if (!proposal.ok || !proposal.foundation) {
        rejected.push({ id: conceptSeed.id, rejections: proposal.rejections });
        continue;
      }
      const child = proposal.foundation;
      const childConsequence = consequenceFor(child, 'main');
      if (childConsequence) consequences.push(childConsequence);
      else openDefects.push(`${child.id}: no derivation found within the search bound.`);

      const record = buildGenesisRecord(
        genesisInputFor(child, {
          id: child.id,
          name: conceptSeed.name,
          definition: `${conceptSeed.pattern} Constructed over ${foundation.name}; proposed, not reported.`,
          parents: [rootRecord],
          consequences: childConsequence ? [childConsequence] : [],
          maxModelSize,
        }),
      );
      registry.append(record);
      if (record.status.cause_of_death) {
        kills.push({ id: record.identity.id, cause: record.status.cause_of_death });
      }
    }
  }

  // Measure only after pre-registration, and only against the registered hash.
  for (const benchmark of benchmarks) {
    for (const foundation of foundations) {
      measure(benchmark, foundation);
    }
  }

  // Compare each foundation against the others; record, never promote.
  for (let i = 0; i < foundations.length; i += 1) {
    for (let j = i + 1; j < foundations.length; j += 1) {
      const verdict = checkEquivalence(foundations[i]!, foundations[j]!, { maxModelSize: 2 });
      if (verdict.equivalent) {
        openDefects.push(
          `${foundations[i]!.id} and ${foundations[j]!.id} are equivalent — not substantially different.`,
        );
      }
    }
  }

  if (!difference.substantially_different) {
    openDefects.push(
      `Foundations are not substantially different: shared primitives ` +
        `[${difference.shared_primitives.join(', ')}], equivalent pairs ` +
        `${JSON.stringify(difference.equivalent_pairs)}.`,
    );
  }

  openDefects.push(
    'No prior-art corpus is attached, so every novelty status is PRIOR_ART_UNCHECKED and ' +
      'no originality claim is made anywhere in this run.',
  );
  openDefects.push(
    'Finite-model search is bounded to small domains; "no model found" is a flag, not a refutation.',
  );
  openDefects.push(
    'Baselines are measured against a ground lookup table — the same behavior with every ' +
      'abstraction removed. That is one conventional encoding, not the only one. A stronger ' +
      'baseline (a hand-optimized conventional axiomatization) would be a harder test.',
  );
  openDefects.push(
    'On the SEEDED benchmarks the flat lookup table beats every foundation on steps, memory ' +
      'and computation. That is the correct result, not a bug: a memorized table wins any ' +
      'task it has memorized. Read only the HELD-OUT rows as evidence of anything.',
  );
  openDefects.push(
    'bench-compositionality is close to tautological — a ground lookup table has zero ' +
      'variable-bearing rules by construction, so any foundation with one wins 1 to 0. It ' +
      'measures the definition of the baseline, not a property of the foundation. Replace it ' +
      'with a measure of how many distinct ground cases one variable-bearing rule covers.',
  );
  if (kills.length === 0) {
    openDefects.push(
      'No concept died this run. The contradiction search is no longer vacuous — every ' +
        'foundation declares a distinctness assertion and tests/foundry/mutation.test.ts ' +
        'injects a real contradiction into each one and requires the search to find it — ' +
        'but zero kills still means these particular concepts were not hard enough to break.',
    );
  }

  return {
    seed,
    confluence: confluenceReports,
    foundations,
    difference,
    registry,
    consequences,
    benchmarks,
    kills,
    rejected_proposals: rejected,
    open_defects: openDefects,
  };
}
