# Review passes

- Pass 1: 5 findings — `pushed` passed on a failing `rev-list`; an unreachable server was a miss
  line but not a notification; `semantics`/`stage` were waivable by the model; the stage switch's
  budget reset had no test; unused helper exports.
- Pass 2: 2 findings — `session_start` resurrected a run whose outcome entry was already `met`;
  a failed `goal.md` write was silent in `dev_stage`/`dev_outcome_met`.
- Pass 3: 1 finding — `collectFacts` judged only the working tree, so committed work was invisible
  to the work validator; now the committed range since `currentCommitHash` plus the working tree.
- Pass 4: 1 finding — the decision server judged evidence scraped from recent turns, not the raw
  `evidence` the model declares to `dev_outcome_met`; both are now sent.
- Pass 5: 0 findings
