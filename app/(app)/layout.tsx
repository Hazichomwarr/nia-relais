import { logoutAction } from "@/src/actions/auth.actions";
import { requireUser } from "@/src/auth/require-user";
import Link from "next/link";

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
          <Link href="/custodian" className="text-sm font-medium underline-offset-4 hover:underline">
            Custodian requests
          </Link>
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
