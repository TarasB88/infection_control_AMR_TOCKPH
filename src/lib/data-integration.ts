/**
 * Shared contracts for future import adapters.
 * This defines the boundary between Excel / Google Sheets and the domain.
 * It does not connect to Google or persist data yet.
 */
export type ImportSource = 'excel' | 'google_sheets' | 'manual' | 'api';
export type ImportRowIdentity = { sourceSystem: ImportSource; sourceRecordId: string };
export type ImportValidationIssue = {
  rowNumber: number;
  field?: string;
  code: 'missing_required' | 'invalid_value' | 'unknown_facility' | 'duplicate' | 'unmapped_column';
  message: string;
};
export type ImportPreview<T> = {
  source: ImportSource;
  sourceName?: string;
  rows: T[];
  accepted: number;
  rejected: number;
  issues: ImportValidationIssue[];
};
export type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';
export type GoogleSheetsConnection = {
  spreadsheetId: string;
  worksheetName: string;
  direction: SyncDirection;
  enabled: boolean;
  // Credentials are intentionally excluded. Store them as Worker secrets.
};
export type SyncRunSummary = {
  runId: string;
  status: 'pending' | 'running' | 'success' | 'partial' | 'failed';
  rowsRead: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  errors: string[];
};
