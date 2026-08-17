# M0 — GATE AUDIT

Project Genesis, Charter v2, Phase 0. Filed 2026-08-16.

Charter §21: *"Nothing else starts until this audit report exists."* This is that
report. Every statement below carries a label from §5.

Scope: `src/foundry/*` (the construction path) and `src/output-contract.ts` (the
evidence-gated path it must not weaken). Method: full read of the foundry tree,
`npm test`, and two instrumented screening runs whose numbers are quoted below.

---

## 1. Verdict

`EXPERIMENTAL_RESULT` — The epistemic boundary is **sound in the direction the
Charter cares most about**: nothing in the foundry can manufacture an external
factual claim, and the novelty ceiling cannot be climbed without a corpus that
does not yet exist. `status.ts` *computes* the novelty transition table so that
`NOVELTY_CONFIRMED` has no incoming edge at all while no corpus is attached.
That is stronger than a check; there is no path to bypass.

`EXPERIMENTAL_RESULT` — The boundary was **unsound in two places**, both now
closed and both quantified in §4. One was a gate that could never fire. One was
a lock that was written, hashed, and then never verified.

`CONSTRUCTED_DEFINITION` — The Charter's *law layer* (§3 level scale, §5
statement labels, §7 full novelty status set) was largely absent from the type
system. Partially added this cycle; the rest is listed in §5 as open.

---

## 2. Component inventory (Charter §9)

| # | Component | Status | Where |
|---|---|---|---|
| 9.1 | Concept Generator | PARTIAL | `generator.ts`, `enumerate.ts` |
| 9.2 | Formalizer | PARTIAL | `generator.ts:218`, `genesis.ts:127` |
| 9.3 | Model Constructor | PARTIAL | `models.ts` |
| 9.4 | Derivation Engine | EXISTS | `derive-search.ts`, `kernel.ts:420` |
| 9.5 | Counterexample Engine | PARTIAL | `contradiction.ts` |
| 9.6 | Equivalence Analyzer / Reduction Attack | PARTIAL | `equivalence.ts`, `interpretation.ts` |
| 9.7 | Novelty Analyzer | EXISTS (mechanism) / MISSING (corpus) | `status.ts`, `corpus.ts` |
| 9.8 | Benchmark Engine | EXISTS (as of this cycle) | `benchmark.ts` |
| 9.9 | Translation Engine | MISSING | — |
| 9.10 | Explanation Engine | EXISTS (thin) | `explain.ts` |
| 9.11 | Provenance Ledger | EXISTS (in-memory) | `registry.ts`, `genesis.ts` |
| 9.12 | Verifier Kernel | PARTIAL | `kernel.ts` |

Detail on the PARTIALs that matter:

**9.1 Generator.** `enumerateRuleCandidates` is a genuine constrained divergent
generator — exhaustive, deterministic, seeded. But `proposeConcept` only ever
*adds* to a parent (`generator.ts:243-253`). There is no assumption-removal
operator, which is Charter §12 Step 3 and §16's central move. Nothing in the
system can currently delete a load-bearing axiom and see what survives.

**9.3 Model Constructor.** Finite-first is implemented and exhaustive, but the
universe ceiling is 3 by default and clamped to **2** in the real run
(`run.ts:342`). Charter §9.3 asks for 2–7. The assignment space is
`size^constants × ∏ size^(size^arity)`, so 4+ returns
`SEARCH_SPACE_EXCEEDS_BUDGET` rather than searching. Honest, but not met.

**9.6 Reduction Attack.** The machinery is real and two-way (name bijections
catch renames; interpretation witnesses catch definitional re-skins). The
*target corpus is four items*: monoid, semigroup, involution, idempotent-unary.
Charter §11 names sets, relations, functions, graphs, algebraic structures,
automata, probability spaces, and programs. **We attack into an almost empty
room.** This is the single largest gap between the code and the Charter, because
every level-3-and-above claim depends on `NO_EMBEDDING_FOUND`, and that verdict
is currently cheap to earn.

**9.9 Translation Engine.** What exists is native↔native. There is no
machine-native↔conventional mapping and **no loss record of any kind** — no
`loss`, `lossy`, or `information_lost` field anywhere in the foundry. Charter
§9.9 and §11 both require the loss to be recorded; §11 calls it "the interesting
object."

**9.11 Ledger.** Append-only by construction, hash-chained, tamper-evident
(tests plant tampering and require the chain to break). But it is process-local:
`foundry/cli.ts:14` overwrites `registry.jsonl` per run, and nothing re-verifies
a loaded chain on read. There is no cross-run ledger yet.

**9.12 Kernel.** Replay is strict and correct. It is **not separately
versioned** — no kernel version constant exists — and it does not validate
artifact schemas; there is no schema for `GenesisRecord`. Charter §8 forbids the
generator certifying its own output; today they ship in one import graph.

---

## 3. Law-layer conformance (Charter §3, §5, §7)

- **Level scale 0–7** — was MISSING entirely. Added this cycle: `levels.ts`,
  with the default-down rule mechanized (§4).
- **Statement labels** — the eight labels of §5 were absent; only
  `EpistemicClass` (3 values) existed. `StatementLabel` is now declared in
  `levels.ts`; **it is not yet threaded through `GenesisRecord`**. Open.
- **Novelty statuses** — 4 of the 11 in §7 exist. `RENAMED_EXISTING_CONCEPT` and
  `NOVELTY_DISPROVEN` collapse into `EXISTING_EQUIVALENT_FOUND`;
  `ALTERNATIVE_NOTATION`, `ALTERNATIVE_REPRESENTATION`, `ALTERNATIVE_ALGORITHM`,
  `COMBINATION_OF_EXISTING_CONCEPTS`, `GENERALIZATION`, `NEW_CONNECTION` do not
  exist. The *ceiling* is enforced correctly; the *vocabulary* is coarse. Open.
