# AgriProvider API

The backend uses Express and PostgreSQL on Neon. Its environment configuration belongs in an untracked `server/.env` file.

## Run locally

1. Install dependencies from this directory with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to the connection string from Neon, replace `JWT_SECRET` with a long, random value, and set `WEB_ORIGIN` to the exact browser origin (for local Expo web, `http://localhost:8081`). Non-production server runs default to that local origin when `WEB_ORIGIN` is omitted; production requires an explicit HTTPS origin. Keep private values private.
4. Apply the database migrations with `npm run migrate`.
5. Start the API with `npm run dev` or `npm start`.
6. Open `http://localhost:5000/health`. A successful response confirms the API can query the configured database.

## Authentication

- `POST /api/auth/register` creates a provider account. A submitted role is ignored; public registration cannot grant assessor, QA, or administrator access.
- `POST /api/auth/login` returns a signed one-hour JWT for native clients. It accepts an optional `accountType` (`provider`, `assessor`, `qa`, or `admin`) to verify the selected sign-in type against the account's existing role; it never changes roles. Web requests use `X-Auth-Mode: cookie` from the configured `WEB_ORIGIN`; they receive an HttpOnly, SameSite=Strict cookie instead of a token in the response.
- `POST /api/auth/learner-activation` accepts a provider-issued one-time setup token and a learner password. Tokens expire after 24 hours, are stored only as hashes, and are consumed atomically with learner account creation and profile linking. This endpoint is rate limited; public registration remains provider-only.
- Transient database connection failures return HTTP 503 with a retry-safe message; the API does not retry database writes automatically.
- `POST /api/auth/logout` clears the web session cookie.
- `GET /api/auth/me` returns the authenticated user's profile and requires either `Authorization: Bearer <token>` or the web session cookie.
- `GET /api/notifications?unreadOnly=true|false&category=<category>&limit=<n>&offset=<n>` lists only the authenticated user's notifications and unread count. `PATCH /api/notifications/:id/read` marks only the caller's notification read; other recipients receive 404.
- Authentication endpoints are rate limited. Passwords must be between 12 and 72 UTF-8 bytes and are stored as bcrypt hashes.
- The web cookie is Secure in production, scoped to `/api`, and is sent only with credentialed CORS requests from the exact configured `WEB_ORIGIN`. Configure the web app and API on the same site; production must use HTTPS.
- Create administrator, assessor, or QA accounts only from a trusted server terminal with `npm run create-privileged-user -- <admin|assessor|qa> user@example.com "Full Name"`. The password is entered without terminal echo. Do not expose this command through an API or mobile screen.

Run backend tests with `npm test`. Run the PostgreSQL integration tests (programme progress, QA notifications, and the QA findings workflow over real HTTP routes) with `npm run test:postgres` after setting `AGRI_TEST_DATABASE_URL` to a disposable development/test database. Synthetic rows are inserted inside transactions and rolled back.

The backend includes provider authentication and provider-scoped programme, learner, enrolment, training-session, attendance, evidence-checklist, and evidence-submission APIs, plus administrator-managed assessor assignment and assigned-assessor review APIs. Learner profiles use only the approved minimal fields: full name, generated internal reference, optional phone/email, and system-managed timestamps. Duplicate name/contact matches trigger a 409 warning which the provider can explicitly confirm. Archiving a learner withdraws their active enrolments while preserving history.

### Learner workspace

The authenticated `GET /api/learner/dashboard` endpoint is restricted to learner accounts. It resolves a learner profile using its explicit `learner_user_id` link, with a legacy email match only when that profile has no user link. Ambiguous profile matches return `409`; a learner cannot select another learner's ID. The response includes that learner's enrolments, provider names, recorded attendance, configured evidence requirements, all submission versions, and feedback linked to each version. The endpoint is read-only. Provider-issued learner setup codes are single-use, hashed at rest, and expire after 24 hours; no email/SMS delivery is configured. Learners can read their own notification records; private QA comments and findings are not exposed. Learner evidence uploads, announcements, and official programme-completion state are not implemented.

## Provider programmes

Provider accounts manage their own programmes through these authenticated endpoints:

- `GET /api/programmes` lists active programmes owned by the signed-in provider.
- `POST /api/programmes` creates a programme with a required `name` and optional `description`.
- `GET /api/programmes/:id` retrieves an owned programme.
- `GET /api/programmes/:id/progress` returns active/withdrawn enrolments, active sessions, recorded attendance by status, and latest evidence status counts across active enrolments and configured requirements. It reports counts only and does not determine official programme completion.
- `PATCH /api/programmes/:id` updates `name` and/or `description`.
- `DELETE /api/programmes/:id` archives an owned programme; archived programmes are excluded from normal reads.

