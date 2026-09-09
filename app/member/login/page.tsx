import type { Metadata } from "next";

import { MemberLoginForm } from "./member-login-form";

export const metadata: Metadata = {
  title: "Circle member sign in · NIA",
  description: "Sign in to your SUSU circle with your Circle ID, member code, and PIN.",
};

export default function MemberLoginPage() {
  return (
    <main className="min-h-screen bg-[#fbf7ef]">
      <MemberLoginForm />
    </main>
  );
}
