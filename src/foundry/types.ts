export const FOUNDRY_GENESIS_SCHEMA = 'sentra-foundry-genesis-v1';
export const FOUNDRY_NATIVE_SCHEMA = 'sentra-foundry-native-term-v1';

/* ------------------------------------------------------------------ *
 * Epistemic classes                                                   *
 * ------------------------------------------------------------------ */

export type EpistemicClass =
  | 'SOURCED_CLAIM'
  | 'CONSTRUCTED_ARTIFACT'
  | 'DERIVED_RESULT';

export type FormalStatus =
  | 'GENERATED_CANDIDATE'
  | 'FORMALIZED'
  | 'INTERNALLY_CONSISTENT'
  | 'CONTRADICTORY'
  | 'DERIVATION_VERIFIED';

export type NoveltyStatus =
  | 'PRIOR_ART_UNCHECKED'
  | 'EXISTING_EQUIVALENT_FOUND'
  | 'POSSIBLY_NOVEL'
  | 'NOVELTY_CONFIRMED';

export type UtilityStatus =
  | 'UNTESTED'
  | 'EXPERIMENTALLY_USEFUL'
  | 'NO_MEASURED_ADVANTAGE';

/* ------------------------------------------------------------------ *
 * Native representation                                               *
 *                                                                     *
 * This is the only representation the kernel executes. A concept may  *
 * have no conventional-notation translation; it may never have a form *
 * the kernel cannot run.                                              *
 * ------------------------------------------------------------------ */

export type Term =
  | { v: string }
  | { c: string }
  | { op: string; args: Term[] };

export interface Rule {
  id: string;
  lhs: Term;
  rhs: Term;
}

export interface OpSpec {
  name: string;
  arity: number;
}

export interface Foundation {
  id: string;
  name: string;
  primitives: string[];
  constants: string[];
  operations: OpSpec[];
  rules: Rule[];
  /** Declared-distinct constant pairs. Deriving one from the other is a contradiction. */
  distinct: Array<[string, string]>;
  invariants: string[];
  parent_id?: string | null;
}

export interface TraceStep {
  rule: string;
  path: number[];
  result: Term;
}

export interface Trace {
  start: Term;
  steps: TraceStep[];
}

export interface ReplayResult {
  ok: boolean;
  final: Term | null;
  reason: string | null;
  steps_replayed: number;
  max_term_size: number;
}

/* ------------------------------------------------------------------ *
 * Genesis record                                                      *
 * ------------------------------------------------------------------ */

export interface Axiom {
  id: string;
  statement: string;
  /** Axioms are assumptions of the system. Never facts about the world. */
  kind: 'ASSUMPTION_OF_SYSTEM';
  rule: Rule | null;
}

export interface Consequence {
  id: string;
  foundation_id: string;
  claim: string;
  trace: Trace;
  nontrivial: boolean;
  nontrivial_reason: string;
}

export interface ModelAttempt {
  foundation_id: string;
  sizes_tried: number[];
  found: boolean;
  model: FiniteModel | null;
  exhausted: boolean;
  budget_spent: number;
  note: string;
}

export interface FiniteModel {
  size: number;
  constants: Record<string, number>;
  operations: Record<string, number[]>;
}

export interface ContradictionProof {
  term: Term;
  left: Trace;
  right: Trace;
  distinct_pair: [string, string];
}

export interface ContradictionSearchResult {
  found: boolean;
  proof: ContradictionProof | null;
  budget_spent: number;
  bound: { maxDepth: number; maxTerms: number };
}

export interface TranslationWitness {
  forward: {
    from: string;
    to: string;
    operations: Record<string, string>;
    constants: Record<string, string>;
  };
  backward: {
    from: string;
    to: string;
    operations: Record<string, string>;
    constants: Record<string, string>;
  };
  forward_verified: boolean;
  backward_verified: boolean;
}

export interface EquivalenceVerdict {
  equivalent: boolean;
  stage:
    | 'SIGNATURE_MISMATCH'
    | 'TEMPLATE_MISMATCH'
    | 'FINGERPRINT_MISMATCH'
    | 'NO_WITNESS_FOUND'
    | 'WITNESS_VERIFIED'
    | 'INTERPRETATION_WITNESS_VERIFIED';
  templates: { a: string[]; b: string[] };
  fingerprints: { a: string; b: string };
  witness: TranslationWitness | null;
  notes: string[];
}

export interface UsefulnessTest {
  benchmark_id: string;
  prereg_hash: string;
  metric: string;
  baseline: number;
  measured: number;
  advantage: boolean;
}

export interface GenesisRecord {
  schema_version: typeof FOUNDRY_GENESIS_SCHEMA;
  epistemic_class: 'CONSTRUCTED_ARTIFACT';
  /** Always empty. A construction is proposed, not reported. */
  citations: string[];
  supersedes: string | null;

  identity: {
    id: string;
    name: string;
    created_at: string;
    parents: string[];
    parent_lineage_hashes: string[];
    lineage_hash: string | null;
  };

  formal: {
    foundation: Foundation;
    primitives: string[];
    axioms: Axiom[];
    definition: string;
    native: { schema: typeof FOUNDRY_NATIVE_SCHEMA; semantics: string; kernel_executable: true };
    operations: OpSpec[];
    invalid_operations: string[];
    inference_rules: Rule[];
    identity_conditions: string;
    equivalence_conditions: string;
    invariants: string[];
  };

  behavior: {
    examples: Array<{ label: string; term: Term }>;
    counterexamples: Array<{ label: string; term: Term; why: string }>;
    boundary_cases: string[];
    consequences: Consequence[];
    model_attempts: ModelAttempt[];
  };

  validation: {
    contradiction_tests: ContradictionSearchResult[];
    usefulness_tests: UsefulnessTest[];
    conventional_comparison: EquivalenceVerdict | null;
    /** Critical-pair analysis. A rule set that does not converge is a finding. */
    confluence: ConfluenceReportLike | null;
  };

  status: {
    formal: FormalStatus;
    novelty: NoveltyStatus;
    utility: UtilityStatus;
    confidence: number;
    distinguishing_behavior: string | null;
    translation_witness: TranslationWitness | null;
    cause_of_death: string | null;
  };
}

export interface GenesisInput {
  id: string;
  name: string;
  created_at: string;
  parents: GenesisRecord[];
  supersedes: string | null;
  foundation: Foundation;
  primitives: string[];
  axioms: Axiom[];
  definition: string;
  operations: OpSpec[];
  invalid_operations: string[];
  inference_rules: Rule[];
  identity_conditions: string;
  equivalence_conditions: string;
  invariants: string[];
  examples: Array<{ label: string; term: Term }>;
  counterexamples: Array<{ label: string; term: Term; why: string }>;
  boundary_cases: string[];
  consequences: Consequence[];
  model_attempts: ModelAttempt[];
  contradiction_tests: ContradictionSearchResult[];
  usefulness_tests: UsefulnessTest[];
  conventional_comparison: EquivalenceVerdict | null;
  confluence: ConfluenceReportLike | null;
  confidence: number;
}

/** Structural shape of a confluence report, declared here to avoid a cycle. */
export interface ConfluenceReportLike {
  foundation_id: string;
  status: string;
  pairs_examined: number;
  unjoined: unknown[];
  contradictions: unknown[];
  budget_spent: number;
  note: string;
}
