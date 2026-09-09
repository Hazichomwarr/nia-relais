import type { Metadata } from "next";

import { NewCircleForm } from "./new-circle-form";

export const metadata: Metadata = {
  title: "Start a savings circle · NIA",
};

// Protected by app/(app)/layout.tsx's requireUser() -- same as every other
// page under this route group (e.g. /goals/new). No separate owner
// authentication system is introduced here.
export default function NewCirclePage() {
  return <NewCircleForm />;
}
