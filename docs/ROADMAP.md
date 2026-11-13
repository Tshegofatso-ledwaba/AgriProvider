# AgriProvider implementation roadmap

This roadmap reflects source code, automated checks, and development/test Neon verification as of 12 November 2026. Production Neon was not accessed or changed.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 1. Provider ownership and programmes | Implemented; live DB unverified | Authenticated provider-owned create/list/detail/update/archive. |
| 2. Programme management completion | Partially implemented; development/test PostgreSQL verified | Programme CRUD and factual activity counts are implemented. Learner password setup is available by one-time provider code. Sessions can be scheduled and listed chronologically, but there is no calendar-grid view; assessor assignments/reviews exist, but individual assessment scheduling is absent. |
| 3. Learner registration/management | Implemented; development/test DB verified | Minimal approved profile fields, provider-scoped CRUD/search, duplicate warning, archival, and read-only learner workspace. Provider issues a one-time setup code; learner sets a password and is linked to exactly one profile. No government ID collected. |
| 4. Learner enrolment | Implemented; live DB unverified | Provider-scoped create/list/detail, withdrawal/reactivation, history preservation, composite ownership FKs, and one-active-enrolment constraint. |
| 5. Attendance | Implemented; live DB unverified | Provider-scoped session scheduling/edit/archive, register/history, and atomic attendance upserts limited to present/absent/excused. |
| 6. Evidence requirements/checklists | Implemented; live DB unverified | Providers configure title/guidance checklist items per programme. No official items are pre-filled; no completion status is claimed without uploads. |
| 7. Evidence uploads/private documents | Implemented; disposable Neon migrations verified; production storage blocked | Provider-only uploads, version history, controlled reads, completion counts, and latest-unreviewed deletion use local development storage. Resubmission is correction-gated. PDF/JPEG/PNG up to 5 MB. |
| 8. Assessor assignment/review | Implemented; disposable Neon migration verified | Admin-only assignment/reassignment/deactivation; assigned-assessor queues and private reads of all versions; version-bound approval/correction decisions; provider feedback. |
| 9. Corrections/resubmissions | Implemented; disposable Neon migration verified | Providers may upload a new version only after `CORRECTION_REQUIRED`; decisions and feedback remain linked to prior versions. |
| 10. QA workflow | Implemented; migration 15 verified in a rolled-back transaction, not yet applied | Admin-scoped QA assignments, assigned assessment queue, private evidence/history access, immutable version-bound QA outcomes, and database-generated notifications. Findings and corrective actions (13 Nov 2026): QA records a finding on its own QA review with optional admin-configured category/severity and due date; provider responds; QA verifies, returns (reopens), and closes; immutable event history, derived overdue status, notifications, audit rows, and delete protection. Screens: `/qa/findings`, `/qa/findings/[id]`, record-finding form on `/qa/submissions/[id]`, `/provider/qa-actions`, `/provider/qa-actions/[id]`, `/admin/qa-finding-options`. Not yet: response attachments, scheduled overdue reminders, non-provider responsible users. |
| 11. Certification tracking | Not implemented | Displayed progress must use confirmed certification requirements; no learner is certified by this application. |
| 12. Milestone eligibility | Not implemented | No funding or eligibility conditions have been invented. This is separate from payment execution. |
| Dashboards, notifications, audit, final journey | Partial | Provider, assessor, learner, and QA summaries use persisted data. Existing database triggers generate operational notifications; an authenticated inbox now lists/marks them read for the recipient. Full audit review UI, notification preferences UI, corrective-action events, and the end-to-end golden journey remain. |

## Phase reconciliation

The checked-in numbering calls Phase 3 learner management and Phase 10 QA. The current request's “Phase 3” is treated as the QA findings/corrective-action extension; the existing roadmap numbering is preserved.

Phase 2 items confirmed incomplete against the broader workspace scope:

- Training-session create/edit/archive and a date-sorted list exist; a calendar/timetable grid and calendar navigation do not.
- Assessor assignment and evidence review are programme-scoped; dated individual assessment scheduling is not implemented.
- Programme activity counts and learner account setup are implemented. Account activation has no email/SMS delivery; providers share the expiring one-time code through an approved secure channel.

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
9. `server/migrations/202611090001_add_learner_user_link.sql`
10. `server/migrations/202611100001_create_notifications_audit_and_eligibility_configurations.sql`
11. `server/migrations/202611100002_create_qa_assignments_and_reviews.sql`
12. `server/migrations/202611110001_create_learner_account_invitations.sql`
13. `server/migrations/202611120001_fix_qa_review_notification_lookup.sql`
14. `server/migrations/202611120002_create_qa_findings_and_corrective_actions.sql`
15. `server/migrations/202611130001_extend_qa_findings_workflow.sql`

Migration 14 is recorded as applied on the development/test Neon database (checked 13 November 2026). Migration 15 has been verified by `test/qa-findings.integration.test.js`, which applies it inside a transaction that is rolled back; it has **not** been applied. Run `npm run migrate` from `server/` to apply it before using the findings screens.

Migrations 1–13 are recorded as applied on the user-confirmed development/test Neon database as of 12 November 2026. Programme progress and QA notification integration tests use synthetic records inside transactions and roll them back. Production Neon was not accessed or changed.

## Verification limits

- `server/npm test` exercises HTTP routes and authorization with in-memory query stubs. `server/npm run test:postgres` verifies programme progress aggregation, QA notification triggers, and the full QA findings workflow (real HTTP routes, scope boundaries, transitions, reopen, history, notifications, audit attribution, delete protection) against PostgreSQL when `AGRI_TEST_DATABASE_URL` is set; synthetic fixtures are rolled back.
- `mobile/npm run lint` and `mobile/npx tsc --noEmit` check the mobile application.
- From `mobile\`, `npx expo export --platform web` is a build check only; it is not an iOS/Android device test.
- The provider/assessor review path and assignment-scoped QA outcomes have API test coverage. QA corrective actions and eligibility remain unimplemented.
- Programme progress and QA notification generation were verified against PostgreSQL. Integration coverage for other constraints, version-bound reviews, and concurrent assignment/review operations remains a follow-up.

## Decisions required before later phases

1. Select private durable file storage before production; define migration of local files, file type/size policy, retention, and deletion handling. The development adapter is not production storage.
2. Confirm deployment procedures for trusted administrator provisioning and account recovery.
3. Implemented conservatively (13 Nov 2026), awaiting mentor confirmation: the programme's provider account owns responses; any actively assigned QA Officer may verify/return/close; learners see only a generic closure notification. Confirm whether a separate responsible user, response attachments, and overdue reminders are required, and supply the approved category/severity values.
4. Confirm certification tracking requirements and who may record a certification status.
5. Supply explicit milestone eligibility conditions. Do not execute payments or imply that eligibility means payment was made.
6. Confirm privacy/POPIA retention, consent, correction, access, and deletion processes for learner records and documents.

## Next implementation order

1. Add PostgreSQL integration tests for constraints, version-bound reviews, and concurrent assignment/review operations.
2. Before production, add a private durable storage adapter with controlled downloads and a migration plan for local records.
3. Apply migration 15 and confirm the QA findings decisions above.
4. Training calendar view and dated assessment scheduling (brief Phase 2).
5. Reports/analytics and an audit review interface (brief Phase 4), using only persisted data.
6. Add certification tracking and eligibility last, based only on approved requirements.
7. Add notification preferences/delivery channels only if approved; complete full audit review and device-level role navigation/golden journey testing.
