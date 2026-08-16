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

/** Apply one rule at one position. Returns null when the rule does not fire there. */
export function applyRuleAt(
  rule: Rule,
  term: Term,
  path: readonly number[],
): Term | null {
  const target = subtermAt(term, path);
  if (target === null) return null;
  const s = match(rule.lhs, target);
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
    const produced = applyRuleAt(rule, current, step.path ?? []);
    if (produced === null) {
      return {
        ok: false,
        final: null,
        reason: `RULE_DID_NOT_FIRE:${step.rule}@${(step.path ?? []).join('.')}`,
        steps_replayed: replayed,
        max_term_size: maxSize,
      };
    }
    if (!termEq(produced, step.result)) {
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
    const produced = applyRuleAt(rule, current, step.path);
    if (produced === null) return null;
    steps.push({ rule: step.rule, path: step.path, result: produced });
    current = produced;
  }
  return { start, steps };
}
