# Concept Foundry — additive extension design note

## What exists today

The evidence gate is `parseAndValidateInventionOutput` in `src/output-contract.ts`.
It validates a model response against `mechanism-invention-output-v1`: every concept
must carry `evidence_refs` bound to transmitted packets, every ref must echo the
canonical passage (hash-compared), and every `mechanism_atom` must cite a ref that
was actually transmitted. `buildTransmittedEvidenceIndex` is the sole authority for
what counts as transmitted. A concept with zero refs is rejected by
`OUTPUT_EVIDENCE_REFS_EMPTY`; a concept citing an untransmitted packet is rejected by
`OUTPUT_PACKET_ID_NOT_TRANSMITTED`.

That path is the SOURCED CLAIM path. It is not modified by this build.

## The extension

`src/foundry/` is a new, self-contained subtree. It shares exactly two things with
the existing code: `sha256` and `stableStringify` from `src/canonical-json.ts`.
It imports nothing else from `src/`, and nothing in `src/` imports it except one
additive re-export line in `src/index.ts`.

The safest additive extension is therefore a *sibling*, not a branch inside the
gate. There is no code path by which a CONSTRUCTED artifact can enter
`parseAndValidateInventionOutput`, because the Foundry never produces a
`mechanism-invention-output-v1` envelope. The two subsystems have disjoint
schemas, disjoint validators, and disjoint stores. A bypass would require
someone to write new routing code, not to misconfigure existing code.

## Three classes, one enforcement point

`foundry/classes.ts` owns `classifyStatement`. Every statement stored or emitted
carries `epistemic_class`:

- `SOURCED_CLAIM` — routed to the untouched evidence gate. Requires packets.
- `CONSTRUCTED_ARTIFACT` — requires a complete genesis record + lineage hash.
  Requires zero citations. **Rejected if it carries evidence refs**, because a
  construction that cites a source is reporting, not proposing.
- `DERIVED_RESULT` — requires a kernel-replayable trace. Rejected without one.

Misclassification is caught in both directions:
- a construction whose prose asserts external establishment (`ASSERTS_EXTERNAL_FACT`)
  is rejected as a fabricated sourced claim;
- an axiom phrased as a fact about the world rather than an assumption of the
  system (`AXIOM_ASSERTS_WORLD_FACT`) is rejected at genesis.

## Formal substrate

Terms are JSON trees: `{v: name}` | `{c: name}` | `{op: name, args: [...]}`.
This is the native representation. It has serializable syntax, operational
semantics (a rewrite relation), and it is what the kernel executes. A concept may
declare a native form with no conventional-notation translation; it may never
declare one the kernel cannot run.

A foundation declares primitives, operations (with arities), axioms (oriented
rewrite rules `lhs -> rhs`), inference rules, and distinctness assertions.

The trusted kernel (`foundry/kernel.ts`, ~120 lines, no dependencies) does one
thing: given a start term and a list of steps `{rule, path, subst}`, it applies
each rule at the given position and checks the produced term equals the recorded
term. A trace that does not replay byte-identically is not a trace.

## Statuses

Three orthogonal axes in `foundry/status.ts`, enforced by a transition table, not
by convention. `NOVELTY_CONFIRMED` has no incoming edge at all while
`priorArtCorpusAttached()` returns false — the transition is absent from the
table, so the code cannot reach it. `POSSIBLY_NOVEL` requires a non-empty
`distinguishing_behavior`. `EXISTING_EQUIVALENT_FOUND` requires a two-way
translation witness object that verified.

## Registry

`foundry/registry.ts` exposes `append` and readers. There is no `update`, no
`delete`, no mutable handle. Records are frozen on append and the backing array is
never spliced. Corrections are appends with `supersedes`. Contradictory concepts
stay, with `cause_of_death`.

Lineage hash = `sha256(stableStringify({...record, lineage_hash: null}) + '\n' +
parents.map(p => p.lineage_hash).sort().join('\n'))`. Any edit anywhere in an
ancestor changes that ancestor's hash, which changes every descendant's.

## Test order

`tests/foundry/*.test.ts`. The regression test asserting the untouched evidence
gate still rejects an unsourced external claim is written first and must pass
before and after every change in this build.
