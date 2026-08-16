import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildGenesisRecord,
  criticalSeeds,
  findContradiction,
  seedFoundations,
} from '../../src/foundry/index.ts';
import { ConceptRegistry } from '../../src/foundry/registry.ts';
import type { Foundation, Rule, Term } from '../../src/foundry/types.ts';

import { minimalGenesisInput } from './helpers.ts';

const C = (n: string): Term => ({ c: n });
const O = (n: string, ...args: Term[]): Term => ({ op: n, args });

/* ------------------------------------------------------------------ *
 * The contradiction search is only a test if it can fail.             *
 *                                                                     *
 * The first run reported zero kills across nine concepts, which read  *
 * like consistency and was actually a vacuous search: no foundation   *
 * declared a distinctness assertion, so nothing could ever be found.  *
 * These tests inject a real contradiction into each shipped           *
 * foundation and require the search to catch it.                      *
 * ------------------------------------------------------------------ */

test('every shipped foundation declares at least one distinctness assertion', () => {
  for (const f of seedFoundations()) {
    assert.ok(
      f.distinct.length > 0,
      `${f.id} declares no distinct pair — its contradiction search cannot report anything`,
    );
    for (const [a, b] of f.distinct) {
      assert.ok(f.constants.includes(a), `${f.id}: distinct constant ${a} is not in the signature`);
      assert.ok(f.constants.includes(b), `${f.id}: distinct constant ${b} is not in the signature`);
    }
  }
});

/** One mutant rule per foundation, each colliding with an existing rule. */
const MUTANTS: Record<string, Rule> = {
  // join(void, void) already reduces to void via f1-void-left.
  'F1-distinction': {
    id: 'mutant-f1',
    lhs: O('join', C('void'), C('void')),
    rhs: C('unit'),
  },
  // meet(free, free) already reduces to free via f2-free-left.
  'F2-constraint': {
    id: 'mutant-f2',
    lhs: O('meet', C('free'), C('free')),
    rhs: C('blocked'),
  },
  // collapse(spread(sharp)) already reduces to sharp via f3-collapse-spread.
  'F3-uncertainty': {
    id: 'mutant-f3',
    lhs: O('collapse', O('spread', C('sharp'))),
    rhs: C('diffuse'),
  },
};

test('a contradiction injected into any shipped foundation is found, with both traces', () => {
  for (const base of seedFoundations()) {
    const mutant = MUTANTS[base.id];
    assert.ok(mutant, `no mutation defined for ${base.id}`);
    const infected: Foundation = {
      ...base,
      id: `${base.id}-MUTANT`,
      rules: [...base.rules, mutant!],
    };

    const search = findContradiction(infected, { maxDepth: 4, maxTerms: 200 });
    assert.equal(search.found, true, `${base.id}: injected contradiction was NOT found`);
    assert.ok(search.proof, `${base.id}: found a contradiction but recorded no proof`);

    const proof = search.proof!;
    assert.ok(proof.left.steps.length > 0, `${base.id}: empty left trace`);
    assert.ok(proof.right.steps.length > 0, `${base.id}: empty right trace`);

    const pair = [...proof.distinct_pair].sort();
    const declared = base.distinct.map((d) => [...d].sort());
    assert.ok(
      declared.some((d) => d[0] === pair[0] && d[1] === pair[1]),
      `${base.id}: proof cites ${JSON.stringify(proof.distinct_pair)}, not a declared distinct pair`,
    );

    // And the artifact dies, keeps its cause of death, and stays in the ledger.
    const registry = new ConceptRegistry();
    const record = buildGenesisRecord(
      minimalGenesisInput(`${base.id}-mutant-record`, {
        foundation: infected,
        contradiction: search,
        axioms: infected.rules.map((r) => ({
          id: `ax-${r.id}`,
          statement: `Assume, as a stipulation of this system, that ${r.id} rewrites left to right.`,
          kind: 'ASSUMPTION_OF_SYSTEM' as const,
          rule: r,
        })),
      }),
    );
    assert.equal(record.status.formal, 'CONTRADICTORY');
    assert.ok(record.status.cause_of_death);
    registry.append(record);
    assert.equal(registry.dead().length, 1);
    assert.equal(registry.size(), 1, 'a dead concept must not be removed');
  }
});

test('the clean shipped foundations survive the same search', () => {
  for (const f of seedFoundations()) {
    const search = findContradiction(f, { maxDepth: 4, maxTerms: 200 });
    assert.equal(search.found, false, `${f.id}: unexpected contradiction ${JSON.stringify(search.proof)}`);
    assert.ok(search.budget_spent > 0, `${f.id}: negative result recorded no work`);
  }
});

test('critical seeds cover every rule left-hand side', () => {
  for (const f of seedFoundations()) {
    const seeds = criticalSeeds(f);
    assert.ok(seeds.length >= f.rules.length, `${f.id}: fewer seeds than rules`);
    // Every seed is ground: no variables survive instantiation.
    const hasVar = (t: Term): boolean =>
      'v' in t ? true : 'op' in t ? t.args.some(hasVar) : false;
    for (const seed of seeds) {
      assert.equal(hasVar(seed), false, `${f.id}: critical seed is not ground`);
    }
  }
});
