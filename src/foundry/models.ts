import { sha256 } from '../canonical-json.ts';

import { isApp, isConst, isVar } from './kernel.ts';
import type { FiniteModel, Foundation, ModelAttempt, Term } from './types.ts';

/* ------------------------------------------------------------------ *
 * Satisfiability probe.                                               *
 *                                                                     *
 * Search small finite models for a proposed axiom set. No model found *
 * inside the bound is FLAGGED, not refuted — the bound is recorded so *
 * nobody reads a budget exhaustion as an impossibility proof.         *
 * ------------------------------------------------------------------ */

function evalTerm(
  t: Term,
  model: FiniteModel,
  env: Record<string, number>,
): number | null {
  if (isVar(t)) return env[t.v] ?? null;
  if (isConst(t)) return model.constants[t.c] ?? null;
  if (!isApp(t)) return null;
  const table = model.operations[t.op];
  if (!table) return null;
  const args: number[] = [];
  for (const a of t.args) {
    const value = evalTerm(a, model, env);
    if (value === null) return null;
    args.push(value);
  }
  let index = 0;
  for (const a of args) index = index * model.size + a;
  return table[index] ?? null;
}

function varsOf(t: Term, acc: Set<string> = new Set()): Set<string> {
  if (isVar(t)) acc.add(t.v);
  else if (isApp(t)) t.args.forEach((a) => varsOf(a, acc));
  return acc;
}

export function modelSatisfies(foundation: Foundation, model: FiniteModel): boolean {
  for (const rule of foundation.rules) {
    const vars = [...varsOf(rule.lhs, varsOf(rule.rhs))];
    const total = model.size ** vars.length;
    for (let n = 0; n < total; n += 1) {
      const env: Record<string, number> = {};
      let rest = n;
      for (const v of vars) {
        env[v] = rest % model.size;
        rest = Math.floor(rest / model.size);
      }
      const left = evalTerm(rule.lhs, model, env);
      const right = evalTerm(rule.rhs, model, env);
      if (left === null || right === null || left !== right) return false;
    }
  }
  for (const [a, b] of foundation.distinct) {
    if (model.constants[a] === model.constants[b]) return false;
  }
  return true;
}

export interface ModelSearchBudget {
  maxSize: number;
  maxAssignments: number;
}

export function findModel(
  foundation: Foundation,
  budget: ModelSearchBudget = { maxSize: 3, maxAssignments: 250_000 },
): ModelAttempt {
  const sizesTried: number[] = [];
  let spent = 0;

  for (let size = 1; size <= budget.maxSize; size += 1) {
    sizesTried.push(size);
    const constants = foundation.constants;
    const ops = foundation.operations;
    const constantSpace = size ** constants.length;
    const opCells = ops.map((o) => size ** o.arity);
    const opSpace = opCells.reduce((acc, cells) => acc * size ** cells, 1);
    const total = constantSpace * opSpace;
    if (!Number.isFinite(total) || total > budget.maxAssignments) {
      // Too large to enumerate honestly at this size. Say so rather than
      // silently truncating and calling the result "no model".
      return {
        foundation_id: foundation.id,
        sizes_tried: sizesTried,
        found: false,
        model: null,
        exhausted: false,
        budget_spent: spent,
        note: `SEARCH_SPACE_EXCEEDS_BUDGET at size ${size} (${total} assignments > ${budget.maxAssignments}). Flagged, not refuted.`,
      };
    }

    for (let assignment = 0; assignment < total; assignment += 1) {
      spent += 1;
      let rest = assignment;
      const constantMap: Record<string, number> = {};
      for (const c of constants) {
        constantMap[c] = rest % size;
        rest = Math.floor(rest / size);
      }
      const operationMap: Record<string, number[]> = {};
      for (let i = 0; i < ops.length; i += 1) {
        const cells = opCells[i]!;
        const table: number[] = [];
        for (let cell = 0; cell < cells; cell += 1) {
          table.push(rest % size);
          rest = Math.floor(rest / size);
        }
        operationMap[ops[i]!.name] = table;
      }
      const model: FiniteModel = { size, constants: constantMap, operations: operationMap };
      if (modelSatisfies(foundation, model)) {
        return {
          foundation_id: foundation.id,
          sizes_tried: sizesTried,
          found: true,
          model,
          exhausted: false,
          budget_spent: spent,
          note: `Model found at size ${size}. Consistency is established only within this bound.`,
        };
      }
    }
  }

  return {
    foundation_id: foundation.id,
    sizes_tried: sizesTried,
    found: false,
    model: null,
    exhausted: true,
    budget_spent: spent,
    note: `No model up to size ${budget.maxSize}. FLAGGED — this is a bounded search, not an inconsistency proof.`,
  };
}

/** All models up to a size bound, reduced to a canonical fingerprint. */
export function modelFingerprint(foundation: Foundation, maxSize: number): string {
  const counts: number[] = [];
  for (let size = 1; size <= maxSize; size += 1) {
    const attempt = countModels(foundation, size);
    counts.push(attempt);
  }
  return sha256(counts.join(','));
}

export function countModels(foundation: Foundation, size: number, cap = 200_000): number {
  const constants = foundation.constants;
  const ops = foundation.operations;
  const opCells = ops.map((o) => size ** o.arity);
  const total = size ** constants.length * opCells.reduce((acc, cells) => acc * size ** cells, 1);
  if (!Number.isFinite(total) || total > cap) return -1;
  let found = 0;
  for (let assignment = 0; assignment < total; assignment += 1) {
    let rest = assignment;
    const constantMap: Record<string, number> = {};
    for (const c of constants) {
      constantMap[c] = rest % size;
      rest = Math.floor(rest / size);
    }
    const operationMap: Record<string, number[]> = {};
    for (let i = 0; i < ops.length; i += 1) {
      const table: number[] = [];
      for (let cell = 0; cell < opCells[i]!; cell += 1) {
        table.push(rest % size);
        rest = Math.floor(rest / size);
      }
      operationMap[ops[i]!.name] = table;
    }
    if (modelSatisfies(foundation, { size, constants: constantMap, operations: operationMap })) {
      found += 1;
    }
  }
  return found;
}
