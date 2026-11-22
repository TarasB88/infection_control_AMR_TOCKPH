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

Google Sheets are accessed directly by the Cloudflare Worker through the official Google Sheets API:

`Private Google Sheets → Google Sheets API → Cloudflare Worker → authenticated application`

No Google Apps Script project, Web App, `doPost()` endpoint, public CSV export or bridge token is required. The Worker creates a short-lived OAuth access token from a Google service-account key, reads the two allow-listed source tabs by spreadsheet ID and GID, validates headers, matches facilities by EDRPOU and merges monitoring attributes. The API response exposes organizational fields only; director names, email addresses and phone numbers are never returned.

The service account must have Viewer access to both source workbooks and Editor access to the target workbook `1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc` because the administrator can synchronize the merged facility directory into its `Facilities` tab. The service-account email and private key are Cloudflare Worker secrets named `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`; never commit or share the private key. The `Users` worksheet is excluded from generic read and write operations.

Facility preview and manual synchronization, sheet inspection, and AST import use direct Sheets API calls. Apps Script installable triggers are not used; automatic synchronization is not enabled in this direct-API implementation.

D1 remains the system of record for user accounts, sessions and persisted AMR data. AST import and manual entry continue through authenticated Worker endpoints.
## Privacy and governance

- Do not store direct patient identifiers in D1.
- Keep `PATIENT_HMAC_SECRET` stable after imports begin.
- Restrict facility-level access by role and assigned facility codes.
- Record import and data-change provenance.
- Define retention, backup, restore and incident-response procedures.
- Complete a security and lawful-basis review before operational use with identifiable or patient-linked data.
