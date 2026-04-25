# Treino & Dieta - AGENTS Guide

## Purpose
- Use this file as the Codex-facing project map.
- `CLAUDE.md` is reference material only. Do not edit it unless explicitly asked.
- Prefer this document over generic assumptions when navigating or changing the repo.
- If `AGENTS.md` or `CLAUDE.md` is changed, those `.md` edits must also be committed and pushed.

## Product Overview
- Personal fitness, nutrition, hydration, running, and PR tracking app.
- Main target is Android via Expo/EAS.
- Web exists as a support surface and deploy target, not the primary product.
- Backend is Supabase: Postgres, Auth, and Edge Functions.
- Core value: centralize manual logs plus imported data from Garmin, Whoop, and Health Connect.

## Tech Stack
- Expo 55
- React Native 0.83
- React 19
- Expo Router
- TanStack React Query
- Zustand
- NativeWind
- Supabase JS
- Deno for Supabase Edge Functions

## Repo Map
- `app/` Expo Router routes and layouts.
- `src/lib/` Supabase client, API layer, notifications, Health Connect, background automation.
- `src/hooks/` app-facing hooks for logs, auth, updates, automation, biometrics.
- `src/utils/` calculation and daily-log helpers.
- `src/screens/` larger extracted screens.
- `src/components/ui/` shared UI primitives.
- `supabase/migrations/` schema history and source of truth for DB assumptions.
- `supabase/functions/` provider integrations and sync flows.
- `scripts/` environment checks, Garmin deploy helper, Excel import.
- `docs/` static web assets such as privacy pages.
- `Dieta e Treino.xlsx` historical import source kept at repo root.

## Runtime Priorities
- Treat Android as the primary experience.
- iOS exists, but Health Connect and automation assumptions are Android-first.
- Web must keep working for export/deploy, but should not drive product decisions over Android.

## Commands
- `npm run start` starts Expo.
- `npm run android` starts Expo for Android.
- `npm run web` starts Expo Web locally.
- `npm run typecheck` runs TypeScript validation.
- `npm run doctor` runs Expo Doctor.
- `npm run audit:app` audits production dependencies.
- `npm run check` runs build-env check, typecheck, doctor, and audit.
- `npm run check` stops at the first failing step. If it stops at `expo-doctor` because of pre-existing Expo SDK 55 patch-version alignment warnings, report that the full check did not complete, run `npm run audit:app` separately, and do not update Expo/RN/SDK dependencies as part of an unrelated change.
- `npm run check:build-env` validates required env/build configuration.
- `npm run check:supabase` validates Supabase DNS and health endpoint.
- `npm run check:functions:garmin` type-checks the Garmin Edge Function.
- `npm run deploy:garmin` deploy helper for `sync-garmin`.
- `npm run update:preview` publishes Android OTA to preview, but it should not be the default OTA target for Diego's installed Android app.
- For OTA to Diego's installed Android app, do not rely on `npm run update:production` in non-interactive mode; run `eas update` directly with `EXPO_TOKEN`, `--channel production`, `--environment production`, `--platform android`, and explicit `--message`.

## Environment
- Local runtime env is `.env.local`.
- Key public vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- `app.json` also contains Supabase values under `expo.extra`; the app may still boot without `.env.local`.
- `scripts/import-excel.mjs` expects service-role credentials in `scripts/.env`.
- Edge Functions depend on secrets configured in the Supabase project environment.
- `.env.local` contains `EXPO_TOKEN`. Always read it and pass it as an env var before running EAS/Expo CLI commands. Do not ask Diego to run them manually.
  - For OTA that must reach Diego's installed Android app, use `production`, not `preview`.
  - Non-interactive EAS OTA must include both `--channel production` and `--environment production`; EAS can refuse the update without the environment flag.
  - PowerShell pattern: `$env:EXPO_TOKEN = (Select-String -Path .env.local -Pattern '^EXPO_TOKEN=').Line.Split('=',2)[1]; eas update --channel production --environment production --platform android --message "..."`
