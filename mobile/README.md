# AgriProvider Mobile

An Expo and React Native client for AgriProvider. The sign-in and provider registration screens follow the supplied AgriProvider Figma prototype and use secure device storage for the API token.

## Run on your iPhone with Expo Go

1. Install [Expo Go](https://expo.dev/go) on your iPhone.
2. Start the API and apply its database migration using the instructions in [server/README.md](../server/README.md).
3. Copy `.env.example` to `.env` in this folder and set `EXPO_PUBLIC_API_URL` to the server's reachable address. For local web on the same computer, use `http://localhost:5000`; for a physical phone, use the computer's IP address on the same network as the phone, not `localhost` (for example, `http://192.168.1.25:5000`). If the phone is connected to the Windows Mobile Hotspot hosted by this computer, use the hotspot adapter address (commonly `http://192.168.137.1:5000`), not an IP assigned to a disconnected Wi-Fi adapter. Windows Firewall may need to allow inbound TCP port 5000 only from the phone's local network; do not disable the firewall globally. Configure the server's `WEB_ORIGIN` to the exact browser origin (for local Expo web, `http://localhost:8081`). The API URL is bundled into the app and must not contain secrets.
4. From this `mobile` folder, install dependencies and start the development server:

   ```bash
   npm install
   npm run dev
   ```

5. Scan the QR code shown in the terminal with your iPhone camera, then open the link in Expo Go. The Expo tunnel only connects to Metro; your phone must still be able to reach the API over the network.

To start Expo directly, use tunnel mode as well:

```bash
npx expo start --go --tunnel
```

For a faster local connection, use `npx expo start --go` when your iPhone and computer are on the same Wi-Fi network.

The mobile app supports provider registration, sign-in, session restoration and sign-out. Sign-in lets users select the expected account type, which the API verifies against the account's existing role; it does not grant or change roles. Public registration always creates a provider account. Assessor, QA and administrator accounts are provisioned through the trusted server CLI. Providers land on the provider dashboard, provisioned administrators land on assessor assignments, assessors land on their evidence-review workspace, and QA users see a dedicated informational workspace. Learners have Home, Programmes, Attendance, Evidence, and Profile navigation. Their read-only workspace shows linked enrolments, recorded attendance, configured evidence requirements, submission versions, and learner-visible assessor feedback from the authenticated learner API. Attendance percentages use present records divided by recorded attendance entries; no programme progress percentage is inferred. Learner uploads, notifications, announcements, QA verification, and official completion are not available in the current workflow. Authenticated screens include a role-specific menu and sign out. Pages with a parent route include a shared back button that returns to the previous screen or a suitable parent when opened directly; cancel actions use the same fallback behavior. SecureStore is used for the JWT. Providers can manage their own programmes and learners, enrolments, sessions, attendance, and evidence; see completion, assessment decisions and feedback; and submit a revised evidence version when corrections are requested. Provisioned administrators can assign, reassign, deactivate and reactivate assessors, with confirmation before assignment changes. Assigned assessors can see their programmes and learners, open private evidence versions, approve submissions or request corrections, and review decision history. QA assignment scope, decision rules and backend workflows are not approved or implemented; the QA workspace does not show simulated records or provide decision actions. Eligibility workflows are also not available.

Evidence selection uses the Expo SDK 58 DocumentPicker. The app allows PDF, JPEG, and PNG files up to 5 MB, shows transfer progress, submission statuses, completion counts and version history, and previews files retrieved through the authenticated API. Preview copies are kept in the app's OS-managed cache because Expo's preview call resolves when presentation starts, not when the viewer closes; the operating system may clear that cache. Server-side validation remains authoritative.

Evidence files are stored by a local development-only adapter on the API server, outside public static assets. This storage is not durable and is not production-ready. No external storage account or cloud integration is required or configured. See [the server evidence-storage notes](../server/README.md#evidence-submissions-and-development-storage).

## Styling

NativeWind utility classes are the mobile application's styling system. Its Tailwind content paths, Babel preset, and Metro integration are configured for files under `src/`; global styles are imported by `src/app/_layout.tsx`. Use `className` for UI layout, spacing, color, typography and responsive or dark-mode variants. Do not add `StyleSheet`, CSS modules, or inline style objects for UI styling. Keep framework-required navigation appearance props and runtime-driven animation values only where the native API requires them.

## Start developing

- `src/app/index.tsx` is the Home tab.
- `src/app/explore.tsx` is the Explore tab.
- `src/app/programmes/` contains the provider programme list, create, details and edit routes.
- The programme details flow includes provider-managed evidence checklist setup.
- `src/app/learners/` contains provider learner registration, search, details, edit, and archive routes.
- `src/app/learner/` contains the learner dashboard, programme list, attendance summary, and evidence checklist.
- `src/app/enrolments/` contains provider enrolment selection, list, detail, withdrawal, and reactivation routes.
- `src/app/enrolments/[id]/evidence.tsx` lists configured checklist items for an enrolment, uploads documents, and shows status, completion, history, and authorized previews.
- `src/app/admin/` contains administrator assessor assignments.
- `src/app/assessor/` contains the assigned-programme dashboard, learner/evidence queue, and version-specific review screen.
- `src/app/sessions/` contains session scheduling, editing, archival, and attendance register routes.
- `src/app/_layout.tsx` sets up the app theme and tab navigation.
- `src/components/` contains reusable UI components.
- `src/providers/auth-provider.tsx` restores and shares the authenticated session across routes.
- Web authentication uses an HttpOnly server cookie and does not store bearer tokens in browser storage; native authentication continues to use Expo SecureStore.
- `src/services/` contains the API client and programme API functions.
- `src/constants/theme.ts` contains shared theme values.

Run `npm run lint` and `npx tsc --noEmit` to check the app.

The project uses Expo SDK 58. Keep new native dependencies compatible with Expo Go, and use `npx expo install <package>` to install Expo or React Native packages at compatible versions.
