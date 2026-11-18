# Review passes

- Pass 1: 5 findings — `pushed` passed on a failing `rev-list`; an unreachable server was a miss
  line but not a notification; `semantics`/`stage` were waivable by the model; the stage switch's
  budget reset had no test; unused helper exports.
- Pass 2: 2 findings — `session_start` resurrected a run whose outcome entry was already `met`;
  a failed `goal.md` write was silent in `dev_stage`/`dev_outcome_met`.
- Pass 3: 0 findings
