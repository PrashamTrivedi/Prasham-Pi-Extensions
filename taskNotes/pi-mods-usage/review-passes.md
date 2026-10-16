# Review passes — pi-mods-usage

Diff reviewed: `c6bc0da..HEAD` (the usage extension increment).

## Pass 1 (deep): 1 finding

1. **Repeated identical error notifications.** `render()` runs on a timer, so a
   persistent provider failure (or a permanently missing key) would `notify` the
   same error every `refreshMinutes`. Fixed: `notifyError` notifies once per
   distinct message and `lastError` resets on a successful render.

Checked and found clean: config merge/clamp, provider-switch clearing, print-mode
UI guards, timer lifecycle (`session_shutdown` clears), no secrets in status or
notifications, no casts.

## Pass 2 (confirm fixes + spawned issues): 0 findings

Re-ran `npm run check` (86 pass, 0 fail) and the lifecycle smoke test; both green.
The dedupe change did not affect the success path (`notifications: []`).

## Verdict

Terminated by **zero findings** (well before the 5-pass cap).
