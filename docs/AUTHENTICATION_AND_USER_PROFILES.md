# Authentication, user profiles and AMR data entry

## Scope

The dashboard uses Cloudflare Access for sign-in and D1 for application profiles and role/facility permissions. It does not store user passwords. The Worker validates the signed `Cf-Access-Jwt-Assertion` header (RS256 signature, issuer, expiry and application audience) against the Cloudflare Access signing keys.

The first release includes:
- `admin`: full access and user-profile administration;
- `operator`: manual AST entry and Excel import for assigned facility codes;
- `analyst`: read-only AST access for assigned facility codes;
- manual AST entry and Excel import through the same validation and D1 persistence pipeline;
- audit events associated with the authenticated profile.

## 1. Apply the additive D1 migration

From the project root, after pulling the latest `main` branch:

```bash
npx wrangler d1 migrations apply infection-control-amr-tockph --remote
npx wrangler d1 migrations list infection-control-amr-tockph --remote
```

Migration `0002_user_profiles.sql` adds `user_profiles` and `user_facility_access`. It does not delete or rewrite existing IPC/AMR records.

## 2. Protect the Worker with Cloudflare Access

In Cloudflare Dashboard:

1. Open **Workers & Pages → infection-control-amr-tockph → Access**.
2. Select **Protect this Worker behind Access**.
3. Select **All traffic** for the production Worker.
4. Create or select an allow policy. Initially allow the administrator's exact email address. Add staff emails to the policy as they are onboarded.
5. Apply Access and test that an unauthenticated browser is redirected to the Cloudflare Access sign-in page.

Worker-level Access protects the Worker across its `workers.dev` hostname and associated routes. See the official [Cloudflare Workers Access guide](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

## 3. Configure Worker variables

In **Workers & Pages → infection-control-amr-tockph → Settings → Variables and Secrets**, add these non-secret variables in the Production environment:

| Variable | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `https://<your-team-name>.cloudflareaccess.com` |
| `ACCESS_AUD` | Application Audience (AUD) tag from the Access application |
| `INITIAL_ADMIN_EMAIL` | Exact email address that will be the first system administrator |

Use the exact Access Team domain and AUD tag. The AUD tag is available in **Zero Trust → Access → Applications → your application → Additional settings**. The AUD binds the JWT to this Access application.

Do **not** change `PATIENT_HMAC_SECRET`. Keep the existing Production secret unchanged so previously generated patient pseudonyms remain stable. The old `API_TOKEN` is no longer used by the current profile-based API; do not remove it until the new login and import path has been verified.

Official reference: [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## 4. Bootstrap the first administrator

1. Set `INITIAL_ADMIN_EMAIL` to the same email that is allowed by the Access policy.
2. Deploy the updated Worker and frontend.
3. Open the dashboard and sign in using that email through Cloudflare Access.
4. On the first successful `/api/auth/me` request, the Worker creates an active administrator profile for that exact email if no profile already exists.
5. Open **Користувачі та доступ** to create staff profiles.

The initial administrator profile is not auto-promoted if a profile with that email already exists. This avoids silently changing an existing account's role.

## 5. Create profiles and assign access

The administrator form supports:
- full name and email;
- role: admin, operator, or analyst;
- active/deactivated status;
- access to all facilities, or a comma-separated list of facility codes.

For limited operators and analysts, the facility codes must match `Hospital_ID` values in the AST data exactly. A profile with no facility codes and without the all-facilities flag can sign in but cannot read or import facility records.

Creating a profile does not automatically allow its email through Cloudflare Access. The email must also satisfy an Access allow policy.

## 6. AST data entry

### Manual entry

The **Моніторинг AMR** page provides a manual form. One submission is one AST result for one isolate and one antimicrobial agent. The same server validation, pseudonymization, facility authorization and D1 write path is used as for Excel.

### Excel import

Use **Завантажити шаблон Excel**. The workbook contains:
- `AMR_AST`: the exact 16-column import header;
- `Інструкція`: field definitions and formatting rules.

Do not rename or remove columns. Dates must be `YYYY-MM-DD`; S/I/R must remain separate; MIC operator and MIC value are separate fields. The Worker checks the user's permitted `Hospital_ID` values before saving.

## 7. API endpoints

- `GET /api/auth/me`: verified identity and provisioned profile.
- `GET /api/admin/users`: list profiles (admin only).
- `POST /api/admin/users`: create or update a profile (admin only).
- `GET /api/amr/ast`: read AST rows within the user's facility scope.
- `POST /api/amr/ast/manual`: manual AST write.
- `POST /api/amr/ast/import`: Excel AST write.
- `GET /api/health`: non-sensitive D1 connectivity probe.

The browser no longer sends a shared API Bearer token. Each same-origin request passes through Cloudflare Access, and the Worker validates the signed Access JWT before accessing profile or AST endpoints.

## 8. Operational cautions

- Do not enter identifiable patient information into test or demo environments.
- The Worker HMAC-pseudonymizes `Patient_ID`; retain the current `PATIENT_HMAC_SECRET`.
- The current AST schema derives isolate identity from `Hospital_ID + Sample_ID + Bacterial_Species`. Add an explicit laboratory `Isolate_ID` if the source form distinguishes multiple same-species isolates from one sample.
- The present profile module governs AMR AST access. Other IPC/WGS/NPA modules still require their own persisted forms, endpoints and role checks before being treated as operational.
- Complete access-policy review, backup/restore testing, audit-log review, data-retention rules and legal-basis assessment before production use with real patient-linked data.
