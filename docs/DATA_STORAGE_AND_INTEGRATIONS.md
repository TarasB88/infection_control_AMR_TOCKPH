# Data storage and integration architecture

## Status
Architecture preparation only. The application currently uses in-memory browser state for AST import. No D1 database, R2 bucket, authentication, API, or Google authorization is configured by this document.

## Target architecture
- Cloudflare Workers: authenticated API, validation, import orchestration.
- Cloudflare D1: normalized operational records and audit metadata.
- Cloudflare R2: uploaded source workbooks, generated exports, and large sequencing files where appropriate.
- Google Sheets: optional future external source connected through a dedicated adapter. D1 remains the system of record.

## Data flow
1. Receive an Excel upload or a future Google Sheets sync request.
2. Validate incoming headers and row-level values.
3. Create an import batch and record validation outcomes.
4. Resolve facility and isolate identities.
5. Upsert records using stable source identifiers; never rely on row number as an identity.
6. Write an audit event and update the import/sync batch.
7. Read dashboard views from D1 through the Worker API.

## Stable identity and deduplication
- AST grain: one result for one isolate and one antimicrobial agent.
- Isolate_ID is the preferred isolate key. Sample_ID alone may not uniquely identify an isolate.
- Incoming sources should provide a stable source_record_id; Google Sheets should use an explicit immutable record ID column, not row number.
- The schema uses a source-system/source-record-ID uniqueness constraint to support repeatable imports.
- Patient_ID must be pseudonymized before upload. Do not store direct identifiers in the dashboard database.
- MIC operator, MIC value, zone diameter, S/I/R category, and interpretation standard/version remain separate.
- S, I, and R remain distinct. Do not publish resistance percentages until denominator, deduplication, organism/drug pair, and period rules are approved.

## Google Sheets integration (future)
Recommended first release is one-way inbound sync: Google Sheets -> Worker -> validation -> D1.
- Use Google OAuth or a managed service identity with least-privilege access to explicitly shared spreadsheets.
- Store credentials only as Worker secrets; never in source code or browser storage.
- Keep spreadsheet ID, worksheet name, column mapping, last successful sync cursor, and sync history in protected configuration/metadata.
- Use a stable immutable ID column in each source sheet.
- Detect changed rows using an updated_at column or controlled full-sheet comparison; do not infer identity from row position.
- Record created/updated/skipped/error counts for every run.
- Add outbound or bidirectional sync only after conflict-resolution and ownership rules are agreed.

## Security and governance gates before real data
- Configure authentication and role-based authorization.
- Confirm lawful basis, data minimization, retention, backup, and access policy.
- Pseudonymize patient identifiers before import.
- Restrict R2 object access and use short-lived signed URLs where needed.
- Add audit logging for imports, edits, exports, and access to sensitive records.
- Test backup restoration and access controls before operational use.

## Cloudflare setup still required
Create the D1 database and R2 bucket in the intended Cloudflare account, then add their actual identifiers/bindings to Worker configuration and environment types. Do not insert placeholder database IDs into production configuration.
