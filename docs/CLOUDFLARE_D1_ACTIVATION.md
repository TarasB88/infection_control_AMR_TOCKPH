# Cloudflare D1 activation runbook

The current production Worker remains assets-only until the D1 database is created and its real ID is available. Do not replace the production `wrangler.jsonc` with a placeholder ID.

## 1. Create the D1 database
From the repository root, with Wrangler authenticated to the intended Cloudflare account:

```bash
npx wrangler d1 create infection-control-amr-tockph
```

Copy the returned `database_id`. Do not share credentials or API tokens.

## 2. Configure the Worker
Use `wrangler.d1.template.jsonc` as the target configuration, replacing `REPLACE_WITH_DATABASE_ID` with the actual ID. The target configuration:
- enables `src/worker.ts` as the Worker entry point;
- serves the Vite build from the Workers assets binding;
- routes `/api/*` through the Worker first;
- binds D1 as `env.DB`.

The Worker currently exposes only a read-only `GET /api/health` probe. It deliberately has no public data-write endpoint until authentication and authorization are implemented.

## 3. Apply the migration
After configuring the real database ID:

```bash
npx wrangler d1 migrations apply infection-control-amr-tockph --remote
```

Check the migration status:

```bash
npx wrangler d1 migrations list infection-control-amr-tockph --remote
```

## 4. Deploy and verify
Build and deploy:

```bash
npm run build
npx wrangler deploy
```

Then open `/api/health` on the deployed Worker. A successful response must report `status: ok` and `database: connected`.

## Important
- The template is not production configuration; it contains a placeholder ID.
- Do not deploy until the actual D1 ID has been inserted.
- The initial migration is additive and creates the database tables; it does not migrate current browser-session demo rows.
- The app's existing Excel import is still browser-session-only. Persistence is not enabled until a secure authenticated import API is implemented and verified.
- Before storing real patient-linked data, implement authentication, role-based access, pseudonymization, audit controls, retention and backup procedures.
- R2 is not yet bound; large source files and sequencing files must not be uploaded to a public bucket.
