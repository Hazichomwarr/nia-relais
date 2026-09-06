import { logoutAction } from "@/src/actions/auth.actions";
import { requireUser } from "@/src/auth/require-user";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-semibold">NiaRelais</span>
        <div className="flex items-center gap-4">
          <span>Hello, {user.name}</span>
          <form action={logoutAction}>
            <button type="submit" className="rounded border px-3 py-1.5 text-sm">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
