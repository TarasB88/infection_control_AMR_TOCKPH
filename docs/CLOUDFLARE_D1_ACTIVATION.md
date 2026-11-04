# Cloudflare D1 and Worker deployment

## Current configuration

The production Worker configuration is `wrangler.jsonc`. It contains the real D1 database binding and the migrations directory. Do not replace it with a placeholder configuration or change the existing database ID.

- Worker: `infection-control-amr-tockph`
- D1 binding: `DB`
- Migration directory: `migrations/`
- Worker entry point: `src/worker.ts`
- Frontend assets: `dist/`

## Database migrations

The migration sequence is:

1. `0001_initial_schema.sql` — base operational schema.
2. `0002_user_profiles.sql` — user profiles and facility access.
3. `0003_password_sessions.sql` — password hashes, sessions and login-attempt tracking.

Before applying migrations, inspect the remote migration status:

```bash
npx wrangler d1 migrations list infection-control-amr-tockph --remote
```

Apply only migrations that are not already recorded as applied:

```bash
npx wrangler d1 migrations apply infection-control-amr-tockph --remote
```

Do not manually recreate tables or run an already-applied migration. The migrations are additive; preserve existing records.

## Build and deploy

From the repository root:

```bash
npm install
npm run build
npx wrangler deploy
```

The GitHub Actions build validates the TypeScript project and Vite frontend. A successful GitHub build does not itself deploy the Worker.

## First administrator

After the required migrations have been applied and the Worker is deployed:

1. Set the temporary Worker secret `INITIAL_ADMIN_SETUP_TOKEN` (at least 32 random characters).
2. Open the application and complete the first-administrator setup.
3. Verify that administrator sign-in works.
4. Remove `INITIAL_ADMIN_SETUP_TOKEN` after successful setup.

Keep the existing `PATIENT_HMAC_SECRET` unchanged. Changing it changes the deterministic pseudonyms generated for patient identifiers.

## Verification

Check:

- `GET /api/health` — Worker and D1 connectivity.
- `GET /api/auth/status` — first-run setup state.
- Login, logout, session expiry and role/facility restrictions.
- AST import and read-back from D1.
- Audit events and backup/restore procedures.

Do not enter identifiable patient data until access controls, auditability, retention, backup/restore and the lawful basis for processing have been reviewed.
