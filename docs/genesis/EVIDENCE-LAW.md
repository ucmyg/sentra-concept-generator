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
