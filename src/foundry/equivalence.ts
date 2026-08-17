import { findInterpretationWitness, type InterpretationWitness } from './interpretation.ts';
import { isApp, isConst, isVar } from './kernel.ts';
import { gateInterpretationWitness, type WitnessGateResult } from './witness-gate.ts';
import { modelFingerprint } from './models.ts';
import type {
  EquivalenceVerdict,
  Foundation,
  Rule,
  Term,
  TranslationWitness,
} from './types.ts';

/* ------------------------------------------------------------------ *
 * Staged equivalence checker.                                         *
 *                                                                     *
 *   syntactic normalization                                           *
 *     -> known-structure templates                                    *
 *       -> finite-model fingerprints                                  *
 *         -> translation-witness construction                         *
 *                                                                     *
 * Only a completed, verified two-way witness justifies                *
 * EXISTING_EQUIVALENT_FOUND. Nothing earlier is allowed to.           *
 * ------------------------------------------------------------------ */

type NameMap = Record<string, string>;

function rename(t: Term, ops: NameMap, consts: NameMap): Term {
  if (isVar(t)) return t;
  if (isConst(t)) return { c: consts[t.c] ?? t.c };
  if (!isApp(t)) return t;
  return { op: ops[t.op] ?? t.op, args: t.args.map((a) => rename(a, ops, consts)) };
}

/** Canonical string with variables renumbered by first appearance. */
export function canonicalRule(rule: Rule, ops: NameMap = {}, consts: NameMap = {}): string {
  const seen = new Map<string, string>();
  const walk = (t: Term): string => {
    if (isVar(t)) {
      let name = seen.get(t.v);
      if (!name) {
        name = `#${seen.size}`;
        seen.set(t.v, name);
      }
      return name;
    }
    if (isConst(t)) return `«${consts[t.c] ?? t.c}»`;
    if (!isApp(t)) return '?';
    return `${ops[t.op] ?? t.op}(${t.args.map(walk).join(',')})`;
  };
  const lhs = walk(rule.lhs);
  const rhs = walk(rule.rhs);
  return `${lhs}=>${rhs}`;
}

