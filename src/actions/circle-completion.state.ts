// Imported directly from its own owning testable-core module, never from
// circle-completion.actions.ts (a "use server" file) -- see that file's
// own comment: re-exporting a type from a Server Action module trips the
// Next.js/Turbopack transform into treating it as a callable action
// reference.
import type { CompleteCircleActionState } from "@/src/actions/complete-circle";

// Mirrors round-lifecycle.state.ts's own per-domain initial-action-state
// convention exactly. Its own file, never merged into round-lifecycle
// .state.ts/circle.state.ts (7L.2): circle completion is a distinct
// domain from round-lifecycle progression and draft/contribution
// mutation, even though all three write to circle-adjacent state.

export const initialCompleteCircleState: CompleteCircleActionState = {};
