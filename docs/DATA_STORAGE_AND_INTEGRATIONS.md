# Data storage and integration architecture

## Current implementation

- **Cloudflare Workers:** serves the application and authenticated API.
- **Cloudflare D1:** operational source of truth, configured through `wrangler.jsonc`.
- **AST persistence:** manual entry and Excel import use the same Worker/D1 validation and persistence path.
- **Authentication:** D1-backed user profiles, PBKDF2 password hashes, opaque server-side sessions and secure HttpOnly cookies.
- **Authorization:** roles `admin`, `operator` and `analyst`; facility-scoped access is enforced by the Worker.
- **Audit:** import batches and actor-attributed audit events are stored in D1.

The current authentication and persisted AST workflow are implemented. The IPC visit/assessment, WGS and legal-act modules still require their own persisted forms, endpoints and role-aware permissions before operational use.

## Data flow for AST

1. An operator submits an Excel workbook or enters AST results manually.
2. The Worker validates the expected fields and row-level values.
3. Patient identifiers are pseudonymized server-side using the configured HMAC secret.
4. Facility, isolate, AST-result and import-batch records are written to D1.
5. The Worker records the import outcome and audit event.
6. Authorized users read AST records through the authenticated API.

One row represents one antimicrobial susceptibility result for one isolate against one antimicrobial agent. Preserve MIC operator, MIC value, zone diameter, S/I/R category and interpretation-standard version as separate fields.

Do not calculate resistance percentages until the denominator, deduplication rule, organism/antimicrobial pairing and reporting period have been approved.

## Future integrations

### Cloudflare R2

R2 is not currently connected. It may later store source workbooks, generated exports and large sequencing files. Buckets must remain private; use authenticated access or short-lived signed URLs.

### Google Sheets

The Worker reads the two facility-directory sources directly through Google's XLSX export endpoint:

`Google Sheets export URL → Cloudflare Worker → authenticated facility directory`

This is a read-only connection. It does not use the Google Sheets API, OAuth, a service account, API keys, private keys, Apps Script, a Web App, or a bridge token. The Worker parses the selected GIDs, validates source headers, merges facilities by EDRPOU and returns organizational fields only.

The export endpoint must be able to read each source without an interactive Google login. Google link-view permissions apply to the whole workbook, not just the selected tab. Use dedicated sanitized source workbooks containing only non-sensitive organizational fields; never expose books with patient-level records, personal contacts, credentials or restricted tabs. The Worker does not write back to Google Sheets.

The private IPC/AMR target workbook is not connected to the Worker. AST data enters D1 through authenticated Excel import or manual entry; Patient_ID is HMAC-pseudonymized server-side. The app does not publish or read the private `AST_Data` or `Users` worksheets. WGS, IPC assessments, training and legal-act modules still require their own persisted forms and endpoints before operational use.

The application may still require `INITIAL_ADMIN_SETUP_TOKEN` for first administrator creation and `PATIENT_HMAC_SECRET` for patient-ID pseudonymization. These are application-security settings, not Google credentials.

## Privacy and governance

- Do not store direct patient identifiers in D1.
- Keep `PATIENT_HMAC_SECRET` stable after imports begin.
- Restrict facility-level access by role and assigned facility codes.
- Record import and data-change provenance.
- Define retention, backup, restore and incident-response procedures.
- Complete a security and lawful-basis review before operational use with identifiable or patient-linked data.
