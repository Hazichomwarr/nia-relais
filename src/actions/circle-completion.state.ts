import type { CompleteCircleActionState } from "@/src/actions/circle-completion.actions";

// Mirrors round-lifecycle.state.ts's own per-domain initial-action-state
// convention exactly. Its own file, never merged into round-lifecycle
// .state.ts/circle.state.ts (7L.2): circle completion is a distinct
// domain from round-lifecycle progression and draft/contribution
// mutation, even though all three write to circle-adjacent state.

export const initialCompleteCircleState: CompleteCircleActionState = {};
