import type {
  Axiom,
  ContradictionSearchResult,
  Foundation,
  GenesisInput,
  GenesisRecord,
} from '../../src/foundry/index.ts';

const v = (name: string) => ({ v: name });
const c = (name: string) => ({ c: name });
const op = (name: string, ...args: ReturnType<typeof v>[]) => ({ op: name, args });

export const MONOID_FOUNDATION: Foundation = {
  id: 'known-monoid',
  name: 'Monoid (known structure, used as the equivalence target)',
  primitives: ['element', 'composition'],
  constants: ['e'],
  operations: [{ name: 'mul', arity: 2 }],
  rules: [
    { id: 'left-identity', lhs: op('mul', c('e'), v('x')), rhs: v('x') },
    { id: 'right-identity', lhs: op('mul', v('x'), c('e')), rhs: v('x') },
    {
      id: 'assoc',
      lhs: { op: 'mul', args: [{ op: 'mul', args: [v('x'), v('y')] }, v('z')] },
      rhs: { op: 'mul', args: [v('x'), { op: 'mul', args: [v('y'), v('z')] }] },
    },
  ],
  distinct: [],
  invariants: ['composition is total and associative', 'e is a two-sided identity'],
};

export const RESKINNED_MONOID: Foundation = {
  id: 'fluxor-algebra',
  name: 'Fluxor Algebra (deliberately re-skinned monoid)',
  primitives: ['fluxon', 'blending'],
  constants: ['null_flux'],
  operations: [{ name: 'blend', arity: 2 }],
  rules: [
    { id: 'inert-left', lhs: op('blend', c('null_flux'), v('p')), rhs: v('p') },
    { id: 'inert-right', lhs: op('blend', v('p'), c('null_flux')), rhs: v('p') },
    {
      id: 'regroup',
      lhs: { op: 'blend', args: [{ op: 'blend', args: [v('p'), v('q')] }, v('r')] },
      rhs: { op: 'blend', args: [v('p'), { op: 'blend', args: [v('q'), v('r')] }] },
    },
  ],
  distinct: [],
  invariants: ['blending is total', 'null_flux is inert on both sides'],
};

export const PLANTED_CONTRADICTION: Foundation = {
  id: 'planted-contradiction',
  name: 'Deliberately inconsistent one-place system',
  primitives: ['token', 'step'],
  constants: ['a', 'b', 'k'],
  operations: [{ name: 'f', arity: 1 }],
  rules: [
    { id: 'collapse-b', lhs: op('f', c('a')), rhs: c('b') },
    { id: 'collapse-k', lhs: op('f', c('a')), rhs: c('k') },
  ],
  distinct: [['b', 'k']],
  invariants: ['f is a function: every argument has exactly one value'],
};

const AXIOMS_FROM = (f: Foundation): Axiom[] =>
  f.rules.map((r) => ({
    id: `ax-${r.id}`,
    statement: `Assume, as a rule of this system, that ${r.id} rewrites its left side to its right side.`,
    kind: 'ASSUMPTION_OF_SYSTEM' as const,
    rule: r,
  }));

export function minimalGenesisInput(
  id: string,
  overrides: Partial<GenesisInput> & {
    parents?: GenesisRecord[];
    foundation?: Foundation;
    contradiction?: ContradictionSearchResult;
  } = {},
): GenesisInput {
  const foundation = overrides.foundation ?? MONOID_FOUNDATION;
  const base: GenesisInput = {
    id,
    name: `test concept ${id}`,
    created_at: '2026-08-16T00:00:00.000Z',
    parents: overrides.parents ?? [],
    supersedes: overrides.supersedes ?? null,
    foundation,
    primitives: foundation.primitives,
    axioms: overrides.axioms ?? AXIOMS_FROM(foundation),
    definition: `A test-scoped construction over ${foundation.name}.`,
    operations: foundation.operations,
    invalid_operations: ['applying an operation outside its declared arity'],
    inference_rules: foundation.rules,
    identity_conditions: 'Two terms are identical when their canonical serializations agree.',
    equivalence_conditions: 'Two terms are equivalent when they share a normal form.',
    invariants: foundation.invariants,
    examples: [{ label: 'identity absorption', term: { op: 'mul', args: [{ c: 'e' }, { v: 'x' }] } }],
    counterexamples: [],
    boundary_cases: ['the empty composition'],
    consequences: [],
    model_attempts: [],
    contradiction_tests: overrides.contradiction
      ? [overrides.contradiction]
      : [{ found: false, proof: null, budget_spent: 1, bound: { maxDepth: 1, maxTerms: 1 } }],
    usefulness_tests: [],
    conventional_comparison: null,
    confidence: 0.1,
  };
  return { ...base, ...overrides } as GenesisInput;
}
