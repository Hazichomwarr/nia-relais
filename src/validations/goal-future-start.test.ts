import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { createPersonalGoalSchema } from "./goal.schema";
import { calculateGoalUnlockDate } from "@/src/services/goal.service";

const validGoal = { name: "Future goal", currency: "XOF", targetAmount: "100.00", weeklyAmount: "25.00" };

test("a Personal Goal accepts today and future UTC date-only starts", () => {
  assert.equal(createPersonalGoalSchema.safeParse({ ...validGoal, startDate: new Date().toISOString().slice(0, 10) }).success, true);
  assert.equal(createPersonalGoalSchema.safeParse({ ...validGoal, startDate: "2030-12-31" }).success, true);
});

test("Personal Goal still rejects invalid calendar dates", () => {
  assert.equal(createPersonalGoalSchema.safeParse({ ...validGoal, startDate: "2030-02-29" }).success, false);
  assert.equal(createPersonalGoalSchema.safeParse({ ...validGoal, startDate: "2032-02-29" }).success, true);
});

test("future unlock dates derive from the chosen start date across a year boundary", () => {
  const unlockDate = calculateGoalUnlockDate({
    targetAmount: new Prisma.Decimal("100.00"),
    weeklyAmount: new Prisma.Decimal("25.00"),
    startDate: new Date("2030-12-31T00:00:00.000Z"),
  });
  assert.equal(unlockDate.toISOString().slice(0, 10), "2031-01-28");
});
