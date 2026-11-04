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
