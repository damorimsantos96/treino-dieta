# Treino & Dieta — Project Guide

## Mission
- Personal fitness, nutrition, hydration, running, and PR tracking app.
- Primary target is Android APK via Expo/EAS; web exists mainly as a support surface and deploy target.
- Backend is Supabase (Postgres + Auth + Edge Functions).
- Core promise: centralize manual logs plus imported data from Garmin, Whoop, and Health Connect.

## Project Shape
- This folder IS the project root. `Dieta e Treino.xlsx` (historical import) is at the repo root.
- Frontend stack: Expo 55, React Native 0.83, Expo Router, React Query, Zustand, NativeWind.
- Styling is dark theme with utility classes plus inline style objects.
- No heavy service layer; screens call hooks and `src/lib/api.ts` directly.

## Runtime Targets
- Android is the main product target.
- iOS config exists, but Health Connect and most automation assumptions are Android-centric.
- Web is supported through Expo export and Vercel rewrite to `index.html`.

## Important Commands
- `npm run start` — starts Expo
- `npm run android` — launches Android dev flow
- `npm run web` — runs web locally
- `npm run typecheck` — TS validation
- `npm run doctor` — Expo Doctor
- `npm run check` — env check + typecheck + doctor + audit
- `npm run check:build-env` — validates Supabase env before builds
- `npm run check:supabase` — validates DNS and `/auth/v1/health`
- `npm run check:functions:garmin` — Deno type-check for Garmin function
- `npm run deploy:garmin` — deploys `sync-garmin`

## Build / Deploy
- Expo config is in `app.json`.
- OTA updates use Expo Updates and EAS channels `preview` and `production`.
- `runtimeVersion.policy = appVersion`, so native-breaking releases must bump the app version.
- Web deploy uses `vercel.json` with `npx expo export --platform web` and output dir `dist`.
- Native version enforcement is backed by Supabase table `app_version_config`.

## Environment
- Local runtime env: `.env.local`.
- Required public vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- `app.json` also contains Supabase URL/key under `expo.extra`; config works without `.env.local`.
- Edge functions require Supabase secrets plus provider secrets in the Supabase project env.
- `scripts/import-excel.mjs` needs service role credentials in `scripts/.env`.

## Navigation Map
- `app/_layout.tsx` — wires QueryClient, auth session bootstrap, updates, automation, notification channel.
- `app/index.tsx` — redirects to login or `/(tabs)/hoje`.
- `app/(auth)/login.tsx` — password login plus optional biometric unlock.
- `app/(tabs)/_layout.tsx` — authenticated shell.
- Hidden route: `registrar` is not in the tab bar but is used from the Hoje/edit flow.

## Main Screens
- `hoje.tsx` — day summary, TDEE, hydration target, nutrition target, Whoop cards, quick edit entry.
- `registrar.tsx` — manual daily log editor for body metrics, activities, sauna, other kcal.
- `corridas.tsx` — running history, charts, manual run creation, delete/reimport sync behavior.
- `agua.tsx` — hydration target, presets, manual intake logging, notification settings.
- `prs.tsx` — PR movements, attempts, charts, reseeding default CrossFit benchmarks.
- `analises.tsx` — trends for weight, TDEE, running volume/pace, training volume.
- `configuracoes.tsx` → `src/screens/ConfiguracoesScreen.tsx` — profile, integrations, biometrics, sign-out.

## Data Access Pattern
- React Query is the default fetch/cache layer.
- Most server operations live in `src/lib/api.ts`.
- Auth state is the only Zustand store (`src/stores/auth.ts`).
- Supabase client lives in `src/lib/supabase.ts` and uses SecureStore or localStorage.

## Core Domain Tables
- `user_profiles` — name, birth date, height.
- `daily_logs` — central fact table for weight, kcal/min/temp/bpm by activity, surplus, water, Whoop data.
- `run_activities` — top-level runs.
- `run_sessions` — run intervals/laps tied to a run activity.
- `pr_movements` — PR definitions with unit and lower-is-better flag.
- `pr_attempts` — dated PR attempts and current PR marker.
- `integration_tokens` — provider tokens/sessions/state.
- `activity_imports` — idempotency markers for provider imports.
- `user_app_settings` — hydration and Health Connect automation settings.
- `water_presets`, `water_intakes` — hydration UX and consumption tracking.
- `app_version_config` — minimum supported runtime and APK URL.

