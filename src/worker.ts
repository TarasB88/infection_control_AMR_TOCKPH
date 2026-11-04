interface LocalD1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  error?: string;
  meta?: { changes?: number };
}

interface LocalD1PreparedStatement {
  bind(...values: unknown[]): LocalD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<LocalD1Result<T>>;
}

interface LocalD1Database {
  prepare(query: string): LocalD1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: LocalD1PreparedStatement[]): Promise<LocalD1Result<T>[]>;
}

interface WorkerEnv {
  DB?: LocalD1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  API_TOKEN?: string;
  PATIENT_HMAC_SECRET?: string;
}

type AstRow = {
  Hospital_ID: string;
  Hospital_Name: string;
  Region_Oblast: string;
  Territorial_Hromada: string;
  Settlement: string;
  Patient_ID: string;
  Sample_ID: string;
  Sampling_Date: string;
  Sample_Matrix_Type: string;
  Bacterial_Species: string;
  Antimicrobial_Agent: string;
  MIC_Operator: string;
  MIC_Value: string;
  Zone_Diameter: string;
  SIR_Category: string;
  Interpretation_Standard: string;
};

const REQUIRED_FIELDS: (keyof AstRow)[] = [
  'Hospital_ID', 'Hospital_Name', 'Region_Oblast', 'Territorial_Hromada',
  'Settlement', 'Patient_ID', 'Sample_ID', 'Sampling_Date',
  'Sample_Matrix_Type', 'Bacterial_Species', 'Antimicrobial_Agent',
  'MIC_Operator', 'MIC_Value', 'Zone_Diameter', 'SIR_Category',
  'Interpretation_Standard',
];

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

const text = (value: unknown): string => String(value ?? '').trim();

const constantTimeEqual = (left: string, right: string): boolean => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

const hmacPatientId = async (value: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
};

const authorized = (request: Request, env: WorkerEnv): boolean => {
  const token = env.API_TOKEN;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return Boolean(token && supplied && constantTimeEqual(supplied, token));
};

const validateRows = (input: unknown): { rows: AstRow[]; issues: { rowNumber: number; field: string; message: string }[] } => {
  if (!Array.isArray(input)) return { rows: [], issues: [{ rowNumber: 0, field: 'rows', message: 'Очікується масив рядків.' }] };
  const rows: AstRow[] = [];
  const issues: { rowNumber: number; field: string; message: string }[] = [];
  input.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      issues.push({ rowNumber: index + 2, field: 'row', message: 'Рядок має бути об’єктом.' });
      return;
    }
    const source = candidate as Record<string, unknown>;
    const row = Object.fromEntries(REQUIRED_FIELDS.map(field => [field, text(source[field])])) as AstRow;
    let valid = true;
    for (const field of REQUIRED_FIELDS) {
      if (!row[field] && !['Patient_ID', 'MIC_Operator', 'MIC_Value', 'Zone_Diameter'].includes(field)) {
        issues.push({ rowNumber: index + 2, field, message: 'Обов’язкове поле не може бути порожнім.' });
        valid = false;
      }
    }
    if (row.SIR_Category && !['S', 'I', 'R'].includes(row.SIR_Category.toUpperCase())) {
      issues.push({ rowNumber: index + 2, field: 'SIR_Category', message: 'Допустимі лише S, I, R або порожнє значення.' });
      valid = false;
    }
    if (row.Sampling_Date && !/^\d{4}-\d{2}-\d{2}$/.test(row.Sampling_Date)) {
      issues.push({ rowNumber: index + 2, field: 'Sampling_Date', message: 'Дата має бути у форматі YYYY-MM-DD.' });
      valid = false;
    }
    if (row.MIC_Operator && !['=', '<', '>', '<=', '>=', '≤', '≥'].includes(row.MIC_Operator)) {
      issues.push({ rowNumber: index + 2, field: 'MIC_Operator', message: 'Непідтримуваний оператор MIC.' });
      valid = false;
    }
    if (valid) {
      row.SIR_Category = row.SIR_Category.toUpperCase();
      rows.push(row);
    }
  });
  return { rows, issues };
};

