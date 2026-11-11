# AgriProvider implementation roadmap

This roadmap reflects source code, automated checks, and disposable Neon migration verification as of 10 November 2026. Production Neon was not accessed or changed.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1. Provider ownership and programmes | Implemented; live DB unverified | Authenticated provider-owned create/list/detail/update/archive. |
| 2. Programme management completion | Partially implemented | Programme CRUD and archive, learner lists, enrolment totals and session summaries exist. Dedicated progress calculations and a complete PostgreSQL-backed verification remain outstanding. |
| 3. Learner registration/management | Implemented; live DB unverified | Minimal approved data: full name, generated internal reference, optional phone/email, system timestamps/archive status. Provider-scoped search, pagination API, duplicate warning/confirmation, detail/update/archive. Provisioned learner accounts have a read-only dashboard for linked programmes, attendance, evidence history and assessor feedback. The learner-link migration has not been database-verified. No government ID collected. |
| 4. Learner enrolment | Implemented; live DB unverified | Provider-scoped create/list/detail, withdrawal/reactivation, history preservation, composite ownership FKs, and one-active-enrolment constraint. |
| 5. Attendance | Implemented; live DB unverified | Provider-scoped session scheduling/edit/archive, register/history, and atomic attendance upserts limited to present/absent/excused. |
| 6. Evidence requirements/checklists | Implemented; live DB unverified | Providers configure title/guidance checklist items per programme. No official items are pre-filled; no completion status is claimed without uploads. |
| 7. Evidence uploads/private documents | Implemented; disposable Neon migrations verified; production storage blocked | Provider-only uploads, version history, controlled reads, completion counts, and latest-unreviewed deletion use local development storage. Resubmission is correction-gated. PDF/JPEG/PNG up to 5 MB. |
| 8. Assessor assignment/review | Implemented; disposable Neon migration verified | Admin-only assignment/reassignment/deactivation; assigned-assessor queues and private reads of all versions; version-bound approval/correction decisions; provider feedback. |
| 9. Corrections/resubmissions | Implemented; disposable Neon migration verified | Providers may upload a new version only after `CORRECTION_REQUIRED`; decisions and feedback remain linked to prior versions. |
| 10. QA workflow | UI shell only | A role-restricted QA workspace explains that verification is unavailable; QA assignment scope, decision options, and return/review procedure require approval. No QA data or decisions are simulated. |
| 11. Certification tracking | Not implemented | Displayed progress must use confirmed certification requirements; no learner is certified by this application. |
| 12. Milestone eligibility | Not implemented | No funding or eligibility conditions have been invented. This is separate from payment execution. |
| Dashboards, notifications, audit, final journey | Partial/not implemented | Provider, assessor and learner summaries use API data; administrator assignment counts derive from assignment APIs. QA has an informational shell only. In-app notifications, full immutable audit history, and end-to-end golden journey are outstanding. |

## Implemented migrations

The SQL migration runner applies files in lexical order:

1. `server/migrations/202610290001_create_users.sql`
2. `server/migrations/202610300001_create_programmes.sql`
3. `server/migrations/202610300002_create_learners.sql`
4. `server/migrations/202610300003_create_enrolments.sql`
5. `server/migrations/202610300004_create_attendance.sql`
6. `server/migrations/202610300005_create_programme_evidence_requirements.sql`
7. `server/migrations/202610300006_create_evidence_submissions.sql`
8. `server/migrations/202611020001_create_assessor_assignments_and_evidence_reviews.sql`
9. `server/migrations/202611090001_add_learner_user_link.sql` (not verified against PostgreSQL)

Migrations 1–8 are recorded as applied on the confirmed disposable Neon test database. Migration 9 is not verified or applied by this task. Do not apply migrations to production Neon without explicit approval.

## Verification limits

- `server/npm test` exercises HTTP routes and authorization with an in-memory query stub. Migration checks inspect SQL text, not actual PostgreSQL behavior. The latest run passed 62 tests.
- `mobile/npm run lint` and `mobile/npx tsc --noEmit` check the mobile application.
- From `mobile\`, `npx expo export --platform web` is a build check only; it is not an iOS/Android device test.
- The provider/assessor evidence correction-and-approval path has API test coverage; QA and eligibility remain unimplemented.
- Migration execution was verified against disposable Neon; detailed workflow integration coverage against real PostgreSQL remains a follow-up because API tests use an in-memory SQL stub.

## Decisions required before later phases

1. Select private durable file storage before production; define migration of local files, file type/size policy, retention, and deletion handling. The development adapter is not production storage.
2. Confirm deployment procedures for trusted administrator provisioning and account recovery.
3. Define QA assignment scope, verification outcomes, and permitted transitions.
4. Confirm certification tracking requirements and who may record a certification status.
5. Supply explicit milestone eligibility conditions. Do not execute payments or imply that eligibility means payment was made.
6. Confirm privacy/POPIA retention, consent, correction, access, and deletion processes for learner records and documents.

## Next implementation order

1. Add PostgreSQL integration tests for constraints, version-bound reviews, and concurrent assignment/review operations.
2. Before production, add a private durable storage adapter with controlled downloads and a migration plan for local records.
3. Implement QA verification only after assignment scope and decision rules are approved.
4. Add certification tracking and eligibility last, based only on approved requirements.
5. Complete notifications, full audit history, and device-level role navigation/golden journey testing.
