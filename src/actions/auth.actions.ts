"use server";

import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";
import { EmailAlreadyInUseError, registerPlatformUser } from "@/src/services/registration.service";
import { loginSchema } from "@/src/validations/login.schema";
import { registrationSchema } from "@/src/validations/registration.schema";

export type LoginActionState = {
  fieldErrors?: Partial<Record<"email" | "password", string[]>>;
  formError?: string;
};

export async function loginAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { formError: "Email or password is incorrect." };
    }

    throw error;
  }

  return {};
}

export async function logoutAction() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export type RegistrationActionState = {
  fieldErrors?: Partial<Record<"name" | "email" | "password", string[]>>;
  formError?: string;
};

export async function registerAction(
  _previousState: RegistrationActionState,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = registrationSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await registerPlatformUser(parsed.data);
  } catch (error) {
    if (error instanceof EmailAlreadyInUseError) {
      return { formError: error.message };
    }

    return { formError: "We could not create your account. Please try again." };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { formError: "We could not sign you in. Please try again." };
    }

    throw error;
  }

  return {};
}
