import { canonicalRule } from './equivalence.ts';
import { isVar, termDepth, termKey } from './kernel.ts';
import type { Foundation, OpSpec, Rule, Term } from './types.ts';

/* ------------------------------------------------------------------ *
 * Enumerative proposal.                                               *
 *                                                                     *
 * Until now the Foundry had a strong referee and no player: nine      *
 * hand-written concepts fed through a real gauntlet. Nothing ever     *
 * died, which said more about the smallness of the hand-written set   *
 * than about the gauntlet.                                            *
 *                                                                     *
 * This enumerates the candidate space instead of curating it. It      *
 * knows nothing about which rules are interesting. That is the point: *
 * a proposer that only proposes good concepts is just a table with    *
 * extra steps, and the whole design rests on the checker being what   *
 * decides, not the proposer.                                          *
 * ------------------------------------------------------------------ */

const VARS = ['x', 'y'] as const;

export interface EnumerationBound {
  /** Maximum term depth on either side of a rule. */
  maxDepth: number;
  /** Maximum distinct variables a rule may mention. */
  maxVars: number;
  /** Hard cap on candidate rules produced, so this always terminates. */
  maxCandidates: number;
}

export const DEFAULT_ENUMERATION_BOUND: EnumerationBound = {
  maxDepth: 2,
  maxVars: 2,
  maxCandidates: 20_000,
};

/**
 * All terms over a signature up to a depth bound, deduplicated by canonical
 * key. Enumeration order is deterministic — no clock, no randomness — so a
 * given signature and bound always produce the same candidate stream.
 */
export function enumerateTerms(
  operations: readonly OpSpec[],
  constants: readonly string[],
  bound: { maxDepth: number; maxVars: number },
): Term[] {
  const vars = VARS.slice(0, Math.max(0, bound.maxVars));
  const byDepth: Term[][] = [];
  byDepth[0] = [
    ...vars.map((v) => ({ v }) as Term),
    ...constants.map((c) => ({ c }) as Term),
  ];

  for (let d = 1; d <= bound.maxDepth; d += 1) {
    const shallower = byDepth.slice(0, d).flat();
    const level: Term[] = [];
    const seen = new Set<string>();
    for (const op of operations) {
      // Cartesian product of arguments drawn from strictly shallower terms.
      let combos: Term[][] = [[]];
      for (let a = 0; a < op.arity; a += 1) {
        const next: Term[][] = [];
        for (const combo of combos) {
          for (const arg of shallower) next.push([...combo, arg]);
        }
        combos = next;
      }
      for (const args of combos) {
        const term: Term = { op: op.name, args };
        // Keep only terms that actually reach this depth; shallower ones
        // were already emitted at their own level.
        if (termDepth(term) !== d) continue;
        const key = termKey(term);
        if (seen.has(key)) continue;
        seen.add(key);
        level.push(term);
      }
    }
    byDepth[d] = level;
  }
  return byDepth.flat();
}

function varsOf(t: Term, into: Set<string> = new Set()): Set<string> {
  if (isVar(t)) into.add(t.v);
  else if ('args' in t && Array.isArray((t as { args: Term[] }).args)) {
    for (const a of (t as { args: Term[] }).args) varsOf(a, into);
  }
  return into;
}

function mentionsOp(t: Term, name: string): boolean {
  if (!('op' in t)) return false;
  const app = t as { op: string; args: Term[] };
  return app.op === name || app.args.some((a) => mentionsOp(a, name));
}

export interface RuleCandidate {
  rule: Rule;
  /** The operation this candidate is defining behavior for. */
  newOperation: OpSpec;
}

/**
 * Candidate rules that define a NEW operation over a parent's signature.
 *
 * Well-formedness is enforced here rather than downstream, because these are
 * the conditions under which a rewrite rule is a rule at all:
 *   - the left side is not a bare variable (it would rewrite everything),
 *   - every variable on the right also occurs on the left (no invention),
 *   - the two sides differ (a rule to nowhere is not a rule),
 *   - the left side mentions the new operation (otherwise the candidate is a
 *     claim about the parent, and the parent is not what we are proposing).
 */
export function enumerateRuleCandidates(
  parent: Foundation,
  newOp: OpSpec,
  bound: EnumerationBound = DEFAULT_ENUMERATION_BOUND,
): RuleCandidate[] {
  const isFresh = !parent.operations.some((o) => o.name === newOp.name);
  const signature = isFresh ? [...parent.operations, newOp] : [...parent.operations];
  const terms = enumerateTerms(signature, parent.constants, bound);
  const parentShapes = new Set(parent.rules.map((r) => canonicalRule(r)));

  const lhsPool = terms.filter((t) => !isVar(t) && mentionsOp(t, newOp.name));
  const out: RuleCandidate[] = [];
  const seen = new Set<string>();

  for (const lhs of lhsPool) {
    const lhsVars = varsOf(lhs);
    for (const rhs of terms) {
      if (termKey(lhs) === termKey(rhs)) continue;
      const rhsVars = varsOf(rhs);
      let contained = true;
      for (const v of rhsVars) {
        if (!lhsVars.has(v)) {
          contained = false;
          break;
        }
      }
      if (!contained) continue;

      const id = `enum-${out.length}`;
      const rule: Rule = { id, lhs, rhs };
      const shape = canonicalRule(rule);
      if (parentShapes.has(shape)) continue; // already true of the parent
      if (seen.has(shape)) continue;
      seen.add(shape);

      out.push({ rule, newOperation: newOp });
      if (out.length >= bound.maxCandidates) return out;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Deterministic sampling.                                             *
 *                                                                     *
 * The candidate space is far larger than any run can check, so runs   *
 * sample it. Sampling is seeded and reproducible: a run that finds    *
 * something must be re-runnable by anyone with the seed, or the find  *
 * is an anecdote.                                                     *
 * ------------------------------------------------------------------ */

/** xmur3 string hash — seeds the PRNG from a human-readable string. */
function seedFrom(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — small, fast, fully determined by its seed. */
export function seededRandom(seed: string): () => number {
  let a = seedFrom(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded stream. Does not mutate the input. */
export function seededSample<T>(items: readonly T[], count: number, seed: string): T[] {
  const rand = seededRandom(seed);
  const pool = items.slice();
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

/** Operation names a proposer may introduce. Names carry no meaning here. */
export const CANDIDATE_OPERATIONS: OpSpec[] = [
  { name: 'gen_u', arity: 1 },
  { name: 'gen_b', arity: 2 },
];

/**
 * Candidates that constrain an operation the parent ALREADY has.
 *
 * These are the ones that can actually break something. A rule introducing a
 * fresh operation is nearly always consistent, because a brand-new symbol has
 * nothing to disagree with — which is why a first screening run over fresh
 * operations alone reported zero contradictions and zero non-confluence, and
 * looked like a clean sweep rather than an untested gate.
 *
 * Constraining an existing operation puts the candidate in direct competition
 * with the parent's own rules over the same terms. That is where a critical
 * pair can fail to join, and where two declared-distinct constants can meet.
 */
export function existingOperationsOf(parent: Foundation): OpSpec[] {
  return parent.operations.map((o) => ({ ...o }));
}
