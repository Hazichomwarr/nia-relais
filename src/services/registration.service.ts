import { Prisma } from "@prisma/client";
import { hash } from "bcryptjs";

import { createUser, findUserByEmail } from "@/src/repositories/user.repository";
import type { RegistrationInput } from "@/src/validations/registration.schema";

export class EmailAlreadyInUseError extends Error {
  readonly code = "EMAIL_ALREADY_IN_USE";

  constructor() {
    super("An account with this email already exists.");
    this.name = "EmailAlreadyInUseError";
  }
}

export async function registerPlatformUser(input: RegistrationInput) {
  const existingUser = await findUserByEmail(input.email);
  if (existingUser) throw new EmailAlreadyInUseError();

  const passwordHash = await hash(input.password, 12);

  try {
    return await createUser({
      name: input.name,
      email: input.email,
      passwordHash,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new EmailAlreadyInUseError();
    }

    throw error;
  }
}
