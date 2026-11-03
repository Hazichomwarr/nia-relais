import { Prisma } from "@prisma/client";

import { prisma } from "@/src/prisma";

export const FOUNDER_DIRECTORY_PAGE_SIZE = 20;

export type FounderDirectoryCategory = "ALL" | "PERSONAL_SAVINGS" | "SUSU" | "BOTH" | "NEITHER";

export type FounderDirectoryQuery = {
  readonly search: string;
  readonly category: FounderDirectoryCategory;
  readonly page: number;
};

const directorySelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  _count: { select: { ownedGoals: true, ownedCircles: true } },
} satisfies Prisma.UserSelect;

export type FounderDirectoryUserRecord = Prisma.UserGetPayload<{ select: typeof directorySelect }>;

export function categoryWhere(category: FounderDirectoryCategory): Prisma.UserWhereInput {
  switch (category) {
    case "PERSONAL_SAVINGS":
      return { ownedGoals: { some: {} } };
    case "SUSU":
      return { ownedCircles: { some: {} } };
    case "BOTH":
      return { ownedGoals: { some: {} }, ownedCircles: { some: {} } };
    case "NEITHER":
      return { ownedGoals: { none: {} }, ownedCircles: { none: {} } };
    default:
      return {};
  }
}

export function founderDirectoryWhere(query: Pick<FounderDirectoryQuery, "search" | "category">): Prisma.UserWhereInput {
  const search = query.search.trim();
  return {
    AND: [
      categoryWhere(query.category),
      ...(search.length === 0
        ? []
        : [{ OR: [{ name: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }] }]),
    ],
  };
}

export const founderUserDirectoryRepository = {
  async count(query: Pick<FounderDirectoryQuery, "search" | "category">) {
    return prisma.user.count({ where: founderDirectoryWhere(query) });
  },

  async findPage(query: FounderDirectoryQuery) {
    return prisma.user.findMany({
      where: founderDirectoryWhere(query),
      select: directorySelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * FOUNDER_DIRECTORY_PAGE_SIZE,
      take: FOUNDER_DIRECTORY_PAGE_SIZE,
    });
  },
};
