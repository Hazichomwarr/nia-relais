import type { Dictionary } from "./dictionaries/types";

const knownFieldErrors: Record<string, keyof Dictionary["authErrors"]> = {
  "Enter a valid email address.": "validEmail",
  "Enter your password.": "enterPassword",
  "Enter your name.": "enterName",
  "Name must be 100 characters or fewer.": "nameTooLong",
  "Password must be at least 8 characters.": "passwordLength",
};

export function localizeFieldError(message: string, dictionary: Dictionary) {
  const key = knownFieldErrors[message];
  return key ? dictionary.authErrors[key] : message;
}

export function localizeLoginError(dictionary: Dictionary) {
  return dictionary.authErrors.invalidCredentials;
}

export function localizeRegistrationError(message: string, dictionary: Dictionary) {
  if (message === "Email or password is incorrect.") return dictionary.authErrors.invalidCredentials;
  if (message === "We could not sign you in. Please try again.") return dictionary.authErrors.signInFailed;
  if (message === "We could not create your account. Please try again.") return dictionary.authErrors.registrationFailed;
  return dictionary.authErrors.emailInUse;
}
