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

The read-only facility directory uses the same lightweight integration pattern as the influenza dashboard:

`Google Sheets CSV export → Cloudflare Worker → read-only facility directory`

The Worker reads two allow-listed source tabs by spreadsheet ID and GID, parses CSV, matches facilities by EDRPOU, merges monitoring attributes, and returns only organizational fields. No Apps Script deployment, bridge token, or Google API credential is required for this read path.

**Access prerequisite:** publish only the two required organizational tabs as CSV (`File → Share → Publish to web → select the individual sheet → CSV`). Do not publish an entire workbook if it contains other tabs or personal data. Store each generated CSV URL in the corresponding `publishedCsvUrl` property in `FACILITY_CSV_SOURCES` in `src/worker.ts`. The endpoint does not expose director, email, or phone fields. Google documents that individual sheets can be selected for publication and that published content updates when the source changes; review the published-content settings before publishing.

This direct CSV path is read-only and does not write to D1 or back to Google Sheets. The AST import, protected administrative sheet inspection, and target-sheet upsert workflows still use the staged Apps Script bridge until they are separately migrated to an approved CSV or authenticated API design. D1 remains the system of record for user accounts, sessions, and persisted AMR data.

## Privacy and governance

- Do not store direct patient identifiers in D1.
- Keep `PATIENT_HMAC_SECRET` stable after imports begin.
- Restrict facility-level access by role and assigned facility codes.
- Record import and data-change provenance.
- Define retention, backup, restore and incident-response procedures.
- Complete a security and lawful-basis review before operational use with identifiable or patient-linked data.