const importAst = async (request: Request, env: WorkerEnv): Promise<Response> => {
  if (!authorized(request, env)) return json({ error: 'unauthorized', message: 'Потрібна авторизація.' }, 401);
  if (!env.DB) return json({ error: 'database_unavailable' }, 503);
  if (!env.PATIENT_HMAC_SECRET || env.PATIENT_HMAC_SECRET.length < 32) {
    return json({ error: 'pseudonymization_not_configured', message: 'Не налаштовано PATIENT_HMAC_SECRET (мінімум 32 символи).' }, 503);
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 5_000_000) return json({ error: 'payload_too_large' }, 413);

  let payload: { sourceName?: unknown; rows?: unknown };
  try {
    payload = await request.json() as { sourceName?: unknown; rows?: unknown };
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const rawCount = Array.isArray(payload.rows) ? payload.rows.length : 0;
  if (rawCount < 1 || rawCount > 1000) {
    return json({ error: 'invalid_row_count', message: 'За один запит можна передати від 1 до 1000 рядків.' }, 400);
  }

  const { rows, issues } = validateRows(payload.rows);
  const rejectedRows = rawCount - rows.length;
  const batchId = crypto.randomUUID();
  const sourceName = text(payload.sourceName).slice(0, 250) || 'AST import';

  try {
    await env.DB.prepare(
      `INSERT INTO import_batches (id, source_type, source_name, status, rows_received, rows_rejected, validation_summary)
       VALUES (?, 'excel', ?, 'pending', ?, ?, ?)`,
    ).bind(batchId, sourceName, rawCount, rejectedRows, JSON.stringify(issues.slice(0, 100))).run();

    if (rows.length === 0) {
      await env.DB.prepare(
        `UPDATE import_batches SET status = 'rejected', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(batchId).run();
      return json({ batchId, status: 'rejected', rowsReceived: rawCount, rowsInserted: 0, rowsRejected: rejectedRows, issues }, 422);
    }

    const statements: LocalD1PreparedStatement[] = [];
    for (const row of rows) {
      const facilityId = `fac_${(await sha256(row.Hospital_ID)).slice(0, 40)}`;
      const patientHash = row.Patient_ID ? await hmacPatientId(row.Patient_ID, env.PATIENT_HMAC_SECRET) : null;
      const isolateSourceId = await sha256([row.Hospital_ID, row.Sample_ID, row.Bacterial_Species].join('|'));
      const isolateId = `iso_${isolateSourceId.slice(0, 40)}`;
      const astSourceId = await sha256([isolateSourceId, row.Antimicrobial_Agent, row.Interpretation_Standard].join('|'));
      const astId = `ast_${astSourceId.slice(0, 40)}`;

      statements.push(env.DB.prepare(
        `INSERT INTO facilities (id, external_code, name, oblast, hromada, settlement)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(external_code) DO UPDATE SET name=excluded.name, oblast=excluded.oblast,
           hromada=excluded.hromada, settlement=excluded.settlement, updated_at=CURRENT_TIMESTAMP`,
      ).bind(facilityId, row.Hospital_ID, row.Hospital_Name, row.Region_Oblast, row.Territorial_Hromada, row.Settlement));

      statements.push(env.DB.prepare(
        `INSERT INTO isolates (id, facility_id, sample_id, pseudonymous_patient_id, sampling_date,
           sample_matrix_type, bacterial_species, hromada, settlement, source_batch_id, source_system, source_record_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'excel', ?)
         ON CONFLICT(source_system, source_record_id) DO UPDATE SET
           facility_id=excluded.facility_id, pseudonymous_patient_id=excluded.pseudonymous_patient_id,
           sampling_date=excluded.sampling_date, sample_matrix_type=excluded.sample_matrix_type,
           hromada=excluded.hromada, settlement=excluded.settlement, updated_at=CURRENT_TIMESTAMP`,
      ).bind(isolateId, facilityId, row.Sample_ID, patientHash, row.Sampling_Date || null,
        row.Sample_Matrix_Type, row.Bacterial_Species, row.Territorial_Hromada, row.Settlement, batchId, isolateSourceId));

      statements.push(env.DB.prepare(
        `INSERT INTO ast_results (id, isolate_id, antimicrobial_agent, mic_operator, mic_value,
           zone_diameter, sir_category, interpretation_standard, source_batch_id, source_system, source_record_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'excel', ?)
         ON CONFLICT(source_system, source_record_id) DO UPDATE SET
           mic_operator=excluded.mic_operator, mic_value=excluded.mic_value,
           zone_diameter=excluded.zone_diameter, sir_category=excluded.sir_category,
           interpretation_standard=excluded.interpretation_standard, source_batch_id=excluded.source_batch_id,
           updated_at=CURRENT_TIMESTAMP`,
      ).bind(astId, isolateId, row.Antimicrobial_Agent, row.MIC_Operator || null, row.MIC_Value || null,
        row.Zone_Diameter || null, row.SIR_Category || null, row.Interpretation_Standard, batchId, astSourceId));
    }

    for (let offset = 0; offset < statements.length; offset += 90) {
      const result = await env.DB.batch(statements.slice(offset, offset + 90));
      if (result.some(item => !item.success)) throw new Error('D1 batch failed');
    }

    await env.DB.prepare(
      `UPDATE import_batches SET status = ?, rows_inserted = ?, rows_rejected = ?,
       validation_summary = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(rejectedRows ? 'validated' : 'committed', rows.length, rejectedRows,
      JSON.stringify(issues.slice(0, 100)), batchId).run();

    await env.DB.prepare(
      `INSERT INTO audit_log (id, action, entity_type, entity_id, details_json)
       VALUES (?, 'import', 'amr_ast_batch', ?, ?)`,
    ).bind(crypto.randomUUID(), batchId, JSON.stringify({ rowsReceived: rawCount, rowsProcessed: rows.length, rowsRejected: rejectedRows })).run();

    return json({
      batchId,
      status: rejectedRows ? 'partial' : 'committed',
      rowsReceived: rawCount,
      rowsProcessed: rows.length,
      rowsRejected: rejectedRows,
      pseudonymizedPatientIds: true,
      issues,
    }, issues.length ? 207 : 201);
  } catch {
    await env.DB.prepare(
      `UPDATE import_batches SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(batchId).run().catch(() => undefined);
    return json({ error: 'import_failed', batchId, message: 'Помилка збереження в D1. Перевірте схему та журнал Worker.' }, 500);
  }
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      if (!env.DB) {
        return json({ status: 'not_configured', database: 'unbound' }, 503);
      }
      try {
        const result = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
        return json({
          status: result?.ok === 1 ? 'ok' : 'degraded',
          database: 'connected',
        }, result?.ok === 1 ? 200 : 503);
      } catch {
        return json({ status: 'error', database: 'connection_failed' }, 503);
      }
    }

    if (url.pathname === '/api/amr/ast/import' && request.method === 'POST') {
      return importAst(request, env);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
