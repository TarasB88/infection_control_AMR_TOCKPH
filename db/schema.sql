PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS facilities (
  facility_id TEXT PRIMARY KEY,
  hospital_id TEXT UNIQUE,
  hospital_name TEXT NOT NULL,
  region_oblast TEXT,
  territorial_hromada TEXT,
  settlement TEXT,
  facility_type TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS monitoring_visits (
  visit_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  visit_date TEXT NOT NULL,
  visit_type TEXT NOT NULL CHECK (visit_type IN ('initial','follow_up','thematic')),
  monitoring_team TEXT,
  purpose TEXT,
  report_file_key TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ipc_instrument_versions (
  instrument_version_id TEXT PRIMARY KEY,
  instrument_name TEXT NOT NULL,
  version_label TEXT NOT NULL,
  effective_from TEXT,
  effective_to TEXT,
  source_reference TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ipc_criteria (
  criterion_id TEXT PRIMARY KEY,
  instrument_version_id TEXT NOT NULL REFERENCES ipc_instrument_versions(instrument_version_id),
  domain_name TEXT NOT NULL,
  criterion_code TEXT NOT NULL,
  criterion_text TEXT NOT NULL,
  display_order INTEGER,
  UNIQUE(instrument_version_id, criterion_code)
);

CREATE TABLE IF NOT EXISTS ipc_assessments (
  assessment_id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES monitoring_visits(visit_id),
  criterion_id TEXT NOT NULL REFERENCES ipc_criteria(criterion_id),
  result_code TEXT NOT NULL CHECK (result_code IN ('compliant','partially_compliant','non_compliant','not_applicable','no_data')),
  comment TEXT,
  evidence_file_key TEXT,
  assessed_by TEXT,
  assessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(visit_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  recommendation_id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(facility_id),
  visit_id TEXT REFERENCES monitoring_visits(visit_id),
  criterion_id TEXT REFERENCES ipc_criteria(criterion_id),
  issue_description TEXT NOT NULL,
  corrective_action TEXT NOT NULL,
  responsible_person TEXT,
  issued_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','completed','not_completed','verification_required')),
  completed_date TEXT,
  verification_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS amr_ast_results (
  ast_result_id TEXT PRIMARY KEY,
  facility_id TEXT REFERENCES facilities(facility_id),
  hospital_id TEXT NOT NULL,
  hospital_name TEXT NOT NULL,
  region_oblast TEXT,
  territorial_hromada TEXT,
  settlement TEXT,
  patient_id TEXT NOT NULL,
  sample_id TEXT NOT NULL,
  isolate_id TEXT NOT NULL,
  sampling_date TEXT NOT NULL,
  sample_matrix_type TEXT NOT NULL,
  bacterial_species TEXT NOT NULL,
  antimicrobial_agent TEXT NOT NULL,
  mic_operator TEXT CHECK (mic_operator IN ('<','<=','=','>=','>') OR mic_operator IS NULL),
  mic_value TEXT,
  zone_diameter REAL,
  sir_category TEXT CHECK (sir_category IN ('S','I','R') OR sir_category IS NULL),
  interpretation_standard TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(isolate_id, antimicrobial_agent, interpretation_standard)
);

CREATE TABLE IF NOT EXISTS amr_wgs_results (
  wgs_result_id TEXT PRIMARY KEY,
  sample_id TEXT NOT NULL,
  isolate_id TEXT NOT NULL,
  sequencing_date TEXT,
  sequencing_platform TEXT,
  mlst_st TEXT,
  serotype_k_o_antigen TEXT,
  amr_genotype_genes TEXT,
  point_mutations TEXT,
  virulence_genes TEXT,
  plasmid_replicon_type TEXT,
  fasta_fastq_file_link TEXT,
  assembly_accession TEXT,
  biosample_id TEXT,
  sra_accession TEXT,
  analysis_pipeline TEXT,
  analysis_version TEXT,
  quality_control_status TEXT,
  analysis_date TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_logs (
  import_id TEXT PRIMARY KEY,
  source_filename TEXT NOT NULL,
  data_module TEXT NOT NULL CHECK (data_module IN ('amr_ast','amr_wgs','ipc','facilities','recommendations')),
  imported_by TEXT,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rows_received INTEGER NOT NULL DEFAULT 0,
  rows_accepted INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_visits_facility_date ON monitoring_visits(facility_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_assessments_visit ON ipc_assessments(visit_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_facility_due ON recommendations(facility_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_amr_ast_facility_date ON amr_ast_results(facility_id, sampling_date);
CREATE INDEX IF NOT EXISTS idx_amr_ast_sample ON amr_ast_results(sample_id, isolate_id);
CREATE INDEX IF NOT EXISTS idx_amr_ast_organism_drug ON amr_ast_results(bacterial_species, antimicrobial_agent);
CREATE INDEX IF NOT EXISTS idx_amr_wgs_isolate ON amr_wgs_results(isolate_id, sample_id);
