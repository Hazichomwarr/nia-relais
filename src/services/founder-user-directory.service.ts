import "server-only";

import { requireSuperAdmin, type VerifiedPlatformUser } from "@/src/auth/require-super-admin";
import {
  FOUNDER_DIRECTORY_PAGE_SIZE,
  founderUserDirectoryRepository,
  type FounderDirectoryCategory,
  type FounderDirectoryQuery,
  type FounderDirectoryUserRecord,
} from "@/src/repositories/founder-user-directory.repository";

const categories = new Set<FounderDirectoryCategory>(["ALL", "PERSONAL_SAVINGS", "SUSU", "BOTH", "NEITHER"]);
const MAX_SEARCH_LENGTH = 100;

export type FounderDirectoryEntry = {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly registeredAt: string;
  readonly category: Exclude<FounderDirectoryCategory, "ALL">;
  readonly goalCount: number;
  readonly circleCount: number;
};

export type FounderUserDirectory = {
  readonly entries: readonly FounderDirectoryEntry[];
  readonly totalMatchingUsers: number;
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: typeof FOUNDER_DIRECTORY_PAGE_SIZE;
  readonly search: string;
  readonly category: FounderDirectoryCategory;
};

type DirectoryRepository = {
  count(query: Pick<FounderDirectoryQuery, "search" | "category">): Promise<number>;
  findPage(query: FounderDirectoryQuery): Promise<readonly FounderDirectoryUserRecord[]>;
};

type Dependencies = {
  readonly requireSuperAdmin: () => Promise<VerifiedPlatformUser>;
  readonly repository: DirectoryRepository;
};

const defaults: Dependencies = { requireSuperAdmin, repository: founderUserDirectoryRepository };

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | string[] | undefined): number {
  const candidate = firstValue(value);
  if (!candidate || !/^\d+$/.test(candidate)) return 1;
  const page = Number(candidate);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function parseFounderDirectoryQuery(input: Record<string, string | string[] | undefined>): FounderDirectoryQuery {
  const requestedSearch = firstValue(input.search)?.trim() ?? "";
  const requestedCategory = firstValue(input.category);
  return {
    search: requestedSearch.length <= MAX_SEARCH_LENGTH ? requestedSearch : "",
    category: requestedCategory && categories.has(requestedCategory as FounderDirectoryCategory)
      ? requestedCategory as FounderDirectoryCategory
      : "ALL",
    page: parsePage(input.page),
  };
}

export function categoryForCounts(goalCount: number, circleCount: number): FounderDirectoryEntry["category"] {
  if (goalCount > 0 && circleCount > 0) return "BOTH";
  if (goalCount > 0) return "PERSONAL_SAVINGS";
  if (circleCount > 0) return "SUSU";
  return "NEITHER";
}

function serialize(record: FounderDirectoryUserRecord): FounderDirectoryEntry {
  const goalCount = record._count.ownedGoals;
  const circleCount = record._count.ownedCircles;
  return {
    id: record.id,
    name: record.name || null,
    email: record.email,
    registeredAt: record.createdAt.toISOString(),
    category: categoryForCounts(goalCount, circleCount),
    goalCount,
    circleCount,
  };
}

/** Founder-only read model; no caller may rely on the page boundary alone. */
export async function getFounderUserDirectory(
  input: Record<string, string | string[] | undefined>,
  dependencies: Partial<Dependencies> = {},
): Promise<FounderUserDirectory> {
  const deps = { ...defaults, ...dependencies };
  await deps.requireSuperAdmin();

  const query = parseFounderDirectoryQuery(input);
  const totalMatchingUsers = await deps.repository.count(query);
  const pageCount = Math.ceil(totalMatchingUsers / FOUNDER_DIRECTORY_PAGE_SIZE);
  const page = Math.min(query.page, Math.max(pageCount, 1));
  const entries = await deps.repository.findPage({ ...query, page });

  return {
    entries: entries.map(serialize),
    totalMatchingUsers,
    page,
    pageCount,
    pageSize: FOUNDER_DIRECTORY_PAGE_SIZE,
    search: query.search,
    category: query.category,
  };
}
