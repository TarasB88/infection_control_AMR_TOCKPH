-- User accounts and facility-level authorization scopes.
-- Additive only: existing IPC/AMR records are preserved.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'analyst')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  all_facilities INTEGER NOT NULL DEFAULT 0 CHECK (all_facilities IN (0, 1)),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role_active
  ON user_profiles(role, is_active);

CREATE TABLE IF NOT EXISTS user_facility_access (
  user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  facility_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, facility_code)
);

CREATE INDEX IF NOT EXISTS idx_user_facility_access_code
  ON user_facility_access(facility_code);
