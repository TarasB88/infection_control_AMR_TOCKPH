# IPC & AMR Monitoring Dashboard — MVP

## Product scope

An internal web application for the Ternopil Regional Center for Disease Control and Prevention to manage infection-prevention-and-control (IPC) monitoring and antimicrobial-resistance (AMR) surveillance at the level of individual healthcare facilities.

**MVP restriction:** do not calculate or display oblast-wide aggregates, facility rankings, oblast averages, or oblast-level prevalence indicators. Keep the data model ready for a later regional analytics phase.

## Core modules

1. Facility registry and facility profile.
2. Monitoring visits (initial, follow-up, thematic).
3. IPC assessment by criterion, tied to a specific visit and instrument version.
4. Recommendations and corrective-action tracking.
5. Training / CPD events and attendance.
6. AMR microbiology surveillance.
7. AMR genomic surveillance (WGS).
8. Excel import validation, export, audit log, and role-based access.

## AMR data model

### AST / microbiology result grain

One row represents one antimicrobial susceptibility result for one isolate against one antimicrobial agent. Do not assume Sample_ID uniquely identifies an isolate.

Required identifiers and fields:
- Hospital_ID, Hospital_Name
- Patient_ID (pseudonymized only; no direct patient identifiers)
- Sample_ID
- Isolate_ID (add; required to distinguish multiple isolates from one sample)
- Sampling_Date, Sample_Matrix_Type, Bacterial_Species
- Antimicrobial_Agent
- MIC_Operator (<, <=, =, >=, >) and MIC_Value
- Zone_Diameter
- SIR_Category
- Interpretation_Standard (include exact standard version, e.g. EUCAST 2026)

Keep raw MIC and zone-diameter values. Preserve the interpretation standard/version used for each result. EUCAST category I must not be merged with R.

### WGS / genomic result grain

One row represents one WGS analysis for one isolate (allow multiple analyses/runs over time, if needed), linked by Isolate_ID and Sample_ID.

Fields:
- Sequencing_Date, Sequencing_Platform
- MLST_ST
- Serotype_K_O_Antigen
- AMR_Genotype_Genes
- Point_Mutations
- Virulence_Genes
- Plasmid_Replicon_Type
- FASTA_FASTQ_File_Link
- optional quality/provenance metadata: Assembly_Accession, BioSample_ID, SRA_Accession, Analysis_Pipeline, Analysis_Version, Quality_Control_Status, Analysis_Date.

### AMR analytics

Facility- and period-specific only in MVP:
- sample count, isolate count, pseudonymized patient count (distinct measures)
- organism distribution
- specimen matrix distribution
- AST profile by organism and antimicrobial
- S/I/R distribution, retaining EUCAST I separately
- MIC distributions where technically meaningful
- detected AMR genes and MLST types
- WGS coverage among isolates (with explicit denominator)
- isolate detail view linking phenotype and genotype

Do not label a raw isolate count as prevalence. Do not calculate resistance percentages without a defined denominator, deduplication rule, organism/drug pairing, and reporting period. Distinguish samples, isolates, patients, and AST result rows.

## Data-quality and privacy rules

- Patient_ID must be pseudonymized before import. No names, dates of birth, addresses, medical-record numbers, or other direct identifiers.
- Use stable internal IDs for facilities, samples, isolates, visits, and criteria.
- Validate foreign keys and duplicate records on import.
- Support controlled dictionaries for organisms, specimen types, antimicrobials, and interpretation standards.
- Preserve original imported files and import logs; reject or quarantine invalid rows rather than silently dropping them.
- Store file links securely; do not expose FASTA/FASTQ or patient-linked metadata publicly.
- Record who created/updated a record and when.

## IPC assessment rules

- Criteria must come from the Center's approved monitoring instrument; do not invent criteria, scoring weights, or formulas.
- Every assessment belongs to a facility, monitoring visit, criterion, and criterion/instrument version.
- Not applicable and No data are distinct states and must not automatically count as non-compliant.
- Preserve historical assessments when the instrument changes.

## Selected technical architecture

- Frontend: React + TypeScript + Vite.
- Hosting: Cloudflare Workers static assets only.
- Data store: one private Google Sheets workbook; there is no Cloudflare D1 binding or SQL persistence.
- Authentication: Google Identity Services OAuth in the browser.
- Data access: Google Sheets API directly from the browser using the signed-in user's OAuth access token.
- Excel parsing/export: SheetJS in the browser; imported records are appended directly to the corresponding Google Sheets tab.
- Attachments: links only for now; private binary storage is not connected.

## Current implementation constraints

- Google Sheets permissions apply to the entire workbook. The Users sheet and UI role controls do not enforce per-sheet or row-level security against direct Google API calls.
- Do not use this design as a clinical-data isolation boundary. Do not store direct patient identifiers; use previously approved pseudonyms only.
- The initial Google account to sign in when Users has no profiles becomes the first administrator. Restrict Drive access to the workbook before first bootstrap.
- OAuth Client ID is a public web configuration variable; no Google service account or client secret is used.
- Cloudflare deployment still requires a Cloudflare API token in GitHub Actions. That token is unrelated to Google OAuth.

## MVP acceptance criteria

- Google OAuth login and Google Sheets workbook connection.
- Facility registry and facility profiles loaded from Sheets.
- Visit history, IPC assessment, recommendations and training records stored in their own Sheets tabs.
- AMR AST and WGS records loaded from their respective Sheets tabs.
- Excel import/export operating directly in the browser and writing to Sheets.
- Facility-level filtering and reports in the UI.
- No oblast-wide aggregate indicators, rankings, or averages in the UI.
- No D1 binding, D1 migrations, SQL endpoints, or server-side application database.

## Inputs required before finalizing production schema

1. Current IPC monitoring Excel form(s) and approved criterion list / scoring method.
2. Real AMR workbook(s), including column definitions and examples with sensitive identifiers removed.
3. Training / CPD source workbook, if the training module is included in the first release.
4. Decision on identity provider and database deployment constraints.
