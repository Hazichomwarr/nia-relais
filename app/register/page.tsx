import { redirect } from "next/navigation";

import RegisterForm from "@/app/register/register-form";
import { getVerifiedUser } from "@/src/auth/get-verified-user";

export default async function RegisterPage() {
  const user = await getVerifiedUser();
  if (user) redirect("/dashboard");

  return <RegisterForm />;
}
