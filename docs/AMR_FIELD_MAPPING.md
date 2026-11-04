# AMR field mapping — MVP

## AST import: one row per isolate × antimicrobial agent

| Supplied column | Database field | Rule |
|---|---|---|
| Hospital_ID | hospital_id | Link to facility registry when matched |
| Hospital_Name | hospital_name | Preserve source value |
| Region_Oblast | region_oblast | Context field; no oblast aggregate in MVP |
| Territorial_Hromada | territorial_hromada | Facility location |
| Settlement | settlement | Facility location |
| Patient_ID | patient_id | Must be pseudonymized before import |
| Sample_ID | sample_id | Specimen identifier; not sufficient to identify isolate |
| Isolate_ID | isolate_id | Required new field; stable isolate identifier |
| Sampling_Date | sampling_date | ISO date preferred |
| Sample_Matrix_Type | sample_matrix_type | Controlled dictionary later |
| Bacterial_Species | bacterial_species | Preserve scientific name |
| Antimicrobial_Agent | antimicrobial_agent | Controlled dictionary later |
| MIC_Operator | mic_operator | Preserve <, <=, =, >=, > |
| MIC_Value | mic_value | Store as text to preserve ranges and precision |
| Zone_Diameter | zone_diameter | Numeric when available |
| SIR_Category | sir_category | S, I, R separately |
| Interpretation_Standard | interpretation_standard | Preserve standard and version |

The user-supplied AST schema has 16 columns. Production import adds Isolate_ID as a required column. A compatibility import may generate a provisional isolate key only when there is exactly one isolate per Sample_ID and organism; ambiguous rows must be rejected for manual resolution.

## WGS import: one row per isolate analysis

Sample_ID, Isolate_ID, Sequencing_Date, Sequencing_Platform, MLST_ST, Serotype_K_O_Antigen, AMR_Genotype_Genes, Point_Mutations, Virulence_Genes, Plasmid_Replicon_Type, FASTA_FASTQ_File_Link.

Optional provenance fields: Assembly_Accession, BioSample_ID, SRA_Accession, Analysis_Pipeline, Analysis_Version, Quality_Control_Status, Analysis_Date.

## Counting and interpretation safeguards

- Keep sample, isolate, patient, and AST-result counts separate.
- Do not label isolate counts as prevalence.
- Do not calculate resistance percentages until the denominator, organism/drug pair, deduplication rule, and time window are explicitly approved.
- Preserve the interpretation standard/version for every AST result.
- EUCAST I remains distinct from S and R.
- Do not infer genotype-phenotype concordance solely from co-occurrence of a gene and phenotype.
- Keep WGS file links private; no public exposure of raw FASTA/FASTQ or patient-linked metadata.
