import { stableStringify } from '../canonical-json.ts';

import type { Foundation, ReplayResult, Rule, Term, Trace } from './types.ts';

/* ------------------------------------------------------------------ *
 * The trusted kernel.                                                 *
 *                                                                     *
 * Small on purpose. Everything the Foundry claims to have derived is  *
 * replayed here, step by step, and compared byte-for-byte against the *
 * recorded result. A trace this cannot replay is not a trace.         *
 * ------------------------------------------------------------------ */

export const isVar = (t: Term): t is { v: string } =>
  typeof (t as { v?: unknown }).v === 'string';
export const isConst = (t: Term): t is { c: string } =>
  typeof (t as { c?: unknown }).c === 'string';
export const isApp = (t: Term): t is { op: string; args: Term[] } =>
  typeof (t as { op?: unknown }).op === 'string';

export const termKey = (t: Term): string => stableStringify(t);
export const termEq = (a: Term, b: Term): boolean => termKey(a) === termKey(b);

export function termSize(t: Term): number {
  if (isApp(t)) return 1 + t.args.reduce((n, a) => n + termSize(a), 0);
  return 1;
}

export function termDepth(t: Term): number {
  if (isApp(t)) return 1 + Math.max(0, ...t.args.map(termDepth));
  return 1;
}

/** Structural match of a pattern (which may contain variables) against a term. */
export function match(
  pattern: Term,
  term: Term,
  acc: Record<string, Term> = {},
): Record<string, Term> | null {
  if (isVar(pattern)) {
    const bound = acc[pattern.v];
    if (bound === undefined) return { ...acc, [pattern.v]: term };
    return termEq(bound, term) ? acc : null;
  }
  if (isConst(pattern)) return isConst(term) && term.c === pattern.c ? acc : null;
  if (!isApp(term)) return null;
  if (term.op !== pattern.op) return null;
  if (term.args.length !== pattern.args.length) return null;
  let current: Record<string, Term> | null = acc;
  for (let i = 0; i < pattern.args.length; i += 1) {
    current = match(pattern.args[i]!, term.args[i]!, current!);
    if (current === null) return null;
  }
  return current;
}

export function substitute(t: Term, s: Record<string, Term>): Term {
  if (isVar(t)) return s[t.v] ?? t;
  if (isConst(t)) return t;
  return { op: t.op, args: t.args.map((a) => substitute(a, s)) };
}

function occursIn(varName: string, t: Term): boolean {
  if (isVar(t)) return t.v === varName;
  if (isConst(t)) return false;
  return t.args.some((a) => occursIn(varName, a));
}

/** Bind `varName` to `term` in `subst`, resolving the new binding through every
 *  existing entry so the returned substitution stays fully self-resolved
 *  (no key's value ever mentions another key). */
function bind(
  varName: string,
  term: Term,
  subst: Record<string, Term>,
): Record<string, Term> {
  const patch = { [varName]: term };
  const updated: Record<string, Term> = {};
  for (const [k, v] of Object.entries(subst)) updated[k] = substitute(v, patch);
  updated[varName] = term;
  return updated;
}

/**
 * First-order syntactic unification (Robinson). Unlike `match`, both sides
 * may contain variables that get bound — this is what finding a critical
 * pair between two rule left-hand-sides needs, and `match` cannot do it
 * (it only ever binds variables on the pattern side against a ground term).
 *
 * Occurs-checked, so `unify(v('x'), op('f', v('x')))` correctly fails rather
 * than building an infinite term. Returns a substitution that is fully
 * self-resolved: applying it once with `substitute` is enough, no chasing.
 */