## Important Migrations
- `001_initial_schema.sql` — initial app tables, indexes, RLS.
- `002_nutrition_tracking.sql` — adds `water_consumed_ml`.
- `003_add_ciclismo.sql` — extends schema for cycling.
- `004_fix_garmin_unique.sql` — fixes Garmin uniqueness on run sessions.
- `005_run_activities_and_imports.sql` — normalized run activity model and import markers.
- `006_app_version_config.sql` — forced-native-update gate.
- `007_water_and_health_connect.sql` — hydration tables, app settings, water sync trigger.
- `008_whoop_other_minutes.sql` — support for Whoop imports mapped as `outros`.

## Daily Log Semantics
- `daily_logs` is the product center; almost all dashboards derive from it.
- Manual activities write directly to activity-specific kcal/min/temp/bpm columns.
- Garmin sync populates `run_activities` and `run_sessions`, then rolls minutes into `daily_logs.min_corrida`.
- Manual run creation also syncs back into `daily_logs`.
- Whoop import writes kcal/min/bpm directly into `daily_logs` and records an `activity_imports` marker.
- Water intake trigger updates `daily_logs.water_consumed_ml`.
- Health Connect sync upserts `daily_logs.weight_kg`.

## Calculation Rules
- `src/utils/calculations.ts` is the source of truth for TDEE, water target, protein, carbs, pace, duration.
- TDEE combines BMR estimate, sleep adjustment, generic daily activity, and logged kcal activity.
- Water target depends on body weight plus temperature, duration, and HR modifiers by activity.
- `outros` has neutral water-factor support (added in migration `008`).
- Carb target depends on weekday; this is intentional, not a bug.

## Key Hooks
- `useDailyLog` / `useUpsertDailyLog` — day fetch and save.
- `useUserMetrics` — derives height/birthdate with fallback defaults.
- `useBiometrics` — SecureStore flag + local auth prompt.
- `useAppUpdate` — foreground OTA check/fetch/reload.
- `useNativeVersionGate` — compares Expo runtimeVersion with Supabase min runtime.
- `useAppAutomation` — foreground Health Connect sync + background task registration sync.

## Background Automation
- Implemented in `src/lib/backgroundAutomation.ts`.
- Uses `expo-background-task` + `expo-task-manager`.
- One shared task handles water reminders and Health Connect background reads.
- Registration is driven from user settings, not static app startup config.
- Reminder throttling state is persisted in SecureStore/local storage JSON.

## Notifications
- Only current use case is water reminder.
- Android channel id: `water-reminders`.
- Notifications are best-effort and gated by user permission + reminder settings.

## Health Connect
- Code is in `src/lib/healthConnect.ts`.
- Android-only; gracefully reports unsupported status elsewhere.
- Reads weight records only.
- Initial sync imports last 30 days, then stores a changes token.
- Later syncs use incremental `getChanges`.
- If token expires, local sync state is cleared and a fresh import is performed.
- Foreground sync runs when app becomes active if enabled.
- Optional background sync controlled by `user_app_settings`.

## Whoop Integration
- OAuth start/callback: `supabase/functions/whoop-oauth`.
- Import/list/reclassify: `supabase/functions/sync-whoop`.
- Tokens stored in `integration_tokens` for provider `whoop`.
- Imports are idempotent via `activity_imports`.
- Legacy imported `outros` items may be repaired by the function.
- Reclassification updates existing `daily_logs` contributions and marker metadata.

