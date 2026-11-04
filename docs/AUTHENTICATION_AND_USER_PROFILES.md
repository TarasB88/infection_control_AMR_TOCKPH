# Authentication, user profiles and AMR data entry

## Authentication architecture

The application uses its own D1-backed password authentication. Cloudflare Access is not required. The Worker verifies credentials, stores only PBKDF2 password hashes (SHA-256, 310,000 iterations, unique random salt), and issues opaque random sessions. Only a SHA-256 hash of each session token is stored in D1.

Session cookies are `HttpOnly`, `Secure`, `SameSite=Strict`, host-only (`__Host-` prefix), and expire after 8 hours. State-changing requests require both a same-origin `Origin` header and a session-bound CSRF token. Login attempts are rate-limited by email (8 failed attempts per 15 minutes). Logout revokes the server-side session.

The first release includes:
- `admin`: full access, user profile management and all facilities;
- `operator`: manual AST entry and Excel import for assigned facility codes;
- `analyst`: read-only AST access and export for assigned facility codes;
- manual AST entry and Excel import through the same validation and D1 persistence pipeline;
- audit events associated with the authenticated profile.

## 1. Apply D1 migrations

From the project root, after pulling the latest `main` branch:

```bash
npx wrangler d1 migrations apply infection-control-amr-tockph --remote
npx wrangler d1 migrations list infection-control-amr-tockph --remote
```

Migration `0002_user_profiles.sql` adds user profiles and facility scopes. Migration `0003_password_sessions.sql` adds password credential fields, session storage and login-attempt tracking. Both migrations are additive; they do not delete or rewrite existing IPC/AMR records.

## 2. Configure the one-time administrator setup secret

In **Workers & Pages → infection-control-amr-tockph → Settings → Variables and Secrets**, add a Production secret:

| Secret | Value |
|---|---|
| `INITIAL_ADMIN_SETUP_TOKEN` | A unique random secret of at least 32 characters |

Generate a strong value locally (do not send it in chat or commit it to Git), for example with a password manager or a cryptographically secure random generator. The secret is only used to create the first administrator when the `user_profiles` table is empty. After the first administrator has been created, the endpoint permanently refuses further setup attempts because the table is no longer empty. Remove this secret from Worker settings after successful bootstrap.

Keep the existing `PATIENT_HMAC_SECRET` unchanged. Changing it would change patient pseudonyms on future imports and break continuity with existing pseudonymized records. The old `API_TOKEN`, if still present, is not used by the new application.

## 3. Create the first administrator

1. Deploy the current Worker and frontend.
2. Open the dashboard. If no profile exists, the first-run setup form is displayed.
3. Enter the `INITIAL_ADMIN_SETUP_TOKEN`, administrator's full name, email and a strong password (at least 12 characters).
4. After the success message, sign in using the email and password just created.
5. Remove `INITIAL_ADMIN_SETUP_TOKEN` from Production secrets.

The first-run endpoint accepts requests only from the same origin, requires the secret, and works only while there are zero user profiles.

## 4. Create staff profiles

Open **Користувачі та доступ**. For each staff member, specify:
- full name and unique email;
- role: admin, operator, or analyst;
- active/deactivated status;
- access to all facilities, or a comma-separated list of facility codes;
- an initial password of at least 12 characters (required for new profiles).

When editing an existing profile, leave the password field blank to keep the current password. To reset a staff member's password, enter a new password. Facility codes must match the `Hospital_ID` values in AST data exactly.

Deactivating a profile blocks access at the next API request and does not delete its history or data. Existing sessions should be revoked when deactivating a user; the application also rejects sessions for inactive profiles.

## 5. AST data entry

### Manual entry

The **Моніторинг AMR** page provides a manual form. One submission is one AST result for one isolate and one antimicrobial agent. The same server validation, pseudonymization, facility authorization and D1 write path is used as for Excel.

### Excel import

Use **Завантажити шаблон Excel**. The workbook contains:
- `AMR_AST`: the exact 16-column import header;
- `Інструкція`: field definitions and formatting rules.

Do not rename or remove columns. Dates must be `YYYY-MM-DD`; S/I/R must remain separate; MIC operator and MIC value are separate fields. `Patient_ID` is transmitted to the Worker only for server-side HMAC pseudonymization; plaintext is not stored in D1.

## 6. API endpoints

- `GET /api/auth/status`: reports whether first-run setup is still required.
- `POST /api/auth/setup`: one-time first administrator creation.
- `POST /api/auth/login`: verifies credentials and issues a secure session cookie.
- `GET /api/auth/me`: returns the current profile and CSRF token.
- `POST /api/auth/logout`: revokes the current session.
- `GET /api/admin/users`: list profiles (admin only).
- `POST /api/admin/users`: create/update profiles and set/reset passwords (admin only).
- `GET /api/amr/ast`: read AST rows within the user's facility scope.
- `POST /api/amr/ast/manual`: manual AST write.
- `POST /api/amr/ast/import`: Excel AST write.
- `GET /api/health`: non-sensitive D1 connectivity probe.

All state-changing authenticated requests require same-origin validation and the CSRF token returned by `/api/auth/me`.

## 7. Operational cautions

- Do not enter identifiable patient information into test or demo environments.
- Retain the current `PATIENT_HMAC_SECRET`; never rotate it without a planned pseudonym migration.
- The current AST schema derives isolate identity from `Hospital_ID + Sample_ID + Bacterial_Species`. Add an explicit laboratory `Isolate_ID` if the source form distinguishes multiple same-species isolates from one sample.
- The present profile module governs AMR AST access. Other IPC/WGS/NPA modules still require persisted forms, endpoints and role checks before being treated as operational.
- Before production use with real patient-linked data, complete access-policy review, password-reset procedure, backup/restore testing, audit-log review, data-retention rules, and legal-basis assessment.