export function unify(
  a: Term,
  b: Term,
  subst: Record<string, Term> = {},
): Record<string, Term> | null {
  const ra = substitute(a, subst);
  const rb = substitute(b, subst);

  if (isVar(ra) && isVar(rb) && ra.v === rb.v) return subst;
  if (isVar(ra)) return occursIn(ra.v, rb) ? null : bind(ra.v, rb, subst);
  if (isVar(rb)) return occursIn(rb.v, ra) ? null : bind(rb.v, ra, subst);
  if (isConst(ra) && isConst(rb)) return ra.c === rb.c ? subst : null;
  if (isApp(ra) && isApp(rb)) {
    if (ra.op !== rb.op || ra.args.length !== rb.args.length) return null;
    let current: Record<string, Term> | null = subst;
    for (let i = 0; i < ra.args.length; i += 1) {
      current = unify(ra.args[i]!, rb.args[i]!, current!);
      if (current === null) return null;
    }
    return current;
  }
  return null;
}

/** Rename every variable in `t` by appending `suffix`, so unifying two rules'
 *  terms doesn't accidentally capture a variable they happen to share a name
 *  with (e.g. both rules use `x`). */
export function renameApart(t: Term, suffix: string): Term {
  if (isVar(t)) return { v: `${t.v}${suffix}` };
  if (isConst(t)) return t;
  return { op: t.op, args: t.args.map((a) => renameApart(a, suffix)) };
}

export function subtermAt(t: Term, path: readonly number[]): Term | null {
  let current: Term = t;
  for (const index of path) {
    if (!isApp(current)) return null;
    const next = current.args[index];
    if (next === undefined) return null;
    current = next;
  }
  return current;
}

export function replaceAt(
  t: Term,
  path: readonly number[],
  replacement: Term,
): Term | null {
  if (path.length === 0) return replacement;
  if (!isApp(t)) return null;
  const [head, ...rest] = path;
  const target = t.args[head!];
  if (target === undefined) return null;
  const rebuilt = replaceAt(target, rest, replacement);
  if (rebuilt === null) return null;
  const args = t.args.slice();
  args[head!] = rebuilt;
  return { op: t.op, args };
}

/* ------------------------------------------------------------------ *
 * Matching modulo a declared equational theory.                       *
 *                                                                     *
 * Oriented rewriting cannot express commutativity. Written left to    *
 * right, x·y -> y·x rewrites forever; written the other way, the same.*
 * So a commutative operation is not given a rule at all — it is       *
 * declared in the theory, and the matcher tries the equivalent        *
 * argument orders itself.                                             *
 *                                                                     *
 * With an empty theory every function below is exactly the oriented   *
 * behavior it replaces. Nothing changes for a foundation that does    *
 * not declare one.                                                    *
 * ------------------------------------------------------------------ */

export function commutativeOps(foundation: Foundation): ReadonlySet<string> {
  return new Set(foundation.theory?.commutative ?? []);
}

const EMPTY_THEORY: ReadonlySet<string> = new Set<string>();

/**
 * Canonical form modulo commutativity: arguments of a commutative operation
 * are sorted, so two terms equal under the theory serialize identically.
 */
export function canonicalModulo(t: Term, comm: ReadonlySet<string> = EMPTY_THEORY): Term {
  if (!isApp(t)) return t;
  const args = t.args.map((a) => canonicalModulo(a, comm));
  if (comm.has(t.op) && args.length === 2) {
    const [x, y] = args as [Term, Term];
    return termKey(x) <= termKey(y) ? { op: t.op, args: [x, y] } : { op: t.op, args: [y, x] };
  }
  return { op: t.op, args };
}

/** Equality modulo the declared theory. */
export function termEqModulo(
  a: Term,
  b: Term,
  comm: ReadonlySet<string> = EMPTY_THEORY,
): boolean {
  if (comm.size === 0) return termEq(a, b);
  return termKey(canonicalModulo(a, comm)) === termKey(canonicalModulo(b, comm));
}

/**
 * Structural match modulo commutativity. For a declared-commutative binary
 * operation both argument orders are attempted; the first consistent
 * substitution wins.
 */
