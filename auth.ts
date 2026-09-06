import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

import { prisma } from "@/src/prisma";

const DUMMY_PASSWORD_HASH =
  "$2b$12$3J8xyaAqL17eGbilpz8uduBrypPAugZBH6.D7Ys2v8CgDxKhcnW4W";

function getCredentials(credentials: Partial<Record<string, unknown>> | undefined) {
  const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const password = typeof credentials?.password === "string" ? credentials.password : "";

  if (!email || !password || !email.includes("@")) return null;

  return { email, password };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = getCredentials(credentials);
        const user = parsed
          ? await prisma.user.findUnique({
              where: { email: parsed.email },
              select: { id: true, name: true, passwordHash: true },
            })
          : null;

        const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
        const passwordMatches = await compare(parsed?.password ?? "", passwordHash);

        if (!user || !user.passwordHash || !passwordMatches) return null;

        return { id: user.id, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if (user?.name) token.name = user.name;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (token.name !== undefined) session.user.name = token.name;
      return session;
    },
  },
});