## Garmin Integration
- All logic lives in `supabase/functions/sync-garmin`.
- Uses mobile SSO + DI OAuth flow, not official public OAuth.
- Cached bearer/refresh/cookie session stored in `integration_tokens` under provider `garmin`.
- Supports `list`, `import`, and `reimport` actions.
- Import creates `run_activities` and `run_sessions`, then syncs total run minutes to `daily_logs`.
- Contains robust retry/session-refresh/error reporting; operationally sensitive — avoid casual refactors.

## PR System
- Units supported: `time_sec`, `reps`, `weight_kg`, `rounds_reps`, `meters`.
- Current PR stored as `is_pr`; recalculation scans all attempts.
- Default movement seeding is UI-driven in `prs.tsx`.

## Water Tracking
- Presets are reorderable and user-specific.
- Daily consumption is derived from `water_intakes`, not manually edited in `daily_logs`.
- Trigger `refresh_daily_water_consumption_*` keeps `daily_logs.water_consumed_ml` in sync.
- Hydration target uses current day weight, otherwise latest known weight.

## Excel Import
- Historical import source: `Dieta e Treino.xlsx` at repo root.
- Importer: `scripts/import-excel.mjs`.
- Imports three domains: daily logs, runs, and PR attempts.
- Worksheet/header-aware due to earlier column drift.
- One-time migration utility; preserved because it documents the historical data shape.

## UI / UX Notes
- Dark-first; heavy emoji/icon affordances.
- Some files contain mojibake (`AnÃ¡lises`, `ConfiguraÃ§Ãµes`, broken-char comments).
- When editing those files, minimize unrelated formatting churn and keep UTF-8.
- Charts are hand-built with RN views; no chart library.
- Bottom sheets are custom components, not a third-party modal framework.

## Risky / Fragile Areas
- `sync-garmin` is long and operationally delicate; avoid casual refactors.
- Running import logic must preserve idempotency markers and date rollups.
- `daily_logs` has many denormalized columns; partial updates can accidentally null or double-count data.
- Whoop reclassification/repair depends on metadata shape (`schema_version`, `mapping`, `normalized`).
- Health Connect state persistence is local-device only; clearing app storage resets sync baseline.

## Fast Debug Heuristics
- Login/network issue → inspect `src/lib/supabase.ts`, `.env.local`, `app.json`; run `npm run check:supabase`.
- Build failure → run `npm run check:build-env`, then `npm run typecheck`.
- Daily metric mismatch → inspect `daily_logs` payload path first, then `computeDailyCalculations`.
- Missing run minutes → inspect `syncRunSessionsToDaily` and Garmin/manual run save flows.
- Water mismatch → inspect `water_intakes`, DB trigger, and `buildDailyLog`.
- Update modal/banner issue → inspect `useAppUpdate`, `useNativeVersionGate`, and `app_version_config`.
- Health Connect issue → inspect local permission status, stored app settings, and local sync state.

## Working Style
- Prefer surgical edits; large screen files are complex and partially hand-tuned.
- Preserve React Query invalidation behavior when adding mutations.
- When touching provider sync, reason about side effects on `daily_logs`, `run_activities`, `run_sessions`, and `activity_imports`.
- When touching schema assumptions, read the matching migration before changing TS types.
- Always run `git status` before modifying anything; treat uncommitted changes as user work unless confirmed otherwise.

## Communicating Deploys to the User

After deploying, always tell Diego clearly which type was deployed and what he needs to do:

**OTA (`npm run update:preview` or `update:production`) — just close and reopen the app.**
Only JS/assets change. The `useAppUpdate` hook detects the new bundle on launch, downloads it, and
reloads in ~1.2s. No manual action needed beyond reopening. To force: close the app completely and reopen.

**Native APK (new EAS build) — reinstall the APK.**
Required when a native module, permission, Expo SDK, or the `version` in `app.json` changes
(`runtimeVersion.policy = "appVersion"`). The `useNativeVersionGate` hook compares the installed
version with `app_version_config.min_runtime_version` in Supabase and blocks the app with a
mandatory-update modal. After a native build: update `min_runtime_version` and `apk_download_url`
in the `app_version_config` table, then send Diego the download link.

> Quick rule: `update:*` command → reopen app. EAS build → reinstall APK.
