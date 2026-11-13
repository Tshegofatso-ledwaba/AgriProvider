# AgriProvider Test Case Document

## 1. Project Overview

AgriProvider is a mobile-first training-provider and quality-assurance workspace built with Expo, React Native, TypeScript, Expo Router, NativeWind, Express, JWT auth, and PostgreSQL/Neon. The acceptance criteria are verified through backend tests, TypeScript checks, linting, and role-based workflow validation.

## 2. Scope

- Provider registration and authentication
- Provider programme, learner, enrolment, attendance, and evidence management
- Admin assignment and assessor review workflow
- Assignment-scoped QA review and access restrictions
- Recipient-scoped notification inbox and read state
- Protected routes and authorization checks
- Error handling and duplicate validation
- Local development configuration and environment setup

## 3. Test Environment

- Backend: Node.js + Express
- Database: PostgreSQL compatible test flow; project tests use in-memory database stubs for API validation
- Mobile frontend: Expo + React Native + TypeScript
- Verification run: `cd server && npm test`
- Mobile compile/lint checks: `cd mobile && npm run lint` and `npx tsc --noEmit`

## 4. Verification Summary

- Backend API test suite: PASS
- Mobile lint: PASS
- TypeScript compile check: PASS
- QA outcomes: assignment-scoped, immutable, and version-bound; findings/corrective actions remain pending workflow approval
- Notification inbox: recipient isolation and read updates tested; PostgreSQL QA triggers verified on the development/test database

## 5. Test Cases

### TC-01: Provider registration
- Objective: Validate provider self-registration remains allowed.
- Steps:
  1. POST `/api/auth/register` with valid full name, email, and password.
  2. Confirm a provider account is created.
  3. Confirm the role is forced to `provider`.
- Expected result: 201 Created and a provider profile is returned.

### TC-02: Duplicate email prevention
- Objective: Prevent duplicate registrations.
- Steps:
  1. Register the same email twice.
- Expected result: 409 Conflict with a safe duplicate-email error.

### TC-03: Provider login
- Objective: Validate provider sign-in flow.
- Steps:
  1. POST `/api/auth/login` with provider email and password.
- Expected result: 200 OK with token or cookie-based session, and a valid `/api/auth/me` response.

### TC-04: Invalid credentials rejection
- Objective: Ensure login does not leak account existence.
- Steps:
  1. Submit bad email or password.
- Expected result: 401 Unauthorized with a generic error.

### TC-05: Admin assignment permission
- Objective: Confirm admin-only assignment management.
- Steps:
  1. Sign in as admin and create an assessor assignment.
  2. Repeat as provider or assessor.
- Expected result: Admin succeeds; other roles are denied.

### TC-06: Assessor review access
- Objective: Ensure an assessor can review assigned evidence without accessing provider-only endpoints.
- Steps:
  1. Create a programme and evidence upload.
  2. Assign an assessor.
  3. Fetch review queue and decision pages.
- Expected result: Access granted only for assignment-linked records.

### TC-07: Programme CRUD
- Objective: Validate provider-scoped programme create/list/update/archive actions.
- Steps:
  1. Create a programme.
  2. Fetch list and detail.
  3. Update name/description.
  4. Archive it.
- Expected result: correct ownership, validation, and archiving behavior.

### TC-08: Learner registration and duplicate risk
- Objective: Validate provider-managed learner creation and warning logic.
- Steps:
  1. Create learner with a full name and optional contact details.
  2. Attempt near-duplicate record.
- Expected result: new learner created; duplicate warning returns 409 with confirm flag requirement.

### TC-09: Enrolment creation and uniqueness
- Objective: Ensure each learner may have one active enrolment per programme.
- Steps:
  1. Enrol learner into a programme.
  2. Try another active enrolment for the same pair.
- Expected result: second active enrolment is rejected.

### TC-10: Attendance recording
- Objective: Ensure attendance can only be recorded for provider-owned sessions and enrolments.
- Steps:
  1. Create session.
  2. Record `present`, `absent`, and `excused` states.
- Expected result: valid states persist; invalid states fail.

### TC-11: Evidence upload validation
- Objective: Verify file validation and size limits.
- Steps:
  1. Upload valid PDF/JPEG/PNG under 5 MB.
  2. Upload invalid file or oversized file.
- Expected result: valid upload succeeds; invalid upload fails with safe message.

### TC-12: Evidence access control
- Objective: Confirm evidence is private and provider-scoped.
- Steps:
  1. Upload a file as provider.
  2. Attempt access via another provider or non-provider role.
- Expected result: access denied or returns empty/authorization error.

### TC-13: Assessor correction flow
- Objective: Validate decision history and resubmission gating.
- Steps:
  1. Create review decision requiring correction.
  2. Upload a new version after the correction state.
- Expected result: new version is accepted only after an explicit correction decision.

### TC-14: QA assignment scope and immutable outcome
- Objective: Ensure QA review is distinct from assessor decisions and limited to assigned programmes.
- Steps:
  1. Sign in as a QA Officer with an active programme assignment.
  2. Open the assigned assessment and record a QA outcome.
  3. Attempt to access an unassigned programme or record another QA outcome for the same assessor review.
- Expected result: assigned evidence is readable; unassigned records are denied; QA outcome is a separate immutable record linked to the exact assessor review/version.

### TC-15: Web origin/session authentication
- Objective: Validate cookie-based checkout and origin control.
- Steps:
  1. Sign in from the configured web origin.
  2. Attempt the same from a disallowed origin.
- Expected result: valid web origin is accepted; invalid origins are rejected.

### TC-16: Error and retry safety
- Objective: Check server-level safe errors.
- Steps:
  1. Trigger invalid JSON, invalid route, missing auth, and DB outage conditions.
- Expected result: no stack traces are exposed; user-safe errors are returned.

### TC-17: Notification inbox ownership
- Objective: Ensure each role can read and mark only its own persisted notifications.
- Steps:
  1. Sign in as QA, provider, or learner and list notifications.
  2. Mark one notification as read.
  3. Attempt to mark another user's notification as read.
- Expected result: only the recipient's notifications are returned or updated; other recipients' records return 404.

## 6. Known limitations

- QA assessment outcomes and notification events are implemented. Persisted findings/corrective actions, provider response permissions, corrective-action verification/closure, and their visibility rules remain pending confirmation.
- Email, SMS, and push notification delivery are not configured.
- Certification and milestone eligibility remain out of scope.
- Production Neon and cloud storage are not configured here.
- Local evidence storage is development-only and not production-ready.

## 7. Final status

The project has assignment-scoped QA assessment outcomes and a recipient-scoped in-app notification inbox. Corrective-action workflow remains incomplete until its authorized roles, visibility, and transitions are confirmed.
