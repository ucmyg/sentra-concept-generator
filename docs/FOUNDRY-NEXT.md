# Concept Foundry — next implementation and research plan

> STATUS 2026-08-16: Priority 1 (items 1-3) and Priority 2 items 4 (termination
> half only) and 6 are DONE and pushed. See commits 7ee60ae, bae3f7c, the
> interpretation-witness commit, and `kernel.ts::terminationProbe`.
> Confluence (the other half of item 4, critical-pair analysis) is
> deliberately NOT attempted yet — it needs first-order unification, which
> is a correctness-sensitive addition to a trusted-kernel file and should not
> be rushed. Remaining open items: confluence probes, then item 5.

Written after the first generation run. Ordered by what most threatens the
honesty of the output, not by what is most fun to build.

## Priority 1 — kill the three defects the first run exposed

These are logged in every run report and they invalidate the utility axis until
they are fixed. Nothing should be promoted past UNTESTED before they are.

1. **Real benchmark baselines.** `BENCHMARK_SPECS` currently stipulates
   `baseline_value` and `success_threshold` as numbers chosen at pre-registration
   time. Pre-registration fixes the rule before the result, which is the point,
   but a stipulated baseline measures nothing. Build a baseline runner that
   encodes the same task in a conventional representation (plain term rewriting
   over the same signature) and *runs* it. Until then the `advantage` column is
   decoration and should be rendered as `UNCALIBRATED`.

2. **Non-circular reasoning-steps metric.** `bench-reasoning-steps` measures the
   length of derivations that `searchDerivation` was configured to stop at.
   Replace with pre-registered (start term, target term) pairs per foundation;
   measure steps required to connect them, or record UNREACHABLE.

3. **Non-vacuous contradiction search.** All three seed foundations declare an
   empty `distinct` set, so `findContradiction` cannot report anything. Zero
   kills is currently evidence of an untested search. Require at least one
   distinctness assertion per foundation at admission time, and add a mutation
   test: inject a contradictory rule into each foundation and assert the search
   finds it. That test belongs in the acceptance suite.

## Priority 2 — strengthen the kernel and the checker

4. **Confluence and termination probes.** The kernel replays traces but says
   nothing about whether a rule set is confluent or terminating. Add bounded
   critical-pair analysis (Knuth–Bendix style, budgeted) and report
   NON_CONFLUENT / NON_TERMINATING_WITHIN_BOUND as first-class findings. A
   non-confluent system where two normal forms are declared distinct is exactly
   the contradiction case, so this feeds Priority 1.3.

   DONE (termination half): `terminationProbe` in `kernel.ts` attempts
   leftmost-outermost normalization of a given start term under a hard
   step/size budget and reports `TERMINATED` / `NON_TERMINATING_WITHIN_BOUND`
   / `SIZE_EXCEEDED`. It is a probe on one reduction order for one start
   term, not a decidability proof, and says so in its own doc comment.
   Tests: `tests/foundry/termination.test.ts`.

   STILL OPEN (confluence half): needs first-order unification between two
   rule LHSes (not the one-directional `match` the kernel already has) to
   find critical pairs, then joinability of each pair via `terminationProbe`
   on both branches. Left unbuilt rather than shipped half-verified — a
   unification bug in a trusted-kernel file produces false NON_CONFLUENT or
   false confluence claims, either of which is worse than the gap being
   visibly open.

5. **Conditional and non-oriented axioms.** Rules are currently oriented rewrites
   only. Equational axioms that cannot be oriented (commutativity) are
   unrepresentable, which quietly restricts what can be invented. Add
   unordered-equation support with matching modulo a declared theory.

6. **Witness search beyond bijection.** `findWitness` enumerates name bijections.
   That catches renaming — which was the point — but misses a re-skin that
   *derives* one operation from another (a concept defining `f(x) = mul(x,x)` over
   a monoid is not caught). Extend to interpretation witnesses where each
   operation maps to a *term* in the target signature, verified by checking each
   translated axiom is derivable. This is the difference between catching a
   rename and catching a genuine re-skin, and it is the single highest-value
   improvement to the novelty axis.

## Priority 3 — the corpus seam

7. **Prior-art ingestion.** `attachPriorArtCorpus` is the only place
   `NOVELTY_CONFIRMED` can ever be wired to, and the transition literally does
   not exist in the table until a corpus is attached. Implement a corpus that
   stores structures in the same `Foundation` shape and searches with the
   Priority-2.6 interpretation witness. Note the ordering: 2.6 before 3.7. A
   corpus searched by a weak equivalence checker produces confident false
   novelty claims, which is worse than no corpus at all.

8. **Corpus provenance.** Ingested structures are SOURCED CLAIMS about existing
   mathematics and must go through the evidence gate with passage hashes, not
   through the Foundry schema. This is the one place the two subsystems touch,
   and it is the place to be most careful: the corpus record cites, the
   comparison result constructs.

## Priority 4 — generation quality

9. **Primitives with no existing equivalent.** The three seed foundations are
   built from recognizable primitives (distinction, constraint, uncertainty).
   The brief asked for attempts at primitives with no obvious existing
   mathematical equivalent, and this run did not deliver one. Concretely: try
   primitives that are not sets-with-structure at all — e.g. a primitive whose
   identity conditions are observer-relative, or one where composition is
   partial by construction rather than by restriction.

10. **Adversarial generation loop.** Generate, then immediately spawn a critic
    whose only job is to find the known structure the concept collapses into.
    Concepts that survive N independent critics earn a recorded
    `distinguishing_behavior`, which is the prerequisite for POSSIBLY_NOVEL.

## Standing constraints

- The evidence gate is not modified. The regression test in
  `tests/foundry/acceptance.test.ts` runs first and must stay green.
- Registry admission stays cheap; the statuses carry the weight.
- Nothing is presented above its earned status anywhere outside the registry.
- Every bound is reported. A budget exhaustion is never rendered as a proof.