export function matchModulo(
  pattern: Term,
  term: Term,
  comm: ReadonlySet<string> = EMPTY_THEORY,
  acc: Record<string, Term> = {},
): Record<string, Term> | null {
  if (comm.size === 0) return match(pattern, term, acc);
  if (isVar(pattern)) {
    const bound = acc[pattern.v];
    if (bound === undefined) return { ...acc, [pattern.v]: term };
    return termEqModulo(bound, term, comm) ? acc : null;
  }
  if (isConst(pattern)) return isConst(term) && term.c === pattern.c ? acc : null;
  if (!isApp(pattern) || !isApp(term)) return null;
  if (term.op !== pattern.op) return null;
  if (term.args.length !== pattern.args.length) return null;

  const orders: number[][] =
    comm.has(pattern.op) && pattern.args.length === 2 ? [[0, 1], [1, 0]] : [[0, 1, 2, 3, 4, 5, 6, 7]];

  for (const order of orders) {
    let current: Record<string, Term> | null = acc;
    let ok = true;
    for (let i = 0; i < pattern.args.length; i += 1) {
      const j = order[i] ?? i;
      current = matchModulo(pattern.args[i]!, term.args[j]!, comm, current!);
      if (current === null) {
        ok = false;
        break;
      }
    }
    if (ok && current !== null) return current;
  }
  return null;
}

/**
 * Apply one rule at one position. Returns null when the rule does not fire
 * there. `comm` carries the declared commutative operations; omitted, this is
 * exactly the oriented behavior.
 */
export function applyRuleAt(
  rule: Rule,
  term: Term,
  path: readonly number[],
  comm: ReadonlySet<string> = EMPTY_THEORY,
): Term | null {
  const target = subtermAt(term, path);
  if (target === null) return null;
  const s = comm.size === 0 ? match(rule.lhs, target) : matchModulo(rule.lhs, target, comm);
  if (s === null) return null;
  return replaceAt(term, path, substitute(rule.rhs, s));
}

/** Every position in a term, outermost first. */
export function positions(t: Term, prefix: number[] = []): number[][] {
  const out: number[][] = [prefix];
  if (isApp(t)) {
    t.args.forEach((a, i) => {
      out.push(...positions(a, [...prefix, i]));
    });
  }
  return out;
}

export function rulesOf(foundation: Foundation): Map<string, Rule> {
  const map = new Map<string, Rule>();
  for (const rule of foundation.rules) map.set(rule.id, rule);
  return map;
}

/**
 * Deterministic replay. Each step names a rule and a position; the kernel
 * applies it and requires the produced term to equal the recorded one.
 */
export function replayTrace(foundation: Foundation, trace: Trace | null | undefined): ReplayResult {
  if (!trace || typeof trace !== 'object' || !trace.start || !Array.isArray(trace.steps)) {
    return { ok: false, final: null, reason: 'MALFORMED_TRACE', steps_replayed: 0, max_term_size: 0 };
  }
  const rules = rulesOf(foundation);
  const comm = commutativeOps(foundation);
  let current: Term = trace.start;
  let maxSize = termSize(current);
  let replayed = 0;
  for (const step of trace.steps) {
    const rule = rules.get(step.rule);
    if (!rule) {
      return {
        ok: false,
        final: null,
        reason: `UNKNOWN_RULE:${step.rule}`,
        steps_replayed: replayed,
        max_term_size: maxSize,
      };
    }
    const produced = applyRuleAt(rule, current, step.path ?? [], comm);
    if (produced === null) {
      return {
        ok: false,
        final: null,
        reason: `RULE_DID_NOT_FIRE:${step.rule}@${(step.path ?? []).join('.')}`,
        steps_replayed: replayed,
        max_term_size: maxSize,
      };
    }
    if (!termEqModulo(produced, step.result, comm)) {
      return {
        ok: false,
        final: null,
        reason: `STEP_RESULT_MISMATCH:${step.rule}@${(step.path ?? []).join('.')}`,
        steps_replayed: replayed,
        max_term_size: maxSize,
      };
    }
    current = produced;
    maxSize = Math.max(maxSize, termSize(current));
    replayed += 1;
  }
  return { ok: true, final: current, reason: null, steps_replayed: replayed, max_term_size: maxSize };
}

