# Screening Audit — Close, 2026-08-16

Ordered: account for every prior screening verdict as confirmed, reversed, or
unverifiable, and name by ID any candidate an earlier run killed that the
exhaustive run resurrects.

## The reference run

`foundry-ledger/runs/exhaustive-hashed-0001/screen-ledger.jsonl`

| field | value |
|---|---|
| seed | `exhaustive-hashed` |
| entries | 769 — 1 header, 767 verdicts, 1 close |
| chain | verified by recomputation |
| exhaustive | true (`sample_size: null`, recorded in the run header) |
| enumerated / screened | 767 / 767 |
| survived | 128 |

Superset is provable rather than narrated: the header carries the exhaustive
flag, enumeration bounds, operation set and parent set, so any other run's
coverage can be compared against it field by field instead of trusted.

## The table

| Prior run | Verdicts | CONFIRMED | REVERSED | UNVERIFIABLE |
|---|---|---|---|---|
| audit run (`audit-run`, sampled 6 per pair) | 36 | **36** | 0 | 0 |
| throwaway run (~20:26, no entrypoint, no ledger) | ~60 of 233 | — | — | **all** |

### Wrongly executed — killed then, survives now

**None.** Zero candidates were resurrected by the exhaustive run.

Also zero in the other direction: no candidate that survived the audit run is
killed by the exhaustive one.

### How the audit-run rows were closed

The audit run predates `candidate_hash`, so its entries carry only positional
IDs — which alias across runs (law L6). The rows were closed by **replay**: the
enumerator and the sampler are deterministic functions of the run seed, and the
seed is on the record, so the rule sitting at each index is recoverable.

The replay is itself checked before it is used: it must reproduce all 767
content identities the reference run wrote down. It does — 767/767. Only then
is it trusted to reconstruct the 36.

`node tools/close-audit.mjs [reference-ledger.jsonl]`

### Why the throwaway run is UNVERIFIABLE and stays that way

Not "probably fine." Unverifiable by construction, per incident
`INC-2026-08-16-fixed-path-overwrite`:

- its verdicts were never persisted — they lived in process memory;
- its only artifact, `survivors.json`, was destroyed by a later run at the same
  fixed path;
- its seed was never recorded, so the replay that closed the audit run cannot
  be applied to it;
- no trace survives in `foundry-out`, in temp, or in scrollback. This was
  searched, not assumed.

It is superseded by the exhaustive run, which covered every candidate any
sampled run could have touched. Superseded is not the same as confirmed, and
this row does not claim it is.

## What this close does NOT establish

- It does not show the screener is correct. It shows two runs agree, and that
  the earlier one covered nothing the later one missed.
- `EQUIVALENT_TO_KNOWN` is **0** across all 767. See the probe below: the
  detector is now observed firing, but only against renaming. Semantic
  equivalence at the interpretation stage remains unobserved on real
  enumerated input.
- Coverage of the reduction corpus is unchanged by this close, and under the
  strength bar it may only rise via attacks that clear it.

## Addendum — watching the equivalence killer fire

The zero above is the kind of clean number that should be distrusted, because
two very different worlds produce it: candidates that genuinely collide with
nothing, and a detector that cannot return YES at all. `sweep:red` exists for
exactly this — a detector nobody has watched fire is unproven.

So it was watched. `node tools/probe-equivalence.mjs`, run against the 128
survivors of the reference run — real enumerated input, not fixtures.

| Probe | Question | Result |
|---|---|---|
| RENAME | is a survivor equivalent to itself with its introduced operation symbol renamed? | **128 of 128 YES** |
| PAIRWISE | is any survivor equivalent to any other? | **0 of 8128** — the full sweep, not a sample |

What this establishes: the `EQUIVALENT_TO_KNOWN` branch is reachable on real
candidates. The zero is a fact about the candidates, not a detector wired shut.
It also independently corroborates the run: during screening each candidate was
checked against every earlier survivor, and re-asking all 8128 pairs afterwards
agrees with every one of those in-run answers.

What it does NOT establish, and this is the part that stays open: every YES the
probe produced came from renaming. No candidate was ever identified with a known
structure it merely *encodes* — different symbols, different rule shapes, same
mathematics. That is the interesting half of the killer and it is still
unobserved. Renaming is the easy case; passing it is a floor, not a pass mark.
