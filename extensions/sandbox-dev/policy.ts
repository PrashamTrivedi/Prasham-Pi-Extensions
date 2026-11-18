/**
 * Supervision helpers for `sandbox-dev`.
 *
 * There is deliberately no permission policy here. The decision server judges every tool call;
 * this package neither pre-approves nor blocks anything on its own.
 */

/** Maximum supervised continuation turns for an anchored outcome. */
export const BUDGET = 8;
