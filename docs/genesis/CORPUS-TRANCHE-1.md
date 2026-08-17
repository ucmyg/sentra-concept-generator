# Corpus Tranche 1 — Proposal

Status: PROPOSED. Nothing here is built. Charter §11 reduction targets.

---

## The diagnosis this tranche is answering

The current corpus is 15 targets, and **thirteen of them have exactly one
binary operation.** Every multi-operation target is either a unary paired with
a binary (relation converse, involution) or an action.

That is the real reason "not being a monoid" works as a survival strategy. A
candidate proposing **two binary operations that interact** — distributing,
absorbing, annihilating — has nothing in the room to embed into. It earns
`NO_EMBEDDING_FOUND` by proposing a shape the corpus cannot express, not by
being new.

So this tranche is not "more algebras." It is specifically:

1. **Two-operation interaction** — absorption, distribution, annihilation.
2. **Order structure**, which nothing currently attacks at all.
3. **Iteration/closure**, which is where automata and programs actually live.
4. **Partial invertibility**, the gap between "has inverses" and "is a group."

Each target below states the re-skin it catches **that nothing current
catches**. If I could not name one, it is not on the list.

---

## The tranche

| # | Target | Family | Re-skin it catches that nothing current does |
|---|--------|--------|----------------------------------------------|
| 1 | `template:lattice` | order/lattice | Two binary ops that **absorb** each other (`x∧(x∨y)=x`). No current target has absorption, so any candidate with a meet/join pair escapes today. |
| 2 | `template:bounded-lattice` | order/lattice | A candidate introducing a "nothing" and an "everything" constant with correct inertness and annihilation — currently reads as two unrelated units. |
| 3 | `template:distributive-lattice` | sets | Distribution of one binary over another. Closes half the gap the `sets` rationale names out loud. |
| 4 | `template:boolean-algebra-core` | sets | **Complement.** The exact gap `REDUCTION_TARGET_COVERAGE` declares open: an involutive negation interacting with meet and join is Boolean and does not know it. |
| 5 | `template:semiring` | ring-like | "Addition and multiplication" in any disguise. **Nothing in the corpus catches this at all today** — the single largest hole. |
| 6 | `template:tropical-semiring` | ring-like / graphs-by-proxy | Shortest-path and reachability re-skins. This is how graph structure gets attacked **without** expressing graphs: reachability *is* an idempotent semiring. Partially answers a family currently marked `NOT_EXPRESSIBLE`. |
| 7 | `template:inverse-semigroup` | group-like | **Partial** invertibility. A candidate with a pseudo-inverse (`x·x⁻¹·x = x`) is not a group, so `template:group` misses it, and it escapes. |
| 8 | `template:transition-with-reset` | state-transition | A reset/abort that annihilates prior state. `sequential-with-abort` covers abort; nothing covers **reset composed with continued transition**. |
| 9 | `template:near-semiring` | ring-like | One-sided distribution. Catches candidates that distribute left but not right — a very common accidental re-skin that a full semiring target would *miss*. |
| 10 | `template:idempotent-monoid-action` | state-transition | An action where repeated application saturates. Catches "apply until stable" re-skins. |

Ten targets, six families touched, and the two families that were entirely
unattacked (order/lattice, ring-like) get four and three targets respectively.

**Projected ceiling effect.** Currently 2 fully covered + 4 partial = 4
effective families → ceiling 3. If this tranche moves order/lattice and
ring-like to fully covered and sets from partial to full, that is 5 full + 3
partial = 6.5 effective → **ceiling 5**. Stated as a projection to be checked,
not a target to hit. If the targets land and the ceiling does not move, the
ceiling is right and the projection was wrong.

---

## Executability risk — declared before building, not discovered after

The kernel executes **oriented, terminating** equational theories. Three of
these are at risk, and I would rather say so now than quietly ship a target
that cannot run:

- **#4 Boolean algebra.** Distribution plus complement plus absorption is a
  large critical-pair surface. Confluence within bound is not guaranteed. If it
  fails, the honest move is to ship the **De Morgan fragment** and declare the
  remainder open in the coverage table, not to weaken the confluence check.
- **#5/#6 semirings.** Distribution `x·(y+z) → x·y + x·z` terminates, but
  combined with associativity it may exceed the critical-pair bound. Same
  fallback: ship the fragment, declare the rest.
- **Kleene star was considered and is NOT in this tranche.** `x* = 1 + x·x*`
  is not orientable as a terminating rewrite — it unfolds forever. Iteration is
  the honest gap in the automata family, and putting a fake star target in
  would be exactly the "empty room" problem in reverse: a target that cannot
  execute cannot kill anything, but it inflates the coverage count. It stays
  out, and the coverage table says why.

---

## Rules of engagement for the build

Each target ships as a **triple**, per the order:

1. Formal definition in the target schema.
2. A genuine re-skin fixture that **MUST die** to it.
3. A genuinely distinct fixture that **MUST survive** it.

The witness gate applies unchanged. A new target is a **new opportunity for a
degenerate match** — a two-operation target gives the interpretation search
more room to find a vacuous mapping, not less. So `W1_NON_COLLAPSING` and
`W2_NON_TAUTOLOGICAL` get exercised per target, both directions, as part of
the triple.

After the tranche lands: re-screen the survivors through the real entrypoint.
Deaths are ledger appends citing the new target. Survivals raise the computed
ceiling and nothing else. Before/after reported as observation — no target
survival rate, no quota.