The API derives ownership from the authenticated user. It does not accept a provider ID from the client, and assessor/QA roles are denied these routes. Programme names are limited to 160 characters; descriptions are optional and limited to 2000 characters. These are basic application fields only, not formal accreditation or funding requirements.

No separate provider-profile table is included: the existing `users` row is the provider account identity, and no additional approved provider profile fields are required for this phase. `programmes.provider_user_id` references that user with a foreign key. Application authorization ensures only users with the provider role can manage programmes. Archiving uses a timestamp so future related records are not deleted with a programme.

### Applying the programme migration

The migration `migrations/202610300001_create_programmes.sql` has not been applied by development or tests. To apply it intentionally to a database:

1. Back up or create a disposable PostgreSQL database before a first test run.
2. From the `server` directory, configure `DATABASE_URL` locally in `server/.env` and confirm privately that it points to the intended database. Never paste the value into logs, chat, source code, or mobile configuration.
3. Run `npm run migrate` from the `server` directory. The migration runner applies pending files in order and records them in `schema_migrations`.
4. Verify the table and index in the intended database using your approved database console.

Do not run this command against production/Neon until the target is confirmed and the migration is explicitly approved. The implementation and tests in this repository do not verify a live Neon database.

Run API and authorization tests with `npm test`; the suite uses an in-memory database stub and does not apply migrations.

### Learners

The migration `migrations/202610300002_create_learners.sql` creates provider-owned learner records. The API supports:

- `GET /api/learners?q=<prefix>&status=active|archived|all&limit=1..100&offset=<n>` — provider-scoped search and pagination by name or internal reference.
- `POST /api/learners` — register a learner using `fullName` and optional `phone`/`email`.
- `GET /api/learners/:id` and `PATCH /api/learners/:id` — retrieve or update an owned record.
- `DELETE /api/learners/:id` — archive the record and withdraw its active enrolments.

The API generates the internal reference. Possible name/contact matches return a `409` with code `POSSIBLE_DUPLICATE`; the provider can explicitly confirm the new record with `confirmPossibleDuplicate: true`. This is a warning, not a hard duplicate identity rule. No national identity/document number is collected.

Providers can create a setup code for a learner with `POST /api/learners/:id/activate-account`. The response contains the code once; issuing a replacement revokes any prior unused code. Share it with the learner through an approved secure channel. The application does not send email or SMS invitations. The migration `202611110001_create_learner_account_invitations.sql` must be applied before using this flow.

### Enrolments

The migration `migrations/202610300003_create_enrolments.sql` creates provider-scoped learner-programme relationships with composite foreign keys that prevent cross-provider relationships. Endpoints:

- `GET /api/enrolments?learnerId=<uuid>&programmeId=<uuid>&status=active|withdrawn|all`
- `POST /api/enrolments` with `learnerId` and `programmeId`.
- `GET /api/enrolments/:id`.
- `PATCH /api/enrolments/:id` with `{"status":"active"}` or `{"status":"withdrawn"}`.

Withdrawal preserves history; one active enrolment per learner/programme pair is enforced by a partial unique index. Reactivation can fail with `409` if another active enrolment already exists.

### Sessions and attendance

The migration `migrations/202610300004_create_attendance.sql` creates provider-owned training sessions and attendance records with composite same-provider/programme foreign keys. Endpoints:

- `GET /api/sessions?programmeId=<uuid>` — list sessions and real active-enrolment/attendance counts.
- `POST /api/sessions` — create a session with `programmeId`, `title`, and timezone-bearing ISO 8601 `startsAt`.
- `GET /api/sessions/:id`, `PATCH /api/sessions/:id` (title/start time), and `DELETE /api/sessions/:id` (archive).
- `GET /api/sessions/:id/attendance` — return the active-enrolment register, each recorded state, and summary counts.
- `PUT /api/sessions/:id/attendance` — upsert one or more records with `enrolmentId` and `status`.

Attendance accepts only `present`, `absent`, and `excused`; the database prevents duplicate records for a session/enrolment. The API derives the actor and provider from the authenticated user and rejects records for another programme/provider. Attendance submission is a single atomic PostgreSQL statement, and invalid batches do not partially write.

### Evidence checklist configuration

The migration `migrations/202610300005_create_programme_evidence_requirements.sql` stores provider-defined checklist items for an owned programme. Providers can configure only the title and optional guidance; every item is scoped to the authenticated provider and programme. The API never accepts a provider ID from the client.

