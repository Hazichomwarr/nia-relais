# Super Admin foundation

NIA V1 has exactly one Super Admin. The authorization source is the server-only
`NIA_SUPER_ADMIN_USER_ID` environment variable, whose value is the immutable
`User.id` of the founder's existing platform account.

Authorization never uses email, display name, session claims, a member session,
or a client-provided flag. A request is allowed only after Auth.js identity has
been re-verified against the current `User` database row and that row's `id`
exactly matches the configured value.

## Safely obtain the founder's User.id

Run this restricted, local operation against the authoritative configured
database. Replace the example address locally; do not paste it or the returned
ID into chat, source code, or commits. Email is only a local lookup key here;
it is never an authorization input.

```sh
FOUNDER_ACCOUNT_EMAIL='founder@example.com' pnpm exec tsx -e 'import { prisma } from "./src/prisma"; const user = await prisma.user.findUnique({ where: { email: process.env.FOUNDER_ACCOUNT_EMAIL }, select: { id: true } }); if (!user) throw new Error("Founder platform account not found"); console.log(user.id); await prisma.$disconnect();'
```

The command returns only the matching immutable ID. Confirm it belongs to the
founder's existing platform account through the approved operational process;
never select the first User row.

## Production configuration

In Vercel, open **nia-relais → Settings → Environment Variables** and add:

```text
NIA_SUPER_ADMIN_USER_ID=<verified immutable User.id>
```

Set its scope to **Production**. Add it to Preview only when an explicitly
authorized founder account exists in that preview database and must access
`/admin`. A redeploy is required after changing the variable.

An absent, empty, or malformed value intentionally denies founder access. Do
not substitute an email address or disable the fail-closed guard.
