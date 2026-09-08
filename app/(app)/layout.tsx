import { requireUser } from "@/src/auth/require-user";

import { AppNavigation } from "./app-navigation";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-[#fbf7ef] text-[#173b32]">
      <AppNavigation userName={user.name} />
      <main>{children}</main>
    </div>
  );
}
