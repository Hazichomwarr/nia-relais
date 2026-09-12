import type { Metadata } from "next";

import { requireUser } from "@/src/auth/require-user";
import { getCirclesForOwnerIndex } from "@/src/services/circle-owner-index.service";

import { CircleIndex } from "./circle-index";

export const metadata: Metadata = {
  title: "My SUSU circles · NIA",
};

export default async function CirclesPage() {
  const user = await requireUser();
  const circles = await getCirclesForOwnerIndex(user.id);

  return <CircleIndex circles={circles} />;
}
