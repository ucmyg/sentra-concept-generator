# Evidence Law

Standing rules for the Foundry. These are not style preferences. Each one is
here because its absence produced a defect that shipped.

---

## L1 — Outcome rates are observations, never proofs

**Never assert an aggregate outcome rate as evidence that a mechanism works.**
Kill ratios, rejection ratios, survival floors, pass percentages: report them,
never assert them.

A rate is exactly the number a *broken* mechanism inflates. A test asserting
"most candidates must die" passes most comfortably when the killer is executing
innocents, and goes red at the moment the killer becomes honest. It measures the
defect and calls it health.

**Instead:** prove a mechanism with a constructed scenario in which it MUST
fire, paired with one in which it MUST NOT. Both, explicitly, per channel.

*Origin: the equivalence channel was killing candidates on degenerate
interpretation witnesses. The kill-rate-floor test in `screen.test.ts` passed
throughout, and only failed once the defect was fixed.*

Legitimate near-misses, for contrast — these are not rate assertions and may
stay:

- `candidates_enumerated > 100` — a floor on *search breadth*. Enumeration
  happens before any judging, so no broken judge can inflate it.
- `attempts.length >= 12` — a floor on *record completeness*. It guards against
  silent truncation, which is the opposite failure mode.
- `detail.length > 0` — an existence check on *evidence*, not on outcomes.

The test: could a broken mechanism make this number go the right way? If yes,
it is not a proof.

---

## L1b — A test that guards a mechanism must be shown to fail

**The RED half is part of the test's evidence, not a courtesy.** Any test whose
name claims it guards something — a gate, a chain, a killer, a refusal — must
demonstrate it CAN fail, and that demonstration must be recorded where the test
lives: a commit hash where it was red, a stashed-fix reproduction, or a fixture
the sweep runs against.

A guard test that has never been observed failing is indistinguishable from a
guard test that cannot fail. Both are green.

*Two occurrences in one night, which is what turned this from an anecdote into
a rule:*

1. `'a screening run kills the overwhelming majority of what it proposes'`
   asserted a kill-rate floor and passed for as long as the equivalence channel
   was executing candidates on degenerate witnesses.
2. `'the chain breaks if any entry is altered'` asserted that a fixture the test
   had itself just mutated differed from the original. It never called
   `verify()`. It named the tamper detector and exercised nothing.

The mechanical symptoms are swept by `tools/proves-nothing-sweep.mjs`:
`RATE_ASSERTION`, `DEAD_LOCAL`, `VOIDED_VALUE`, `ASSERTS_OWN_FIXTURE`,
`NO_MECHANISM_INVOKED`. The sweep is itself held to this rule — it runs against
a fixture reconstructing both historical defects, and must flag both. A
detector that has never been seen to fire proves nothing either.

The sweep catches symptoms, not the class. It is a floor, not a ceiling.

---

## L2 — A terminal verdict carries its evidence or it does not exist

Verdicts that delete a concept — `EXISTING_EQUIVALENT_FOUND`,
`EQUIVALENT_TO_KNOWN` — are terminal. They do not weaken a claim, they end it.

Therefore their evidence bar is the **highest** in the machine, not the lowest,
and the evidence travels *with* the verdict, machine-readable, at the moment it
is issued. A kill recorded as a bare label is a kill nobody can audit later,
and an unauditable terminal verdict is one nobody can ever reverse.

See `ScreenResult.equivalence_evidence` and
`StagedEquivalenceVerdict.witness_gate`.

---

## L3 — A gate that can be satisfied vacuously is not a gate

Before accepting a witness for a terminal verdict, validate the witness itself
for non-degeneracy, as a **named** gate with **named** conditions. See
`witness-gate.ts`: `W1_NON_COLLAPSING`, `W2_NON_TAUTOLOGICAL`,
`W3_BIDIRECTIONAL`.

A witness failing the gate is not a weaker kill. It is **no kill**, recorded as
a rejected witness carrying the condition it failed.

---

## L4 — In-memory verdicts are not history

A verdict that exists only in process memory cannot be audited, so it cannot be
reversed, so an error in it is permanent by construction.

*Origin: an audit of every historical equivalence kill was ordered and returned
empty — not because the killer never fired, but because `screen.ts` persisted
nothing. Every kill it ever issued evaporated at process exit. The audit was
unrunnable, which is strictly worse than an audit that finds damage.*

## L5 — Luck is not a control

A hazard that procedure caught is a hazard that is still live. The only
question a near-miss answers is whether someone happened to be looking.

### House precedent: the fixed-path overwrite, 2026-08-16

The screening entrypoint wrote every run's verdicts to one filename. Two
occurrences, both recorded in the incidents chain as
`INC-2026-08-16-fixed-path-overwrite`:

| # | Time | What was destroyed | Caught by | Recovered |
|---|------|--------------------|-----------|-----------|
| 1 | ~20:26 | the throwaway run behind `survivors.json` — 60 screened of 233 | noticed afterwards, during an unrelated audit | no; seed and survivor identities are gone |
| 2 | 22:23 | the exhaustive re-screen's ledger, 767 of 767 | noticed afterwards, during the fix for occurrence 1 | yes, only because a hand-made copy happened to exist |

Occurrence 2 fired forty minutes after L4 was written down, by the same
author, in the same session, while that author was actively fixing
occurrence 1. Vigilance was at its maximum and the hazard fired anyway.

**The precedent.** Both catches were luck. The first depended on someone
running an audit that had no reason to look there. The second depended on a
copy made by hand for an unrelated purpose. Neither was a control. Had either
piece of luck been absent, the loss would have been silent and permanent, and
the record would have shown a clean run.

Therefore: when a hazard is found, the remedy is a mechanism that makes the
hazard impossible, not a rule telling the next person to be careful. A rule
that must be remembered has already failed once by existing.

Remedy for this precedent: run-scoped output directories, `mkdirSync` with
`recursive: false`, no shared mutable filename for anything verdict-bearing.
Pinned by `tests/foundry/run-store.test.ts` — *a second run cannot alter the
first run byte-for-byte*. That test fails against the code as it stood at
22:23.

### Corollary — a check that skips itself when its evidence is missing is not a check

Discovered closing this same audit. The cross-run comparison verified its
replay against the identities in the reference ledger, and skipped that
verification when the reference carried none. It then compared replay-derived
identities on both sides, agreed with itself 36 out of 36, and reported a
closed audit having proven nothing.

Missing evidence is a STOP, never a pass. Same shape as L3: a gate that can be
satisfied vacuously is not a gate, and a check that can be satisfied by the
absence of its own evidence is the vacuous case wearing a lab coat.

## L6 — Identity is what a thing is, never where it sat

`candidate_id` is positional: `<parent>-gen-<op>-<index>`. Under sampling the
batch is a seeded shuffle, so index *N* names a different rule in every run.

The first cross-run audit keyed on that id and reported 22 of 36 verdicts
reversed. Every one was an alias. Nothing had flipped.

Any identity a claim is keyed on must be derived from the content of the thing
claimed about — here `candidate_hash`, sha256 over the parent, the introduced
operation, and the rule. Positional ids remain useful for reading a single
run's log and are never valid across runs.

Pinned by `tests/foundry/candidate-identity.test.ts`, which asserts that
`candidate_id` demonstrably *does* alias across two sampled runs, so the day it
stops aliasing is the day someone has to come read this law before deleting it.