function ruleSet(f: Foundation, ops: NameMap = {}, consts: NameMap = {}): Set<string> {
  return new Set(f.rules.map((r) => canonicalRule(r, ops, consts)));
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

function bijections(from: string[], to: string[]): NameMap[] {
  if (from.length !== to.length) return [];
  if (from.length === 0) return [{}];
  if (from.length > 7) return [];
  return permutations(to).map((order) => {
    const map: NameMap = {};
    from.forEach((name, i) => {
      map[name] = order[i]!;
    });
    return map;
  });
}

function opBijections(a: Foundation, b: Foundation): NameMap[] {
  const byArityA = new Map<number, string[]>();
  const byArityB = new Map<number, string[]>();
  for (const o of a.operations) byArityA.set(o.arity, [...(byArityA.get(o.arity) ?? []), o.name]);
  for (const o of b.operations) byArityB.set(o.arity, [...(byArityB.get(o.arity) ?? []), o.name]);
  if (byArityA.size !== byArityB.size) return [];
  let acc: NameMap[] = [{}];
  for (const [arity, namesA] of byArityA) {
    const namesB = byArityB.get(arity);
    if (!namesB || namesB.length !== namesA.length) return [];
    const options = bijections(namesA, namesB);
    const next: NameMap[] = [];
    for (const partial of acc) {
      for (const option of options) next.push({ ...partial, ...option });
    }
    acc = next;
    if (acc.length > 5040) return acc.slice(0, 5040);
  }
  return acc;
}

function invert(map: NameMap): NameMap {
  const out: NameMap = {};
  for (const [k, v] of Object.entries(map)) out[v] = k;
  return out;
}

export function findWitness(a: Foundation, b: Foundation): TranslationWitness | null {
  const constMaps = bijections(a.constants, b.constants);
  const opMaps = opBijections(a, b);
  const targetRules = ruleSet(b);

  for (const ops of opMaps) {
    for (const consts of constMaps) {
      const translated = ruleSet(a, ops, consts);
      if (translated.size !== targetRules.size) continue;
      const forwardOk = [...translated].every((r) => targetRules.has(r));
      if (!forwardOk) continue;

      const opsBack = invert(ops);
      const constsBack = invert(consts);
      const sourceRules = ruleSet(a);
      const translatedBack = ruleSet(b, opsBack, constsBack);
      const backwardOk =
        translatedBack.size === sourceRules.size &&
        [...translatedBack].every((r) => sourceRules.has(r));
      if (!backwardOk) continue;

      return {
        forward: { from: a.id, to: b.id, operations: ops, constants: consts },
        backward: { from: b.id, to: a.id, operations: opsBack, constants: constsBack },
        forward_verified: true,
        backward_verified: true,
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Known-structure templates                                           *
 * ------------------------------------------------------------------ */

const V = (n: string): Term => ({ v: n });
const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

export const KNOWN_TEMPLATES: Foundation[] = [
  {
    id: 'template:monoid',
    name: 'monoid',
    primitives: [],
    constants: ['1'],
    operations: [{ name: '·', arity: 2 }],
    rules: [
      { id: 'l', lhs: O('·', C('1'), V('x')), rhs: V('x') },
      { id: 'r', lhs: O('·', V('x'), C('1')), rhs: V('x') },
      {
        id: 'a',
        lhs: O('·', O('·', V('x'), V('y')), V('z')),
        rhs: O('·', V('x'), O('·', V('y'), V('z'))),
      },
    ],
    distinct: [],
    invariants: [],
  },
  {
    id: 'template:semigroup',
    name: 'semigroup',
    primitives: [],
    constants: [],
    operations: [{ name: '·', arity: 2 }],
    rules: [
      {
        id: 'a',
        lhs: O('·', O('·', V('x'), V('y')), V('z')),
        rhs: O('·', V('x'), O('·', V('y'), V('z'))),
      },
    ],
    distinct: [],
    invariants: [],
  },
  {
    id: 'template:involution',
    name: 'involutive unary structure',
    primitives: [],
    constants: [],
    operations: [{ name: '~', arity: 1 }],
    rules: [{ id: 'i', lhs: O('~', O('~', V('x'))), rhs: V('x') }],
    distinct: [],
    invariants: [],
  },
  {
    id: 'template:idempotent-unary',
    name: 'idempotent unary structure',
    primitives: [],
    constants: [],
    operations: [{ name: '~', arity: 1 }],
    rules: [{ id: 'i', lhs: O('~', O('~', V('x'))), rhs: O('~', V('x')) }],
    distinct: [],
    invariants: [],
  },

  /* --- Charter §11 expansion. Four templates was not a room worth   ---
     --- escaping: a candidate could earn NO_EMBEDDING_FOUND simply   ---
     --- by not being a monoid. Each of these is a standard structure  ---
     --- expressible as an oriented equational theory, which is the    ---
     --- limit of what the kernel can execute. What that limit         ---
     --- excludes is declared in REDUCTION_TARGET_COVERAGE below.      --- */

  {
    // Function composition with identity. The canonical "functions" target:
    // every monoid is a monoid of endofunctions (Cayley), so a candidate that
    // embeds here is composing functions whatever it calls them.
    id: 'template:composition-monoid',
    name: 'function composition with identity',
    primitives: [],
    constants: ['id'],
    operations: [{ name: '∘', arity: 2 }],
    rules: [
      { id: 'l', lhs: O('∘', C('id'), V('f')), rhs: V('f') },
      { id: 'r', lhs: O('∘', V('f'), C('id')), rhs: V('f') },
      {
        id: 'a',
        lhs: O('∘', O('∘', V('f'), V('g')), V('h')),
        rhs: O('∘', V('f'), O('∘', V('g'), V('h'))),
      },
    ],
    distinct: [],
    invariants: [],
  },
  {
    // Relation composition with converse and identity: an involutive monoid.
    // Converse is antidistributive over composition, which is what separates
    // relations from plain functions.
    id: 'template:relation-algebra-core',
    name: 'relation composition with converse',
    primitives: [],
    constants: ['id'],
    operations: [
      { name: ';', arity: 2 },
      { name: '˘', arity: 1 },
    ],
    rules: [
      { id: 'l', lhs: O(';', C('id'), V('r')), rhs: V('r') },
      { id: 'r', lhs: O(';', V('r'), C('id')), rhs: V('r') },
      {
        id: 'a',
        lhs: O(';', O(';', V('r'), V('s')), V('t')),
        rhs: O(';', V('r'), O(';', V('s'), V('t'))),
      },
      { id: 'inv', lhs: O('˘', O('˘', V('r'))), rhs: V('r') },
      {
        id: 'anti',
        lhs: O('˘', O(';', V('r'), V('s'))),
        rhs: O(';', O('˘', V('s')), O('˘', V('r'))),
      },
    ],
    distinct: [],
    invariants: [],
  },
  {
    // Group: a monoid where everything is invertible.
    id: 'template:group',
    name: 'group',
    primitives: [],
    constants: ['e'],
    operations: [
      { name: '·', arity: 2 },
      { name: 'inv', arity: 1 },
    ],
    rules: [
      { id: 'l', lhs: O('·', C('e'), V('x')), rhs: V('x') },
      { id: 'r', lhs: O('·', V('x'), C('e')), rhs: V('x') },
      {
        id: 'a',
        lhs: O('·', O('·', V('x'), V('y')), V('z')),
        rhs: O('·', V('x'), O('·', V('y'), V('z'))),
      },
      { id: 'il', lhs: O('·', O('inv', V('x')), V('x')), rhs: C('e') },
      { id: 'ir', lhs: O('·', V('x'), O('inv', V('x'))), rhs: C('e') },
    ],
    distinct: [],
    invariants: [],
  },
  {
    // Meet-semilattice: idempotent commutative associative. This IS a partial
    // order in equational clothing — x ≤ y iff x ∧ y = x — so a candidate
    // that embeds here has reinvented ordering.
    id: 'template:semilattice',
    name: 'semilattice (order in equational form)',
    primitives: [],
    constants: [],
    operations: [{ name: '∧', arity: 2 }],
    rules: [
      { id: 'idem', lhs: O('∧', V('x'), V('x')), rhs: V('x') },
      {
        id: 'a',
        lhs: O('∧', O('∧', V('x'), V('y')), V('z')),
        rhs: O('∧', V('x'), O('∧', V('y'), V('z'))),
      },
    ],
    distinct: [],
    invariants: ['commutativity is carried by the declared theory, not an oriented rule'],
    theory: { commutative: ['∧'] },
  },
  {
    // Bounded semilattice = finite set union with the empty set. The "sets"
    // target: union is idempotent, associative, commutative, with unit ∅.
    id: 'template:set-union',
    name: 'set union with empty set',
    primitives: [],
    constants: ['∅'],
    operations: [{ name: '∪', arity: 2 }],
    rules: [
      { id: 'idem', lhs: O('∪', V('x'), V('x')), rhs: V('x') },
      { id: 'unit', lhs: O('∪', C('∅'), V('x')), rhs: V('x') },
      {
        id: 'a',
        lhs: O('∪', O('∪', V('x'), V('y')), V('z')),
        rhs: O('∪', V('x'), O('∪', V('y'), V('z'))),
      },
    ],
    distinct: [],
    invariants: [],
    theory: { commutative: ['∪'] },
  },
  {
    // Monoid action / deterministic automaton transition. act(s, a) moves a
    // state by an input; the identity input does nothing and inputs compose.
    // This is the "automata" target in the only form the kernel can run.
    id: 'template:monoid-action',
    name: 'monoid action (deterministic transition system)',
    primitives: [],
    constants: ['id'],
    operations: [
      { name: '·', arity: 2 },
      { name: 'act', arity: 2 },
    ],
    rules: [
      { id: 'l', lhs: O('·', C('id'), V('m')), rhs: V('m') },
      { id: 'r', lhs: O('·', V('m'), C('id')), rhs: V('m') },
      {
        id: 'a',
        lhs: O('·', O('·', V('m'), V('n')), V('p')),
        rhs: O('·', V('m'), O('·', V('n'), V('p'))),
      },
      { id: 'act-id', lhs: O('act', V('s'), C('id')), rhs: V('s') },
      {
        id: 'act-comp',
        lhs: O('act', O('act', V('s'), V('m')), V('n')),
        rhs: O('act', V('s'), O('·', V('m'), V('n'))),
      },
    ],
    distinct: [],
    invariants: [],
  },
  {
    // Sequential composition with skip and abort: a monoid with an absorbing
    // zero. The "programs" target — abort swallows whatever follows it.
    id: 'template:sequential-with-abort',
    name: 'sequential composition with skip and absorbing abort',
    primitives: [],
    constants: ['skip', 'abort'],
    operations: [{ name: ';', arity: 2 }],
    rules: [
      { id: 'l', lhs: O(';', C('skip'), V('p')), rhs: V('p') },
      { id: 'r', lhs: O(';', V('p'), C('skip')), rhs: V('p') },
      {
        id: 'a',
        lhs: O(';', O(';', V('p'), V('q')), V('r')),
        rhs: O(';', V('p'), O(';', V('q'), V('r'))),
      },
      { id: 'zl', lhs: O(';', C('abort'), V('p')), rhs: C('abort') },
      { id: 'zr', lhs: O(';', V('p'), C('abort')), rhs: C('abort') },
    ],
    distinct: [['skip', 'abort']],
    invariants: [],
  },
  {
    // Left-zero semigroup: x·y = x. The cheapest way to be associative
    // without being anything else, and a common accident of enumeration.
    id: 'template:left-zero',
    name: 'left-zero semigroup (first argument wins)',
    primitives: [],
    constants: [],
    operations: [{ name: '·', arity: 2 }],
    rules: [{ id: 'lz', lhs: O('·', V('x'), V('y')), rhs: V('x') }],
    distinct: [],
    invariants: [],
  },
  {
    // Right-zero semigroup: x·y = y. Its mirror, and NOT isomorphic to it —
    // keeping both is what stops a one-sided candidate matching by accident.
    id: 'template:right-zero',
    name: 'right-zero semigroup (second argument wins)',
    primitives: [],
    constants: [],
    operations: [{ name: '·', arity: 2 }],
    rules: [{ id: 'rz', lhs: O('·', V('x'), V('y')), rhs: V('y') }],
    distinct: [],
    invariants: [],
  },
  {
    // Pointed unary collapse: f(x) = z for all x. The degenerate structure —
    // present as a target precisely so a candidate that reduces to "constant
    // function" is named as one rather than surviving.
    id: 'template:constant-collapse',
    name: 'constant collapse',
    primitives: [],
    constants: ['z'],
    operations: [{ name: 'f', arity: 1 }],
    rules: [{ id: 'k', lhs: O('f', V('x')), rhs: C('z') }],
    distinct: [],
    invariants: [],
  },
  {
    // Free unary structure with a fixed point: successor on a pointed set
    // where the point is fixed. The nearest equational stand-in for counting.
    id: 'template:pointed-unary-fixpoint',
    name: 'pointed unary structure with a fixed point',
    primitives: [],
    constants: ['z'],
    operations: [{ name: 's', arity: 1 }],
    rules: [{ id: 'fix', lhs: O('s', C('z')), rhs: C('z') }],
    distinct: [],
    invariants: [],
  },
];

/* ------------------------------------------------------------------ *
 * Target coverage — what the room actually contains                   *
 *                                                                     *
 * Charter §11 names eight families a candidate must be attacked with. *
 * The kernel executes oriented equational rewriting, and some of      *
 * those families are not equational theories. Declaring that is not   *
 * an excuse; it is the caveat that must travel with every             *
 * NO_EMBEDDING_FOUND verdict, so nobody reads survival as stronger    *
 * than the room it survived.                                          *
 * ------------------------------------------------------------------ */

export interface ReductionTargetCoverage {
  family: string;
  status: 'COVERED' | 'PARTIALLY_COVERED' | 'NOT_EXPRESSIBLE_IN_TARGET_LANGUAGE';
  targets: string[];
  rationale: string;
}

export const REDUCTION_TARGET_COVERAGE: ReductionTargetCoverage[] = [
  {
    family: 'sets',
    status: 'PARTIALLY_COVERED',
    targets: ['template:set-union', 'template:semilattice'],
    rationale:
      'Finite union with a unit is a bounded semilattice and is covered. Complement, ' +
      'and therefore full Boolean algebra, needs a second operation interacting with ' +
      'union by rules the enumerator cannot currently produce.',
  },
  {
    family: 'relations',
    status: 'PARTIALLY_COVERED',
    targets: ['template:relation-algebra-core'],
    rationale:
      'Composition, converse, and identity are covered as an involutive monoid. Union ' +
      'of relations and the Boolean part of relation algebra are not.',
  },
  {
    family: 'functions',
    status: 'COVERED',
    targets: ['template:composition-monoid', 'template:monoid', 'template:constant-collapse'],
    rationale:
      'Composition with identity is exactly the monoid of endofunctions; by Cayley every ' +
      'monoid embeds there, so a candidate reducible to function composition is caught.',
  },
  {
    family: 'graphs',
    status: 'NOT_EXPRESSIBLE_IN_TARGET_LANGUAGE',
    targets: [],
    rationale:
      'A graph is a relation on a carrier, not an equational theory over terms. The ' +
      'kernel has no membership or edge predicate, so a candidate encoding graph ' +
      'structure cannot currently be reduced to one. Survival against this family is ' +
      'not evidence of anything.',
  },
  {
    family: 'algebraic structures',
    status: 'COVERED',
    targets: [
      'template:monoid',
      'template:semigroup',
      'template:group',
      'template:semilattice',
      'template:left-zero',
      'template:right-zero',
      'template:involution',
      'template:idempotent-unary',
    ],
    rationale:
      'The equational structures reachable by the enumerator: semigroups, monoids, ' +
      'groups, semilattices, bands, and the unary structures.',
  },
  {
    family: 'automata',
    status: 'PARTIALLY_COVERED',
    targets: ['template:monoid-action'],
    rationale:
      'A deterministic transition system is a monoid action and is covered. Acceptance, ' +
      'initial and final states, and nondeterminism are not equational and are absent.',
  },
  {
    family: 'probability spaces',
    status: 'NOT_EXPRESSIBLE_IN_TARGET_LANGUAGE',
    targets: [],
    rationale:
      'A probability space needs a measure on a sigma-algebra. Convex combination is ' +
      'a family of operations indexed by a real parameter, which a fixed finite ' +
      'signature cannot carry. No candidate has been tested against this family.',
  },
  {
    family: 'programs',
    status: 'PARTIALLY_COVERED',
    targets: ['template:sequential-with-abort', 'template:monoid-action'],
    rationale:
      'Sequential composition with skip and an absorbing failure is covered. Choice, ' +
      'iteration, and state are not — a Kleene algebra needs union and a star the ' +
      'kernel cannot execute.',
  },
];

export function matchTemplates(f: Foundation): string[] {
  return KNOWN_TEMPLATES.filter((t) => findWitness(f, t) !== null).map((t) => t.name);
}

/* ------------------------------------------------------------------ *
 * The staged check                                                    *
 * ------------------------------------------------------------------ */

export interface EquivalenceOptions {
  maxModelSize?: number;
  /**
   * Search for an interpretation witness when no name bijection exists.
   * Catches a concept that DEFINES a new operation out of existing ones —
   * a new name with no new behavior, which a bijection search cannot see
   * because the signatures no longer match.
   */
  interpretation?: boolean;
}

export interface StagedEquivalenceVerdict extends EquivalenceVerdict {
  interpretation_witness: InterpretationWitness | null;
  /**
   * The gate's ruling on `interpretation_witness`, carried as first-class
   * evidence. Null only when no interpretation was searched for at all.
   *
   * An EXISTING_EQUIVALENT_FOUND verdict is terminal, so it may never be
   * reported without the witness that justifies it AND the gate that
   * admitted that witness. A witness the gate refused appears here with
   * `admitted: false` and its failed condition — the equivalence is not
   * downgraded, it does not exist.
   */
  witness_gate: WitnessGateResult | null;
}

/**
 * Search for a two-way interpretation and put it through the gate.
 *
 * This is the ONLY route by which an interpretation may reach an equivalence
 * verdict. It returns the witness and the gate's ruling together, so that no
 * caller can hold one without the other, and appends the rejection reason to
 * the verdict notes when the gate refuses.
 */
function gatedInterpretation(
  a: Foundation,
  b: Foundation,
  options: EquivalenceOptions,
  notes: string[],
): { witness: InterpretationWitness | null; gate: WitnessGateResult | null; admitted: boolean } {
  if (!options.interpretation) return { witness: null, gate: null, admitted: false };
  const witness = findInterpretationWitness(a, b);
  if (!witness) return { witness: null, gate: null, admitted: false };

  const gate = gateInterpretationWitness(a, b, witness);
  if (!gate.admitted) {
    notes.push(
      `Interpretation witness REJECTED by the witness gate at ${gate.failed_condition}: ${gate.reason} ` +
        'A witness that fails the gate is not a weaker kill; it is no kill at all.',
    );
  }
  return { witness, gate, admitted: gate.admitted };
}

export function checkEquivalence(
  a: Foundation,
  b: Foundation,
  options: EquivalenceOptions = {},
): StagedEquivalenceVerdict {
  const maxModelSize = options.maxModelSize ?? 3;
  const notes: string[] = [];
  const templates = { a: matchTemplates(a), b: matchTemplates(b) };
  const emptyFingerprints = { a: '', b: '' };

  // Stage 1 — syntactic normalization of the signature.
  const arities = (f: Foundation): string =>
    f.operations
      .map((o) => o.arity)
      .sort((x, y) => x - y)
      .join(',');
  const signatureMatches =
    arities(a) === arities(b) &&
    a.constants.length === b.constants.length &&
    a.rules.length === b.rules.length;

  if (!signatureMatches) {
    notes.push('Signatures differ in arities, constant count, or rule count.');
    // A differing signature does NOT settle the question. The concept may
    // have defined its extra operation out of the others.
    const { witness: interp, gate, admitted } = gatedInterpretation(a, b, options, notes);
    if (admitted) {
      notes.push(
        'Signatures differ, but a two-way interpretation witness verified AND passed the ' +
          'witness gate: every operation of each system is definable as a non-erasing term in ' +
          'the other, and every rule survives translation with work left to do. This is a ' +
          're-skin, not a new structure.',
      );
      return {
        equivalent: true,
        stage: 'INTERPRETATION_WITNESS_VERIFIED',
        templates,
        fingerprints: emptyFingerprints,
        witness: null,
        interpretation_witness: interp,
        witness_gate: gate,
        notes,
      };
    }
    return {
      equivalent: false,
      stage: 'SIGNATURE_MISMATCH',
      templates,
      fingerprints: emptyFingerprints,
      witness: null,
      interpretation_witness: interp,
      witness_gate: gate,
      notes,
    };
  }

  // Stage 2 — known-structure templates. Recorded, never decisive.
  notes.push(
    `Template match: ${a.id} -> [${templates.a.join(', ') || 'none'}]; ${b.id} -> [${templates.b.join(', ') || 'none'}]`,
  );

  // Stage 3 — finite-model fingerprints as a cheap refutation filter.
  const fingerprints = {
    a: modelFingerprint(a, maxModelSize),
    b: modelFingerprint(b, maxModelSize),
  };
  if (fingerprints.a !== fingerprints.b) {
    notes.push('Finite-model fingerprints differ; these structures cannot be equivalent.');
    return {
      equivalent: false,
      stage: 'FINGERPRINT_MISMATCH',
      templates,
      fingerprints,
      witness: null,
      interpretation_witness: null,
      witness_gate: null,
      notes,
    };
  }

  // Stage 4 — translation witness. The only thing that can conclude equivalence.
  const witness = findWitness(a, b);
  if (!witness) {
    notes.push(
      'Fingerprints agree but no two-way translation was constructed. Similarity is not equivalence.',
    );
    const { witness: interp, gate, admitted } = gatedInterpretation(a, b, options, notes);
    if (admitted) {
      notes.push('No name bijection, but a two-way interpretation witness verified and passed the gate.');
      return {
        equivalent: true,
        stage: 'INTERPRETATION_WITNESS_VERIFIED',
        templates,
        fingerprints,
        witness: null,
        interpretation_witness: interp,
        witness_gate: gate,
        notes,
      };
    }
    return {
      equivalent: false,
      stage: 'NO_WITNESS_FOUND',
      templates,
      fingerprints,
      witness: null,
      interpretation_witness: interp,
      witness_gate: gate,
      notes,
    };
  }

  notes.push('Two-way translation witness constructed and verified in both directions.');
  return {
    equivalent: true,
    stage: 'WITNESS_VERIFIED',
    templates,
    fingerprints,
    witness,
    interpretation_witness: null,
    witness_gate: null,
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * The Reduction Attack (Charter §11)                                  *
 *                                                                     *
 * Every candidate is presumed to be existing mathematics wearing a    *
 * new name, and this function is the prosecution. It attempts, in     *
 * good faith and at full strength, to embed the candidate into every  *
 * declared target, and it records every attempt — including the ones  *
 * that failed, because "could not reduce it" means nothing without    *
 * the attempted embeddings attached.                                  *
 * ------------------------------------------------------------------ */

export type EmbeddingOutcome =
  | 'BIJECTION_VERIFIED'
  | 'INTERPRETATION_VERIFIED'
  | 'ONE_WAY_INTERPRETATION'
  | 'FINGERPRINT_MISMATCH'
  | 'SIGNATURE_MISMATCH'
  | 'NO_WITNESS';

export interface EmbeddingAttempt {
  target_id: string;
  target_name: string;
  outcome: EmbeddingOutcome;
  stage: string;
  notes: string[];
}

export interface ReductionReport {
  candidate_id: string;
  /** Feeds levels.ts directly: this is what caps the candidate's level. */
  outcome:
    | 'NOT_ATTEMPTED'
    | 'LOSSLESS_EMBEDDING'
    | 'EMBEDDING_WITH_LOSS'
    | 'NO_EMBEDDING_FOUND';
  witness_target: string | null;
  /** What the embedding fails to recover — §11 calls this the interesting object. */
  loss: string | null;
  attempts: EmbeddingAttempt[];
  target_count: number;
  coverage: ReductionTargetCoverage[];
  caveat: string;
}

function classifyAttempt(verdict: StagedEquivalenceVerdict): EmbeddingOutcome {
  if (verdict.equivalent) {
    return verdict.stage === 'WITNESS_VERIFIED'
      ? 'BIJECTION_VERIFIED'
      : 'INTERPRETATION_VERIFIED';
  }
  if (verdict.interpretation_witness) return 'ONE_WAY_INTERPRETATION';
  if (verdict.stage === 'FINGERPRINT_MISMATCH') return 'FINGERPRINT_MISMATCH';
  if (verdict.stage === 'SIGNATURE_MISMATCH') return 'SIGNATURE_MISMATCH';
  return 'NO_WITNESS';
}

/** The caveat that travels with a survival verdict, built from the coverage table. */
function survivalCaveat(coverage: ReductionTargetCoverage[], targetCount: number): string {
  const gaps = coverage.filter((c) => c.status === 'NOT_EXPRESSIBLE_IN_TARGET_LANGUAGE');
  const partial = coverage.filter((c) => c.status === 'PARTIALLY_COVERED');
  return (
    `Attacked against ${targetCount} declared target(s). This verdict is bounded by the ` +
    'expressiveness of the target language, which is oriented equational rewriting. ' +
    `Families marked NOT_EXPRESSIBLE_IN_TARGET_LANGUAGE (${gaps.map((g) => g.family).join(', ') || 'none'}) ` +
    'were never tested, so survival is not evidence with respect to them. Families ' +
    `only partially covered (${partial.map((p) => p.family).join(', ') || 'none'}) were tested ` +
    'against a fragment. Survival here means "not reducible to what we can execute", ' +
    'never "not reducible".'
  );
}

export function reductionAttack(
  candidate: Foundation,
  targets: readonly Foundation[] = KNOWN_TEMPLATES,
  options: EquivalenceOptions = { interpretation: true, maxModelSize: 3 },
): ReductionReport {
  const attempts: EmbeddingAttempt[] = [];
  const caveat = survivalCaveat(REDUCTION_TARGET_COVERAGE, targets.length);

  if (targets.length === 0) {
    return {
      candidate_id: candidate.id,
      outcome: 'NOT_ATTEMPTED',
      witness_target: null,
      loss: null,
      attempts,
      target_count: 0,
      coverage: REDUCTION_TARGET_COVERAGE,
      caveat:
        'No targets were supplied. An unattempted reduction is not a survived one, and ' +
        'caps the candidate at level 1.',
    };
  }

  let lossless: EmbeddingAttempt | null = null;
  let oneWay: EmbeddingAttempt | null = null;

  for (const target of targets) {
    const verdict = checkEquivalence(candidate, target, options);
    const outcome = classifyAttempt(verdict);
    const attempt: EmbeddingAttempt = {
      target_id: target.id,
      target_name: target.name,
      outcome,
      stage: verdict.stage,
      notes: verdict.notes.length > 0 ? verdict.notes : [`stage ${verdict.stage}`],
    };
    attempts.push(attempt);
    // Record every attempt before short-circuiting the verdict: the attempts
    // ARE the evidence, and a report that stops at the first hit cannot be
    // audited.
    if (!lossless && (outcome === 'BIJECTION_VERIFIED' || outcome === 'INTERPRETATION_VERIFIED')) {
      lossless = attempt;
    }
    if (!oneWay && outcome === 'ONE_WAY_INTERPRETATION') oneWay = attempt;
  }

  if (lossless) {
    return {
      candidate_id: candidate.id,
      outcome: 'LOSSLESS_EMBEDDING',
      witness_target: lossless.target_id,
      loss: null,
      attempts,
      target_count: targets.length,
      coverage: REDUCTION_TARGET_COVERAGE,
      caveat:
        `Embeds faithfully into ${lossless.target_name} (${lossless.stage}). The novelty ` +
        'claim is dead; the embedding is kept as a translation artifact.',
    };
  }

  if (oneWay) {
    return {
      candidate_id: candidate.id,
      outcome: 'EMBEDDING_WITH_LOSS',
      witness_target: oneWay.target_id,
      loss:
        `An interpretation into ${oneWay.target_name} verified in one direction only. ` +
        'What the reverse direction cannot recover is the candidate’s contribution, ' +
        'and the benchmark must be designed around exactly that.',
      attempts,
      target_count: targets.length,
      coverage: REDUCTION_TARGET_COVERAGE,
      caveat,
    };
  }

  return {
    candidate_id: candidate.id,
    outcome: 'NO_EMBEDDING_FOUND',
    witness_target: null,
    loss: null,
    attempts,
    target_count: targets.length,
    coverage: REDUCTION_TARGET_COVERAGE,
    caveat,
  };
}
