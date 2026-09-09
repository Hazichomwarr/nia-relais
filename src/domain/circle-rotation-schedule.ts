import type { ContributionFrequency } from "@prisma/client";

// Extracted from circle.service.ts (7I.5), where roundDueDate and its UTC
// calendar helpers were previously private module-scope functions used
// only by activateCircle. They are shared here, unchanged, so the
// activation review (getDraftCircleActivationReview) computes the exact
// same proposed due dates that activateCircle will actually persist --
// never two independent implementations of calendar-month recurrence that
// could silently drift from each other. Behavior is identical to the
// original private functions this replaces, including original-day
// monthly recurrence and month-end clamping.
//
// Pure and framework-free: no Prisma client, no "server-only", safe to
// import from anywhere (a service, a Server Action, or a client
// component that only needs the date math for display).

export function addUtcDays(startDate: Date, days: number): Date {
  return new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate() + days,
  ));
}

/**
 * Adds whole calendar months, preserving the original day of month where
 * possible and clamping to the last day of the target month otherwise
 * (e.g. Jan 31 + 1 month -> Feb 28/29, not Mar 3).
 */
export function addUtcCalendarMonths(startDate: Date, months: number): Date {
  const targetMonthIndex = startDate.getUTCMonth() + months;
  const targetYear = startDate.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(startDate.getUTCDate(), lastDayOfTargetMonth),
  ));
}

/**
 * The due date for round `roundNumber` (1-indexed) of a circle with the
 * given frequency and start date. WEEKLY/BIWEEKLY use fixed day-count
 * offsets; MONTHLY uses calendar-month recurrence (see
 * addUtcCalendarMonths for its month-end clamping behavior).
 */
export function roundDueDate(
  circle: { readonly frequency: ContributionFrequency; readonly startDate: Date },
  roundNumber: number,
): Date {
  const completedIntervals = roundNumber - 1;
  if (circle.frequency === "WEEKLY") return addUtcDays(circle.startDate, completedIntervals * 7);
  if (circle.frequency === "BIWEEKLY") return addUtcDays(circle.startDate, completedIntervals * 14);
  return addUtcCalendarMonths(circle.startDate, completedIntervals);
}
