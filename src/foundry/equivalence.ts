import { findInterpretationWitness, type InterpretationWitness } from './interpretation.ts';
import { isApp, isConst, isVar } from './kernel.ts';
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
    const interp = options.interpretation
      ? findInterpretationWitness(a, b)
      : null;
    if (interp && interp.forward_verified && interp.backward_verified) {
      notes.push(
        'Signatures differ, but a two-way interpretation witness verified: every operation ' +
          'of each system is definable as a term in the other, and every rule survives ' +
          'translation. This is a re-skin, not a new structure.',
      );
      return {
        equivalent: true,
        stage: 'INTERPRETATION_WITNESS_VERIFIED',
        templates,
        fingerprints: emptyFingerprints,
        witness: null,
        interpretation_witness: interp,
        notes,
      };
    }
    if (interp) {
      notes.push(
        'An interpretation was found in one direction only. That is an embedding, not an ' +
          'equivalence, and is not grounds for EXISTING_EQUIVALENT_FOUND.',
      );
    }
    return {
      equivalent: false,
      stage: 'SIGNATURE_MISMATCH',
      templates,
      fingerprints: emptyFingerprints,
      witness: null,
      interpretation_witness: interp,
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
      notes,
    };
  }

  // Stage 4 — translation witness. The only thing that can conclude equivalence.
  const witness = findWitness(a, b);
  if (!witness) {
    notes.push(
      'Fingerprints agree but no two-way translation was constructed. Similarity is not equivalence.',
    );
    const interp = options.interpretation ? findInterpretationWitness(a, b) : null;
    if (interp && interp.forward_verified && interp.backward_verified) {
      notes.push('No name bijection, but a two-way interpretation witness verified.');
      return {
        equivalent: true,
        stage: 'INTERPRETATION_WITNESS_VERIFIED',
        templates,
        fingerprints,
        witness: null,
        interpretation_witness: interp,
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
    notes,
  };
}