## App Structure
- `app/_layout.tsx` wires QueryClient, auth bootstrap, updates, automation, and notifications.
- `app/index.tsx` redirects to login or `/(tabs)/hoje`.
- `app/(auth)/login.tsx` handles password login and optional biometric unlock.
- `app/(tabs)/_layout.tsx` is the authenticated shell.
- Hidden route: `registrar` is used from app flows but not shown in the tab bar.

## Main Screens
- `app/(tabs)/hoje.tsx` day summary, TDEE, hydration, nutrition, Whoop cards, quick edit entry.
- `app/(tabs)/registrar.tsx` manual daily log editor.
- `app/(tabs)/corridas.tsx` run history, charts, manual run creation, delete/reimport behavior.
- `app/(tabs)/agua.tsx` hydration target, presets, intake logging, reminder settings.
- `app/(tabs)/prs.tsx` PR definitions, attempts, charts, benchmark reseeding.
- `app/(tabs)/analises.tsx` trends and aggregate analytics.
- `app/(tabs)/configuracoes.tsx` delegates to `src/screens/ConfiguracoesScreen.tsx`.

## Data Flow
- React Query is the default fetch/cache layer.
- Most server reads/writes live in `src/lib/api.ts`.
- Zustand is only used for auth state in `src/stores/auth.ts`.
- Supabase client lives in `src/lib/supabase.ts`.
- There is no heavy service layer; screens and hooks commonly call `src/lib/api.ts` directly.

## Core Tables
- `user_profiles` user metadata like name, birth date, height.
- `daily_logs` central fact table for body metrics, calories, activity minutes, Whoop data, and water aggregate.
- `run_activities` top-level runs.
- `run_sessions` intervals/laps associated with a run.
- `pr_movements` PR definitions.
- `pr_attempts` dated PR attempts and current PR markers.
- `integration_tokens` provider auth/session state.
- `activity_imports` idempotency markers for imported activities.
- `user_app_settings` hydration and Health Connect automation settings.
- `water_presets`, `water_intakes` hydration UX and intake records.
- `app_version_config` minimum supported runtime and APK URL.

## Migration Landmarks
- `001_initial_schema.sql` initial schema, indexes, and RLS.
- `005_run_activities_and_imports.sql` normalized running/import model.
- `006_app_version_config.sql` native version gate support.
- `007_water_and_health_connect.sql` hydration tables and Health Connect support.
- `008_whoop_other_minutes.sql` Whoop support for `outros`.

## Domain Rules
- `daily_logs` is the center of the product. Most dashboards derive from it.
- Manual activities write directly to denormalized activity fields on `daily_logs`.
- Garmin import populates `run_activities` and `run_sessions`, then rolls totals into `daily_logs.min_corrida`.
- Manual run creation also syncs back into `daily_logs`.
- Whoop import writes into `daily_logs` and records `activity_imports`.
- Water intake updates `daily_logs.water_consumed_ml` through DB triggers.
- Health Connect sync upserts `daily_logs.weight_kg`.

## Calculation Source Of Truth
- `src/utils/calculations.ts` is the source of truth for TDEE, hydration target, protein, carbs, pace, and duration helpers.
- TDEE mixes BMR estimate, sleep adjustment, baseline activity, and logged activity kcal.
- Water target depends on weight plus activity temperature, duration, and HR modifiers.
- Carb target varies by weekday intentionally.

## Integrations
### Health Connect
- Code: `src/lib/healthConnect.ts`.
- Android-only; unsupported platforms should fail gracefully.
- Reads weight data only.
- Initial sync imports the last 30 days, then uses incremental changes.
- If the sync token expires, local state is cleared and a fresh import is required.

### Whoop
- OAuth: `supabase/functions/whoop-oauth/index.ts`.
- Import and reclassification: `supabase/functions/sync-whoop/index.ts`.
- Imports are idempotent through `activity_imports`.
- Reclassification depends on metadata shape such as `schema_version`, `mapping`, and `normalized`.

### Garmin
- Logic: `supabase/functions/sync-garmin/index.ts`.
- Uses mobile SSO plus DI OAuth flow rather than official public OAuth.
- Supports `list`, `import`, and `reimport`.
- Stores session/token state in `integration_tokens`.
- This function is operationally sensitive. Avoid refactors unless necessary and verify idempotency carefully.

