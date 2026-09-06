import "server-only";

import { redirect } from "next/navigation";

import { getVerifiedUser } from "@/src/auth/get-verified-user";

export async function requireUser() {
  const user = await getVerifiedUser();

  if (!user) redirect("/login");

  return user;
}
