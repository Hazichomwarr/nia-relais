import "server-only";

import { createRequire } from "node:module";

const requireNextModule = createRequire(import.meta.url);
const SUPER_ADMIN_USER_ID_PATTERN = /^c[a-z0-9]{24}$/;

export type VerifiedPlatformUser = { readonly id: string; readonly name: string };

export type RequireSuperAdminDependencies = {
  readonly getVerifiedUser: () => Promise<VerifiedPlatformUser | null>;
  readonly readConfiguredUserId: () => string | undefined;
  readonly redirectToLogin: () => never;
  readonly redirectToHome: () => never;
};

function redirectToRealLogin(): never {
  const { redirect } = requireNextModule("next/navigation") as typeof import("next/navigation");
  return redirect("/login");
}

function redirectToRealHome(): never {
  const { redirect } = requireNextModule("next/navigation") as typeof import("next/navigation");
  return redirect("/dashboard");
}

async function getRealVerifiedUser(): Promise<VerifiedPlatformUser | null> {
  const { getVerifiedUser } = await import("@/src/auth/get-verified-user");
  return getVerifiedUser();
}

const defaultDependencies: RequireSuperAdminDependencies = {
  getVerifiedUser: getRealVerifiedUser,
  readConfiguredUserId: () => process.env.NIA_SUPER_ADMIN_USER_ID,
  redirectToLogin: redirectToRealLogin,
  redirectToHome: redirectToRealHome,
};

export function isValidSuperAdminUserId(value: string | undefined): value is string {
  return typeof value === "string" && SUPER_ADMIN_USER_ID_PATTERN.test(value);
}

/**
 * This comparison is intentionally narrow: its caller must supply the
 * database-verified platform user returned by getVerifiedUser()/requireUser().
 * It never consumes session claims, client input, member identity, or flags.
 */
export function isVerifiedSuperAdmin(user: VerifiedPlatformUser | null, configuredUserId = process.env.NIA_SUPER_ADMIN_USER_ID) {
  return Boolean(user && isValidSuperAdminUserId(configuredUserId) && user.id === configuredUserId);
}

/**
 * The only authoritative boundary for founder-only server operations.
 * Future actions, route handlers, loaders, exports, and mutations must call
 * this independently; an admin layout or hidden navigation is not sufficient.
 */
export async function requireSuperAdmin(
  dependencies: Partial<RequireSuperAdminDependencies> = {},
): Promise<VerifiedPlatformUser> {
  const deps = { ...defaultDependencies, ...dependencies };
  let user: VerifiedPlatformUser | null;

  try {
    user = await deps.getVerifiedUser();
  } catch {
    deps.redirectToHome();
    throw new Error("unreachable: redirectToHome must never return");
  }

  if (!user) {
    deps.redirectToLogin();
    throw new Error("unreachable: redirectToLogin must never return");
  }

  if (!isVerifiedSuperAdmin(user, deps.readConfiguredUserId())) {
    deps.redirectToHome();
    throw new Error("unreachable: redirectToHome must never return");
  }

  return user;
}
