export function getFirstName(displayName: string | null | undefined) {
  const [firstName] = displayName?.trim().split(/\s+/) ?? [];
  return firstName || null;
}
