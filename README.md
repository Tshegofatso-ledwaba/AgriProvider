# AgriProvider

AgriProvider is a mobile-first training-provider workspace built with Expo, React Native, TypeScript, Expo Router, and NativeWind. Its API uses Node.js, Express, JWT authentication, and PostgreSQL/Neon.

## Current implementation

- Provider registration, sign-in, secure token restoration, and sign-out.
- Provider-scoped programme create, list, detail, update, and archive.
- Programme detail includes provider-scoped counts for active and withdrawn enrolments, active sessions, recorded attendance, and latest evidence status. These counts do not represent official programme completion.
- Provider-scoped learner registration, search, detail, update, duplicate warning, and archive. Learner profiles store a generated internal reference, full name, optional phone/email, and system-managed timestamps; no government ID is collected.
- Providers can issue a one-time learner setup code; learners set their own password and access their linked programmes, attendance, evidence requirements, submission history, and assessor feedback. Learner uploads remain unavailable.
- QA Officers have an assignment-scoped queue, private assessment evidence/history, immutable version-bound outcomes, and notifications. Findings and corrective-action response/closure remain blocked pending approved workflow and visibility rules.
- Authenticated users can view and mark their own database-backed notifications read. No email, SMS, or push delivery is configured.
- Provider-scoped enrolment create/list/detail and active/withdrawn status, with one active learner-programme link enforced by PostgreSQL.
- Provider-scoped training sessions and attendance registers for `present`, `absent`, and `excused`.
- Provider-configured evidence checklist items per programme and provider-scoped learner evidence submissions, version history, controlled downloads, restricted deletion of the latest unreviewed version, and completion counts. No official checklist items are pre-filled; local file storage is development-only and no cloud storage is configured.
- Administrator-provisioned assessor assignments, assignment management, assigned-programme review queues, private evidence review, correction feedback, and immutable decisions linked to evidence versions. Public registration remains provider-only.
- NativeWind is the mobile UI styling system.

API tests use an in-memory PostgreSQL stub, with opt-in PostgreSQL integration tests for programme activity counts and QA notification triggers. Migrations 1–13 are applied on the user-confirmed development/test Neon database. Production Neon was not accessed or changed.

## Run locally

1. Follow [server setup](./server/README.md), using a dedicated development database and private server environment configuration.
2. Follow [mobile setup](./mobile/README.md) and set `EXPO_PUBLIC_API_URL` to a server address reachable from the device.
3. Run backend tests with `npm test` from `server/`; run mobile lint and type checks from `mobile/` with `npm run lint` and `npx tsc --noEmit`. The Expo web export is `npx expo export --platform web` from `mobile/`.

## Roadmap

See [docs/ROADMAP.md](./docs/ROADMAP.md) for phase status, implementation limitations, and approvals needed before assessor/QA decisions, certification, and milestone rules.
