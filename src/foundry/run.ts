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

export const BENCHMARK_SPECS: BenchmarkSpec[] = [
  {
    id: 'bench-reasoning-steps',
    task: 'Mean kernel steps required by the recorded nontrivial derivations of a foundation.',
    metric: 'reasoning_steps',
    baseline_representation: 'conventional term rewriting over the same signature',
    baseline_value: 4,
    lower_is_better: true,
    success_threshold: 3,
  },
  {
    id: 'bench-memory',
    task: 'Peak term size held during kernel replay of the recorded derivations.',
    metric: 'memory',
    baseline_representation: 'flat expression tree, no sharing',
    baseline_value: 12,
    lower_is_better: true,
    success_threshold: 8,
  },
  {
    id: 'bench-computation',
    task: 'Rule-firing attempts required to reproduce the recorded derivations.',
    metric: 'computation',
    baseline_representation: 'exhaustive rule scan per step',
    baseline_value: 30,
    lower_is_better: true,
    success_threshold: 18,
  },
  {
    id: 'bench-compositionality',
    task: 'Declared rules acting on composite terms, per operation.',
    metric: 'compositionality',
    baseline_representation: 'signature with no composite-term rules',
    baseline_value: 0.5,
    lower_is_better: false,
    success_threshold: 1,
  },
  {
    id: 'bench-expressiveness',
    task: 'Distinct normal forms reachable among bounded ground terms.',
    metric: 'expressiveness',
    baseline_representation: 'ground terms with no rules (every term its own normal form)',
    baseline_value: 8,
    lower_is_better: false,
    success_threshold: 4,
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
    confidence: 0.2,
  };
}

/* ------------------------------------------------------------------ * */

export interface FirstGenerationReport {
  seed: string;
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

  // Benchmarks are pre-registered BEFORE anything is measured.
  const benchmarks = BENCHMARK_SPECS.map((spec) => preregister(spec, RUN_CLOCK));

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
      measure(benchmark, {
        foundation,
        consequences: consequences.filter((c) => c.foundation_id === foundation.id),
      });
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
    'BENCHMARK BASELINES ARE STIPULATED, NOT MEASURED. baseline_value and success_threshold ' +
      'in BENCHMARK_SPECS are numbers chosen at pre-registration time, not results from ' +
      'running an actual conventional representation on the same task. The "advantage" ' +
      'column therefore measures nothing about these foundations and must not be read as one. ' +
      'Fix: implement a real baseline runner before any utility status is ever set.',
  );
  openDefects.push(
    'CIRCULAR METRIC: bench-reasoning-steps measures the step count of derivations that ' +
      'searchDerivation was told to stop at (minSteps=2). It reports the search criterion ' +
      'back to itself. Fix: pre-register a fixed target term per foundation and measure the ' +
      'steps needed to reach it, rather than measuring whatever the search happened to find.',
  );
  if (kills.length === 0) {
    openDefects.push(
      'VACUOUS CONTRADICTION SEARCH: no concept died this run, but none of the three ' +
        'foundations declares a `distinct` pair, so findContradiction had nothing it could ' +
        'possibly report. Zero kills here is evidence of an untested search, not of ' +
        'consistency. Fix: require every foundation to declare at least one distinctness ' +
        'assertion, or the search is not a test.',
    );
  }

  return {
    seed,
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
