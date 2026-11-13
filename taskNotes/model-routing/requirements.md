# Per-turn model routing — requirements

## Goal

Let a turn use a cheaper model for the mechanical parts of the work (reading, grepping, listing,
small edits) and escalate to the configured model only when the work needs it — without the human
switching models by hand and without the agent silently degrading.

## Who and why

For a power user on paid providers: most tool-heavy turns are dominated by cheap work, but the
whole turn runs on the expensive model because Pi has one model per session. A virtual model that
routes by step would cut cost on the same work.

## Requirements

1. **Virtual models.** A configurable alias (e.g. `auto/cheap-first`) resolves to an ordered list of
   real models with rules, not a fixed model id. `--model auto/cheap-first` and `/model` both work;
   the footer shows the alias, and the transcript notes which real model answered each step.
2. **Step routing.** The router classifies each step before the provider call: retrieval-only
   (`read`, `grep`, `find`, `ls` and their follow-ups), mechanical edit, or judgment (analysis,
   planning, user-facing prose, risky writes). Retrieval and mechanical steps go to the cheapest
   ranked model that is allowed the needed tools.
3. **Escalation on failure.** A cheap step escalates when: the tool call is malformed twice, the
   model reports it cannot proceed, the answer is empty, a provider error is not retryable, or the
   step is the first one after a user turn (judgment by default). Escalation is one step, not a
   permanent switch; the next step is re-classified.
4. **No silent substitution.** Any cheap-model failure that cannot be retried is reported, and the
   turn continues on the configured model with a visible note. A model that is unavailable is
   skipped with a recorded reason.
5. **Cost accounting.** Each step records model, provider, tokens and cost; the turn summary and
   the workbench statusline show routed cost vs. what the same turn would have cost on the base
   model (estimate, labelled as such).
6. **Per-project and per-session controls.** `PI_ROUTE_CONFIG` (or a config file) defines the alias,
   ranked models, allowed tools per tier and an on/off switch. `/route` inspects the current
   mapping and the session's savings; disabling returns to the base model immediately.
7. **Deterministic classification.** The classifier is a rule table (tool name, step index, prior
   tool result, branch state), not an LLM call. An LLM classifier would add cost and latency to the
   thing it is trying to save.
8. **Compatibility.** Works with the existing extension API (`registerVirtualModel`/model aliases),
   with Fabric workers (their `--model` is explicit), and with compaction/branch summaries, which
   always use the base model.

## Non-goals

- Changing the user's configured model permanently.
- Routing inside a single provider response (mid-stream model switch).
- Automatic spend budgets or hard cost caps.
- Routing for image or embedding models.

## Measurable success criteria

- On a 10-task sample heavy in reads/greps, total cost is **≥30% lower** than the same tasks on the
  base model, with the same final files.
- Escalation rate stays **≤25% of steps**; a spike means the classifier or the cheap model is wrong.
- No task loses a required tool: the routed model's tool allow-list is identical or wider.
- Every routed step is visible in the transcript with its model; zero silent fallbacks.
- p95 added latency per step **≤150 ms** (classification and routing only, excluding provider time).
- `/route off` restores the base model before the next provider call.

## Open questions

- Which cheap models are trustworthy for edits in this setup (needs a small eval), and the rank
  order per provider.
- Whether the classifier should read the *pending tool call* after the model proposes it (route the
  execution) or the *step intent* before generation (route the generation). The former is exact but
  cannot route the generation that produced the call.
- How Pi's virtual-model API (if any) interacts with Fabric's rank rules.
- Whether savings should be measured from provider usage or from Pi's local estimate, and how prompt
  caching distorts both.