/* ------------------------------------------------------------------ *
 * Termination probe.                                                  *
 *                                                                     *
 * The kernel replays traces someone else built; it never claims a     *
 * rule set terminates in general (that is undecidable). What it can   *
 * do honestly is attempt leftmost-outermost normalization of a given  *
 * start term under a hard step and size budget, and report which of   *
 * three things actually happened. A bound exhaustion is reported as   *
 * exactly that — never silently treated as a normal form.             *
 * ------------------------------------------------------------------ */

export type TerminationStatus =
  | 'TERMINATED'
  | 'NON_TERMINATING_WITHIN_BOUND'
  | 'SIZE_EXCEEDED';

export interface TerminationProbeResult {
  status: TerminationStatus;
  final: Term | null;
  steps_taken: number;
  max_term_size: number;
}

/** First position (leftmost-outermost, pre-order) where some rule fires. */
function firstRedex(
  rules: Rule[],
  term: Term,
  comm: ReadonlySet<string> = EMPTY_THEORY,
): { rule: Rule; path: number[] } | null {
  for (const path of positions(term)) {
    const target = subtermAt(term, path);
    if (target === null) continue;
    for (const rule of rules) {
      const fired =
        comm.size === 0 ? match(rule.lhs, target) : matchModulo(rule.lhs, target, comm);
      if (fired !== null) return { rule, path };
    }
  }
  return null;
}

/**
 * Attempt to normalize `start` under `foundation`'s rules, leftmost-outermost,
 * up to `maxSteps` rewrites or `maxSize` term size — whichever is hit first.
 *
 * This is a probe, not a proof. TERMINATED means a normal form was reached
 * within budget; it says nothing about other reduction orders. It exists so
 * a foundation that visibly blows up (the common failure mode of a badly
 * oriented axiom) is caught and reported, instead of silently trusted.
 */
export function terminationProbe(
  foundation: Foundation,
  start: Term,
  opts: { maxSteps?: number; maxSize?: number } = {},
): TerminationProbeResult {
  const maxSteps = opts.maxSteps ?? 500;
  const maxSize = opts.maxSize ?? 2000;
  let current = start;
  let maxSizeSeen = termSize(current);
  for (let step = 0; step < maxSteps; step += 1) {
    const redex = firstRedex(foundation.rules, current, commutativeOps(foundation));
    if (redex === null) {
      return {
        status: 'TERMINATED',
        final: current,
        steps_taken: step,
        max_term_size: maxSizeSeen,
      };
    }
    const produced = applyRuleAt(redex.rule, current, redex.path, commutativeOps(foundation));
    if (produced === null) {
      // The reported redex must fire; a null here means firstRedex and
      // applyRuleAt disagree, which is a kernel bug, not a foundation defect.
      throw new Error('terminationProbe: redex reported by firstRedex did not fire');
    }
    current = produced;
    const size = termSize(current);
    maxSizeSeen = Math.max(maxSizeSeen, size);
    if (size > maxSize) {
      return {
        status: 'SIZE_EXCEEDED',
        final: null,
        steps_taken: step + 1,
        max_term_size: maxSizeSeen,
      };
    }
  }
  return {
    status: 'NON_TERMINATING_WITHIN_BOUND',
    final: null,
    steps_taken: maxSteps,
    max_term_size: maxSizeSeen,
  };
}

/** Build a trace by actually running the rules — the only sanctioned way to make one. */
export function derive(
  foundation: Foundation,
  start: Term,
  plan: Array<{ rule: string; path: number[] }>,
): Trace | null {
  const rules = rulesOf(foundation);
  let current = start;
  const steps = [];
  for (const step of plan) {
    const rule = rules.get(step.rule);
    if (!rule) return null;
    const produced = applyRuleAt(rule, current, step.path, commutativeOps(foundation));
    if (produced === null) return null;
    steps.push({ rule: step.rule, path: step.path, result: produced });
    current = produced;
  }
  return { start, steps };
}
