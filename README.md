# IPC & AMR Monitoring — Ternopil CDC

Internal Ukrainian-language information and analytics MVP for facility-level infection prevention and control (IPC) monitoring and antimicrobial resistance (AMR) surveillance.

## Implemented in the repository

- Responsive Ukrainian dashboard shell and IPC/AMR modules.
- AMR AST table and exact 16-column Excel import contract.
- Manual AST entry and Excel import through a shared Worker/D1 validation path.
- Downloadable Excel template with a separate instructions worksheet.
- D1-backed password authentication with PBKDF2 password hashing and random salts.
- Opaque server-side sessions in HttpOnly, Secure, SameSite=Strict cookies.
- Same-origin and CSRF checks for state-changing requests.
- First-administrator one-time setup flow protected by a Worker secret.
- D1 user profiles with roles: `admin`, `operator`, `analyst`.
- Facility-code scoped AST read/write permissions.
- Admin interface to create, edit, deactivate profiles and set/reset passwords.
- Patient_ID HMAC-SHA-256 pseudonymization.
- Import batch metadata and actor-attributed audit events.
- AMR map with district/community switch.

Cloudflare Access is not required for the application sign-in flow.

## Production setup

See [Authentication and user profiles](docs/AUTHENTICATION_AND_USER_PROFILES.md):

1. Apply D1 migrations `0002_user_profiles.sql` and `0003_password_sessions.sql`.
2. Add the one-time Production secret `INITIAL_ADMIN_SETUP_TOKEN`.
3. Deploy the current `main` branch through the connected Cloudflare Git integration (`npm run build`, then `npx wrangler deploy`). Verify the deployed commit SHA in the Cloudflare deployment details.
4. Create the first administrator from the first-run setup form.
5. Remove `INITIAL_ADMIN_SETUP_TOKEN` after successful setup.
6. Keep the existing `PATIENT_HMAC_SECRET` unchanged.
7. Admin creates staff profiles and assigns roles/facility codes.

The previous shared `API_TOKEN` and Cloudflare Access identity flow are not used by the current application.

## AST data grain and fields

One row represents one AST result for one isolate against one antimicrobial agent. The import schema retains MIC operator separately from MIC value and preserves S, I and R as distinct categories.

The current derived isolate identity uses `Hospital_ID + Sample_ID + Bacterial_Species`. Add an explicit laboratory `Isolate_ID` when the source form distinguishes multiple isolates of the same species from one sample.

## Technology

- React + TypeScript + Vite
- Cloudflare Workers
- Cloudflare D1
- Excel parsing/export through SheetJS
- Web Crypto API (PBKDF2, SHA-256, HMAC-SHA-256)

## Local development

```bash
npm install
npm run dev
npm run build
```

## Important limitations

- The current user-profile and permission model is implemented for AMR AST workflows. IPC visit/assessment, WGS and legal-act modules still need their own persisted forms, endpoints and role-aware permissions before operational use.
- Google Sheets and R2 are not connected.
- Login rate limiting is currently email-based and should be complemented with edge-level abuse protection before a broad public rollout.
- Do not upload identifiable patient data before security review, backup/restore testing, audit-log review, retention rules and lawful-basis assessment.
- Never change `PATIENT_HMAC_SECRET` after real imports begin unless a planned migration of pseudonyms has been designed.
