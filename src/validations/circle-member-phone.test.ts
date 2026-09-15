import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "@/src/i18n/dictionaries/en";
import { fr } from "@/src/i18n/dictionaries/fr";
import { addDraftCircleMemberSchema } from "@/src/validations/circle.schema";

const validMember = { displayName: "Amara", email: "", pin: "123456" };
const creationRepository = readFileSync(new URL("../repositories/circle.repository.ts", import.meta.url), "utf8");
const draftOwnerRepository = readFileSync(new URL("../repositories/circle-draft-owner.repository.ts", import.meta.url), "utf8");
const activeOwnerRepository = readFileSync(new URL("../repositories/circle-active-owner.repository.ts", import.meta.url), "utf8");
const memberDashboardRepository = readFileSync(new URL("../repositories/circle-member-dashboard.repository.ts", import.meta.url), "utf8");
const memberAuthSchema = readFileSync(new URL("./circle-member-auth.schema.ts", import.meta.url), "utf8");
const draftMemberList = readFileSync(new URL("../../app/(app)/circles/[circleId]/member-list.tsx", import.meta.url), "utf8");
const activeMemberList = readFileSync(new URL("../../app/(app)/circles/[circleId]/circle-member-read-list.tsx", import.meta.url), "utf8");
const memberWorkspacePage = readFileSync(new URL("../../app/member/circles/[circleId]/page.tsx", import.meta.url), "utf8");

test("draft-member phone input remains optional and preserves a valid entered number", () => {
  const withoutPhone = addDraftCircleMemberSchema.parse(validMember);
  const blankPhone = addDraftCircleMemberSchema.parse({ ...validMember, phone: "   " });
  const withPhone = addDraftCircleMemberSchema.parse({ ...validMember, phone: "+226 70 00 00 00" });

  assert.equal(withoutPhone.phone, undefined);
  assert.equal(blankPhone.phone, undefined);
  assert.equal(withPhone.phone, "+226 70 00 00 00");
});

test("draft-member phone validation accepts conservative international notation and rejects invalid values", () => {
  assert.equal(addDraftCircleMemberSchema.safeParse({ ...validMember, phone: "70 00 00 00" }).success, true);
  assert.equal(addDraftCircleMemberSchema.safeParse({ ...validMember, phone: "+1 (212) 555-0199" }).success, true);
  assert.equal(addDraftCircleMemberSchema.safeParse({ ...validMember, phone: "call me" }).success, false);
  assert.equal(addDraftCircleMemberSchema.safeParse({ ...validMember, phone: "123456" }).success, false);
});

test("phone is persisted and selected only for owner-authorized member reads", () => {
  assert.match(creationRepository, /phone: input\.phone \?\? null/);
  assert.match(draftOwnerRepository, /phone: true/);
  assert.match(activeOwnerRepository, /phone: true/);
  assert.doesNotMatch(memberDashboardRepository, /phone: true/);
  assert.doesNotMatch(memberAuthSchema, /phone/);
});

test("phone labels are localized without translating the entered number", () => {
  assert.equal(en.susu.phoneNumber, "Phone number");
  assert.equal(fr.susu.phoneNumber, "Numéro de téléphone");
  assert.equal(addDraftCircleMemberSchema.parse({ ...validMember, phone: "+226 70 00 00 00" }).phone, "+226 70 00 00 00");
  assert.match(draftMemberList, /member\.phone/);
  assert.match(activeMemberList, /member\.phone/);
  assert.doesNotMatch(memberWorkspacePage, /phone/);
});
