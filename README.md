# IPC & AMR Monitoring — Ternopil CDC

Internal MVP project for facility-level infection prevention and control (IPC) monitoring and antimicrobial resistance (AMR) surveillance.

## Current state

Early frontend prototype. It is not a production system and does not persist imported data to a server or database.

### Implemented
- Responsive Ukrainian-language application shell and navigation.
- Separate IPC and AMR work areas.
- AMR AST table based on the exact 16-column schema supplied by the project owner.
- Browser-side Excel import with required-column validation.
- Excel export of currently loaded AST rows.
- Explicit demo-data labelling and no oblast-wide aggregates or rankings.
- WGS module placeholder using the supplied genomic field set and planned Isolate_ID linkage.

### Pending
- Authentication and role-based access.
- Persistent database and secure API.
- Server-side file storage and audit log.
- WGS import and isolate-level linkage.
- IPC criteria and scoring, to be configured from the official monitoring forms once supplied.
- Production validation, automated tests, and deployment configuration.

## Run locally

    npm install
    npm run dev

Build:

    npm run build

## AMR AST data grain

One row represents one AST result for one isolate against one antimicrobial agent. Keep MIC_Operator separate from MIC_Value, preserve the interpretation standard/version, and retain S, I, and R as separate categories.

Add Isolate_ID before production use: Sample_ID alone may not uniquely identify an isolate when multiple organisms/isolates are recovered from one sample. Patient_ID must be pseudonymized before import.

## Important

The current import runs in the browser and replaces the in-memory demo rows for that session only. Do not upload identifiable patient data. Do not use demo data for clinical or management decisions.


## Persistence and future integrations

An initial Cloudflare D1 schema is available in `migrations/0001_initial_schema.sql`. It covers facilities, isolate-level AST results, WGS metadata, IPC visits and assessments, recommendations, legal acts, import batches, external sync runs, and audit events.

The data integration contracts in `src/lib/data-integration.ts` define a provider-neutral import boundary for Excel and a future Google Sheets adapter.

These files are preparation only: the Worker is not yet connected to D1 or R2, and Google Sheets is not connected. The current browser-side import remains session-only until the Cloudflare resources, API, authentication, and server-side persistence are configured.

Before operational use, create D1 and R2 resources in Cloudflare, add their real bindings/secrets, implement and test the API, and complete the security and privacy review. Do not upload identifiable patient data to the current prototype.