- `GET /api/programmes/:programmeId/evidence-requirements` lists active checklist items.
- `POST /api/programmes/:programmeId/evidence-requirements` creates an item with `title` and optional `guidance`.
- `GET /api/programmes/:programmeId/evidence-requirements/:id` retrieves an owned item.
- `PATCH /api/programmes/:programmeId/evidence-requirements/:id` updates its title and/or guidance.
- `DELETE /api/programmes/:programmeId/evidence-requirements/:id` archives the item.

Titles are limited to 160 characters and guidance to 2000 characters. No standard or official items are seeded. The mobile app keeps checklist configuration separate from learner evidence submissions.

### Evidence submissions and development storage

The migration `migrations/202610300006_create_evidence_submissions.sql` creates versioned, provider/programme/enrolment/checklist-linked metadata. File bytes are never stored in PostgreSQL. Only the authenticated provider may use these endpoints:

- `POST /api/enrolments/:enrolmentId/evidence-requirements/:requirementId/submissions` — upload one multipart field named `file`.
- `GET /api/enrolments/:enrolmentId/evidence-submissions` — list the active configured checklist with each latest submission and completion counts.
- `GET /api/evidence-submissions/:submissionId` — retrieve submission metadata.
- `GET /api/evidence-submissions/:submissionId/history` — list prior versions, newest first.
- `GET /api/evidence-submissions/:submissionId/file` — retrieve the authorized file as an attachment.
- `DELETE /api/evidence-submissions/:submissionId` — delete the provider's latest `SUBMITTED` version. Earlier versions remain in history; reviewed and approved submissions cannot be deleted.

Uploads accept PDF, JPEG, or PNG files up to 5 MB. The server verifies magic bytes, MIME type and filename extension, and records the detected MIME type and SHA-256 digest. Identical consecutive uploads return `409 DUPLICATE_SUBMISSION`. Uploads start as `SUBMITTED`; only an assessor's `CORRECTION_REQUESTED` decision allows a revised version. `APPROVED` and unreviewed submitted versions cannot be replaced. Providers may delete only the latest unreviewed `SUBMITTED` version; reviewed versions and prior history are protected. Completion counts use each checklist item's latest version, and uploads never auto-approve evidence.

The storage adapter interface is `provider`, `save(buffer)`, `read(storageKey)`, and `delete(storageKey)`. The default `local-development` adapter stores opaque UUID-named blobs under `server/.local-evidence/`, outside public assets, and uses temporary files with cleanup on failure. Set optional `EVIDENCE_STORAGE_DIR` in `server/.env` to a directory path; relative paths resolve from `server/`. The folder is git-ignored. Local disk is not durable or production-ready. The API refuses to start in production unless an explicit private storage adapter is configured.

The mobile app uses the SDK-compatible Expo DocumentPicker, displays upload progress and completion statuses, supports version history, and retrieves authorized files to the app's OS-managed cache for native preview. The copy is not immediately deleted because Expo's preview call resolves when presentation starts, not when the viewer closes; the operating system may clear its cache.

To add private cloud storage later, implement the same storage interface in `server/src/storage/`, register the adapter in server configuration, and preserve provider/ownership checks in the evidence router. A production adapter must implement private storage, authenticated upload, controlled or signed downloads, deletion, stable metadata keys, and an intentional plan for existing local records. Do not copy local keys into the cloud adapter without migrating the corresponding file bytes and verifying ownership. No cloud account, configuration, or integration is included.

Migrations through `202611020001_create_assessor_assignments_and_evidence_reviews.sql` have been applied and verified against a user-confirmed disposable Neon test database. Production Neon was not accessed or changed. API tests still use an in-memory SQL stub and a temporary local filesystem directory; they do not replace PostgreSQL integration tests.

### Phase 8: assessor assignment and review

Migration `migrations/202611020001_create_assessor_assignments_and_evidence_reviews.sql` adds the provisioned `admin` role, programme assessor assignments, and immutable evidence review rows tied to an exact submission version and assignment. Active duplicate assessor/programme pairs are prevented by a partial unique index. Reassignment deactivates the prior row and creates a new row; reviews preserve the original assignment reference.

Administrator endpoints (JWT role `admin`):

- `GET /api/admin/assessors` and `GET /api/admin/programmes` list active assessors and programmes.
- `GET /api/admin/assessor-assignments` lists assignment history.
- `POST /api/admin/assessor-assignments` accepts `programmeId` and `assessorUserId`.
- `PATCH /api/admin/assessor-assignments/:assignmentId` accepts `{"status":"ACTIVE"}` or `{"status":"INACTIVE"}`, or `{"assessorUserId":"<uuid>"}` to reassign while retaining the prior assignment.

Assessor endpoints (JWT role `assessor`; programme access requires an active assignment):

