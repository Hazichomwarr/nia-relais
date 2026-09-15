-- Additive lifecycle state: preserves unfinished goals and their history
-- without misrepresenting them as completed or deleting deposits/custody.
ALTER TYPE "GoalStatus" ADD VALUE 'ABANDONED';
