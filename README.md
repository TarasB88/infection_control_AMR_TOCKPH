# IPC & AMR Monitoring — Ternopil CDC

Internal Ukrainian-language MVP for facility-level infection prevention and control (IPC) monitoring and antimicrobial resistance (AMR) surveillance.

## Implemented in the repository

- Responsive Ukrainian dashboard shell and existing IPC/AMR modules.
- AMR AST table and exact 16-column Excel import contract.
- Manual AST entry and Excel import through a shared Worker/D1 validation path.
- Downloadable Excel template with a separate instructions worksheet.
- Cloudflare Access JWT verification (RS256 signature, issuer, expiry and application audience).
- D1 user profiles with roles: `admin`, `operator`, `analyst`.
- Facility-code scoped AST read/write permissions.
- Admin interface to create, edit and deactivate profiles.
- Patient_ID HMAC-SHA-256 pseudonymization.
- Import batch metadata and actor-attributed audit events.
- AMR map with district/community switch.

## Required before the new login flow can be used

The repository changes do not automatically configure resources inside the Cloudflare account. Complete the setup in [Authentication and user profiles](docs/AUTHENTICATION_AND_USER_PROFILES.md):

1. Apply D1 migrations, including `0002_user_profiles.sql`.
2. Protect the Worker with Cloudflare Access.
3. Set Production variables `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `INITIAL_ADMIN_EMAIL`.
4. Keep the existing `PATIENT_HMAC_SECRET` unchanged.
5. Deploy the current `main` branch.
6. Sign in as the initial administrator and provision staff profiles.

The prior shared `API_TOKEN` field has been removed from the dashboard. The current AST endpoints use verified Cloudflare Access identity and D1 profile permissions instead.

## AST data grain and fields

One row represents one AST result for one isolate against one antimicrobial agent. The import schema retains MIC operator separately from MIC value and preserves S, I and R as distinct categories.

The current derived isolate identity uses `Hospital_ID + Sample_ID + Bacterial_Species`. Add an explicit laboratory `Isolate_ID` when the source form distinguishes multiple isolates of the same species from one sample.

## Technology

- React + TypeScript + Vite
- Cloudflare Workers
- Cloudflare Access
- Cloudflare D1
- Excel parsing/export through SheetJS

## Local development

```bash
npm install
npm run dev
npm run build
```

The protected API expects Cloudflare Access to be configured in the deployed environment. The production Worker verifies the Access JWT from `Cf-Access-Jwt-Assertion` against the team's signing keys.

## Important limitations

- The current user-profile and permission model is implemented for the AMR AST workflows. IPC visit/assessment, WGS and legal-act modules still need their own persisted forms, endpoints and role-aware permissions before operational use.
- Google Sheets and R2 are not connected.
- Do not upload identifiable patient data before access-policy review, backup/restore testing, audit-log review, retention rules and lawful-basis assessment.
- Never change `PATIENT_HMAC_SECRET` after real imports begin unless a planned migration of pseudonyms has been designed.