- **Concept Record blocks A–F** — 5 of 6 present. **Block B (Origin) is the
  gap**: `intended_pattern` is computed and then never written to the record
  (`run.ts:479` folds it into free-text). No generation-method or seed field.
  Charter §13 says nothing ships with blank fields. Open.
- **Failed-concept archive** — cause-of-death is required on any `CONTRADICTORY`
  transition and dead records are retained. But **the screening gauntlet's
  deaths are never archived**: `runScreen` returns outcomes in memory and no
  caller writes them to the registry. 294 of 299 deaths per run are discarded at
  process exit. That is the bulk of our failure evidence. Open.
- **Silent-import auditing (§15)** — no auditor exists. Imports are explicit by
  construction (children copy parents), and the kernel refuses to replay a step
  naming an undeclared rule, but nothing cross-checks the prose `invariants`
  against the rule set. Open.

---

## 4. Two defects found, and what they cost

### D1 — The termination gate could never fire

`EXPERIMENTAL_RESULT`. `screen.ts:142` called
`terminationProbe(f, bounds.termination)` — but the second parameter is a *start
term*, not a bounds object. No rule can match an object literal, so `firstRedex`
returned null and the probe reported `TERMINATED` immediately, for every
candidate ever screened. The comparison on the next line tested for
`'NON_TERMINATING'`, which is not a member of `TerminationStatus`, and read
`term.note`, a field the result type does not have. Three compile errors in
three consecutive lines, invisible because there is no `tsc` step: Node strips
types without checking them.

Fixed: the probe now runs over ground instances of the rules' left-hand sides
(`criticalSeeds`), bounded by steps, term size, and seed count.

**Cost, measured** — 299 candidates screened over the three seed foundations:

| Outcome | Count |
|---|---|
| NON_CONFLUENT | 124 |
| DEGENERATE_CONSTANT | 102 |
| EQUIVALENT_TO_KNOWN | 47 |
| **NON_TERMINATING** | **21** |
| SURVIVED | 5 |

Re-running with the gate disabled reveals what those 21 were called before:
15 `NON_CONFLUENT`, 3 `EQUIVALENT_TO_KNOWN`, and **3 `SURVIVED`**.

Survivor count falls from 8 to 5. **Three of the eight structures the Foundry
has been calling survivors were rewrite systems in which nothing normalizes** —
they cycle at constant term size, which is why no size bound would have caught
them either. Every downstream question the gauntlet asks of a survivor
(confluence, derivation, equivalence) is meaningless in a system with no normal
forms, so those three were not weak results. They were void.

### D2 — The pre-registration lock was hashed but never verified

`EXPERIMENTAL_RESULT`. `preregister()` correctly hashed the spec.
`measure()` then accepted `prereg_hash` as *data* — it never recomputed
`sha256(stableStringify(spec))` and compared. A spec edited after seeing the
numbers (margin loosened, goal swapped, metric changed) measured cleanly and
emitted results stamped with a hash that no longer described it. Charter §10:
*"Never run a benchmark without a pre-registration lock."* The lock existed; the
door was unlocked.

Fixed: `verifyPreregistration()` recomputes the hash from the spec it claims to
cover, and `measure()` calls it first. Missing hash and mismatched hash are
distinct, named failures. No benchmark result in this repo predates the fix, so
nothing needs retraction — but nothing that came before it should have been
believed either.

---

## 5. Open, ranked

1. **Reduction Attack targets.** Four templates is not a room worth escaping.
   Until sets, relations, functions, graphs, automata, and programs are targets,
   `NO_EMBEDDING_FOUND` is not evidence and level 3+ is not available in
   practice. Highest priority: it gates the entire honesty rule.
2. **Screening deaths must reach the ledger.** We are discarding 98% of our
   failure evidence at process exit. Charter §8: never delete a failure.
3. **Assumption-removal operator.** §12 Step 3 has no implementation.
4. **Block B (Origin) on every record**; `StatementLabel` threaded through.
5. **Translation Engine with an explicit loss record.**
6. **Kernel: separate version constant; `GenesisRecord` schema validation.**
7. **Durable cross-run ledger with verify-on-read.**
8. **A `tsc` typecheck step.** D1 was three compile errors sitting in the hot
   path of the gauntlet for as long as the gauntlet has existed.
9. **Model sizes 4–7**, or a recorded justification for stopping at 3.

---

## 6. Cycle record (Charter §23)

1. **Executable artifacts changed** — `src/foundry/levels.ts` (new),
   `src/foundry/screen.ts` (D1), `src/foundry/benchmark.ts` (D2),
   `src/foundry/index.ts`.
2. **Recorded results** — `tests/foundry/genesis-law.test.ts`, 11 tests, written
   RED before any fix. Full suite 91/91 green. The two screening runs of §4.
3. **Ledger** — this report; charter text at `docs/genesis/CHARTER-v2-raw.txt`.
4. **State snapshot** — Phase 0 complete, M0 filed. In flight: nothing. Next
   three actions: (a) expand Reduction Attack targets to relations, functions,
   and graphs; (b) route `runScreen` outcomes into the registry as dead records
   with cause of death; (c) add the assumption-removal generator operator, which
   is the first thing in the whole program that can produce a candidate by
   *taking something away*.

**Status: M0 COMPLETE. M1 (single-world shakedown, World A — pure distinction)
may begin.**
