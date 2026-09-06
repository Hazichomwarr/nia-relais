import { redirect } from "next/navigation";

import LoginForm from "@/app/login/login-form";
import { getVerifiedUser } from "@/src/auth/get-verified-user";

export default async function LoginPage() {
  const user = await getVerifiedUser();
  if (user) redirect("/dashboard");

  return <LoginForm />;
}
