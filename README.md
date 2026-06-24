# NiaRelais

NiaRelais is a savings accountability platform designed to help individuals and communities stay committed to their financial goals.

The platform provides two products:

1. **Personal Goals** — save toward a personal objective with optional custodian verification.
2. **Savings Circles (SUSU)** — community-based rotating savings groups.

The mission of NiaRelais is simple:

> Help people keep the promises they make to themselves.

---

## Core Concepts

### Personal Goal

A user creates a savings goal and contributes toward it on a recurring basis.

Examples:

- Emergency Fund
- Business Capital
- Hajj Fund
- New Car
- School Tuition

An optional custodian can verify deposits to create additional accountability.

---

### Savings Circle (SUSU)

A circle administrator creates a savings group and adds members.

Members contribute periodically.

The collected amount is paid out to a designated member each round until every member has received a payout.

---

## Product Vision

NiaRelais is not a bank.

NiaRelais is not an investment platform.

NiaRelais is an accountability platform.

The product focuses on:

- Commitment
- Consistency
- Transparency
- Community Accountability

---

## System Architecture

### Multi-Tenant Architecture

Every activity occurs inside a RelaisGroup.

A RelaisGroup acts as a tenant boundary.

Examples:

- Hamza Personal Savings
- Family SUSU 2026
- Friends Savings Circle

All goals, deposits, members, and contributions belong to a RelaisGroup.

---

## Main Entities

### User

Represents a person using the platform.

### RelaisGroup

Represents a private savings space.

### GroupMember

Represents membership inside a RelaisGroup.

### PersonalGoal

Represents a personal savings objective.

### Deposit

Represents a contribution toward a PersonalGoal.

### SavingsCircle

Represents a SUSU group.

### CircleMember

Represents participation inside a SavingsCircle.

### Contribution

Represents a member contribution during a payout round.

### PayoutRound

Represents a payout cycle inside a SavingsCircle.

---

## Personal Goal Workflow

Create Goal
→ Record Deposit
→ Custodian Approval (optional)
→ Goal Progress Updates
→ Goal Completed
→ Goal Archived

### Goal States

ACTIVE
→ COMPLETED
→ ARCHIVED

### Deposit States

PENDING
→ APPROVED

PENDING
→ REJECTED

---

## Savings Circle Workflow

Create Circle
→ Add Members
→ Generate Member IDs
→ Start Circle
→ Members Contribute
→ Payout Round Completes
→ Next Round Begins
→ Circle Completed

### Circle States

DRAFT
→ ACTIVE
→ COMPLETED

or

DRAFT
→ ACTIVE
→ CANCELLED

### Contribution States

DUE
→ PAID

DUE
→ MISSED

---

## Authentication

### Personal Goal Users

Login using:

- Email
- Password

### Savings Circle Members

For MVP:

- Member ID
- Optional PIN

Circle administrators create members and distribute credentials.

---

## Technology Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

### Backend

- Next.js Route Handlers
- TypeScript

### Database

- PostgreSQL
- Prisma ORM

### Authentication

- Auth.js

### Validation

- Zod

### Forms

- React Hook Form

### Emails

- Resend

---

## Development Philosophy

Before writing code:

1. Define the business problem.
2. Define the workflow.
3. Discover entities.
4. Define entity states.
5. Design services.
6. Implement code.

Business first.
Code second.

---

## MVP Roadmap

### Phase 1

- User Registration
- Authentication
- Personal Goal Creation
- Goal Dashboard
- Deposit Recording

### Phase 2

- Custodian Verification
- Goal Completion
- Goal History

### Phase 3

- Savings Circle Creation
- Member ID Generation
- Contributions
- Payout Rounds

### Phase 4

- Notifications
- Reporting
- Mobile Application

---

## Author

Built by Hamza Mare

NiaRelais — Helping people stay committed to their goals.