- `GET /api/assessor/programmes` returns assigned programmes with learner and latest-evidence counts.
- `GET /api/assessor/programmes/:programmeId/learners` lists active enrolled learners.
- `GET /api/assessor/programmes/:programmeId/submissions?status=all|SUBMITTED|APPROVED|CORRECTION_REQUIRED|UNDER_REVIEW` lists the latest submission per requirement.
- `GET /api/assessor/submissions/:submissionId` and `GET /api/assessor/submissions/:submissionId/file` return assigned evidence metadata and an authorized private file.
- `GET /api/assessor/submissions/:submissionId/history` lists every version for that assigned requirement; each version file remains available through the same authorized file endpoint.
- `GET /api/assessor/submissions/:submissionId/reviews` returns decisions across all versions for that requirement.
- `POST /api/assessor/submissions/:submissionId/reviews` accepts `{"decision":"APPROVED"}` or `{"decision":"CORRECTION_REQUESTED","feedback":"..."}`. Correction feedback is mandatory. A decision is accepted only for the current `SUBMITTED` version and is immutable.

Provider submission history now includes assessor decisions and feedback. Providers can upload a revised version only after `CORRECTION_REQUIRED`; the new version starts as `SUBMITTED` and receives its own review. Public registration remains provider-only. Create administrator accounts with the trusted CLI described above.

QA assignments, assessment review, immutable QA outcomes, and generated in-app notifications are implemented.

### QA findings and corrective actions

Migrations `202611120002_create_qa_findings_and_corrective_actions.sql` and `202611130001_extend_qa_findings_workflow.sql` add findings linked to an exact QA review, administrator-configured categories/severities, optional due dates, an immutable event history, database-generated notifications, row-level audit events, and delete protection.

Workflow (enforced on the server; any other transition returns `409`):

| Action | Role | From | To |
|---|---|---|---|
| Record finding | QA Officer who recorded the QA review, with an active assignment | — | `OPEN` |
| Respond | Programme's provider | `OPEN` | `RESPONSE_SUBMITTED` |
| Return for further action (reopen) | Any QA Officer actively assigned to the programme | `RESPONSE_SUBMITTED` | `OPEN` |
| Verify | Any QA Officer actively assigned to the programme | `RESPONSE_SUBMITTED` | `VERIFIED` |
| Close | Any QA Officer actively assigned to the programme | `VERIFIED` | `CLOSED` |

A returned response is cleared from the finding row but kept in the event history. "Overdue" is derived (`due_date` before the database's current date while `OPEN` or `RESPONSE_SUBMITTED`) and is never stored. No categories or severities are seeded; administrators enter the organisation's approved values. Learners receive only a generic "QA status updated" notification on closure; finding text and QA review comments are never exposed to learners, and providers never see the internal QA review comments.

QA Officer endpoints (JWT role `qa`):

- `GET /api/qa/findings?status=all|OPEN|RESPONSE_SUBMITTED|VERIFIED|CLOSED|OVERDUE&programmeId=&limit=&offset=` returns findings in the officer's active programme scope with status counts.
- `GET /api/qa/findings/options` lists active categories and severities.
- `POST /api/qa/findings` accepts `qaReviewId`, `finding`, `correctiveAction`, and optional `categoryId`, `severityId`, `dueDate` (`YYYY-MM-DD`, not in the past). An identical unresolved finding on the same review returns `409`.
- `GET /api/qa/findings/:findingId` returns the finding and its history.
- `POST /api/qa/findings/:findingId/verify|return|close` accepts `{"comments":"..."}` (required).

Provider endpoints (JWT role `provider`, own programmes only):

- `GET /api/provider/qa-findings` (same filters) and `GET /api/provider/qa-findings/:findingId`.
- `POST /api/provider/qa-findings/:findingId/response` accepts `{"response":"..."}` (required).

Administrator endpoints (JWT role `admin`):

- `GET /api/admin/qa-finding-options` lists all options with usage counts.
- `POST /api/admin/qa-finding-options` accepts `{"kind":"CATEGORY"|"SEVERITY","label":"..."}`; duplicate labels (case-insensitive) return `409`.
- `PATCH /api/admin/qa-finding-options/:optionId` accepts `label` and/or `isActive`. Options are deactivated, not deleted, so existing findings keep their label.

Not yet implemented in this module: file attachments on corrective-action responses, scheduled overdue reminders, and assignment of a responsible user other than the programme's provider account.

Certification, eligibility, payment processing, notification preferences/delivery channels, and a complete audit review interface are not implemented; see [the project roadmap](../docs/ROADMAP.md). Production Neon was not accessed or changed.
