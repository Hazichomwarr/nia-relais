import { requireUser } from "@/src/auth/require-user";

import { AppNavigation } from "./app-navigation";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-[var(--nia-app-background)] text-[var(--nia-text)]">
      <AppNavigation userName={user.name} />
      <main>{children}</main>
    </div>
  );
}