## Background Automation And Notifications
- Background automation lives in `src/lib/backgroundAutomation.ts`.
- Uses `expo-background-task` and `expo-task-manager`.
- One shared task handles water reminders and Health Connect background sync.
- Registration is driven by user settings rather than static startup-only config.
- Current notification use case is water reminders.
- Android notification channel id is `water-reminders`.

## UI Notes
- The app is dark-first.
- Styling mixes NativeWind utility classes and inline style objects.
- Charts are custom RN views, not a chart library.
- Bottom sheets are custom components.
- Some files contain encoding noise or mojibake; avoid unrelated formatting churn in those files.

## Risk Areas
- `supabase/functions/sync-garmin/index.ts` is long and fragile.
- Running flows must preserve idempotency markers and date rollups.
- `daily_logs` has many denormalized columns; careless partial updates can null fields or double-count values.
- Whoop metadata shape is important for repairs and reclassification.
- Health Connect sync state is device-local; clearing storage resets the baseline.

## Change Heuristics
- Prefer surgical edits over broad refactors.
- Preserve React Query invalidation behavior when touching mutations.
- When changing provider sync flows, reason through effects on `daily_logs`, `run_activities`, `run_sessions`, and `activity_imports`.
- When changing schema assumptions, read the corresponding migration first and then align TS types and API code.
- If editing a large screen file, minimize formatting churn.

## After Every Change — Mandatory Steps
After implementing any change, always complete all applicable steps before reporting done:

1. **Create a branch** specific to the work before starting any `feat`, `fix`, `docs`, or `security` change.
2. **Commit** the changed files with a descriptive message on that branch.
3. **Merge** the finished branch into `master`.
4. **Push** `master` to `origin/master`.
5. **Delete** the branch created for that work after the merge is complete.
6. **Deploy/update** based on what changed:
   - JS or asset change for Diego's installed Android app -> run `eas update` directly with `EXPO_TOKEN`, `--channel production`, `--environment production`, `--platform android`, and explicit `--message` (OTA; user reopens app).
   - Edge Function change → `npm run deploy:<function>` (already done during dev, but verify).
   - Native/SDK/permission change → new EAS build required; notify Diego to reinstall APK.
7. Tell Diego in one line what was deployed and what action (if any) he needs to take.
8. If this file or `CLAUDE.md` was edited, commit and push those `.md` changes too; there is no docs-only exception.

## Response Style
- Be as concise as possible. Deliver the same information with the fewest words.
- Default to Caveman-style brevity: terse, low-filler, technically exact.
- Drop Caveman compression for safety warnings, irreversible actions, or ambiguity-heavy instructions.
- No preambles ("I'll now…", "Let me…"). No closing summaries ("In summary…", "I've updated…").
- State what changed and what to do next — nothing else.

## Fast Debug Paths
- Login or network issue: inspect `src/lib/supabase.ts`, `.env.local`, `app.json`, then run `npm run check:supabase`.
- Build issue: run `npm run check:build-env` and `npm run typecheck`.
- Daily metric mismatch: inspect `daily_logs` payload flow first, then `src/utils/calculations.ts`.
- Missing run minutes: inspect Garmin/manual run sync back into `daily_logs`.
- Water mismatch: inspect `water_intakes`, hydration triggers, and daily log builders.
- Update banner or forced-update issue: inspect `useAppUpdate`, `useNativeVersionGate`, and `app_version_config`.
- Health Connect issue: inspect permissions, `user_app_settings`, and local sync state.

## Deploy Notes
- OTA for Diego's installed Android app should be published with direct `eas update --channel production --environment production --platform android --message "..."`; after that, the user only needs to fully close and reopen the app.
- Native APK build: user must reinstall the APK.
- Because `runtimeVersion.policy` is `appVersion`, native-breaking changes require bumping app version and updating `app_version_config`.
- After a native build, ensure `app_version_config.min_runtime_version` and `apk_download_url` are updated consistently.
