interface LocalD1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  error?: string;
  meta?: { changes?: number };
}

interface LocalD1PreparedStatement {
  bind(...values: unknown[]): LocalD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<LocalD1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<LocalD1Result<T>>;
}

interface LocalD1Database {
  prepare(query: string): LocalD1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: LocalD1PreparedStatement[]): Promise<LocalD1Result<T>[]>;
}

interface WorkerEnv {
  DB?: LocalD1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  INITIAL_ADMIN_EMAIL?: string;
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

type AccessJwk = JsonWebKey & { kid?: string };
type AccessJwtPayload = { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string; name?: string; sub?: string };
type UserRole = 'admin' | 'operator' | 'analyst';
type UserProfileRow = { id: string; email: string; full_name: string; role: UserRole; is_active: number; all_facilities: number };
type AuthenticatedUser = UserProfileRow & { facilityCodes: string[] };
type AccessResult = { identity: { email: string; name: string }; error?: never } | { identity?: never; error: Response };

let accessJwksCache: AccessJwk[] = [];
let accessJwksCachedAt = 0;

const decodeBase64Url = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const decodeJwtJson = <T,>(value: string): T =>
  JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;

const getAccessJwks = async (domain: string): Promise<AccessJwk[]> => {
  const now = Date.now();
  if (accessJwksCache.length && now - accessJwksCachedAt < 300000) return accessJwksCache;
  const response = await fetch('https://' + domain + '/cdn-cgi/access/certs', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Access certificates unavailable');
  const body = await response.json() as { keys?: AccessJwk[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('Access certificate set is empty');
  accessJwksCache = body.keys;
  accessJwksCachedAt = now;
  return accessJwksCache;
};

const verifyAccessIdentity = async (request: Request, env: WorkerEnv): Promise<AccessResult> => {
  const domain = text(env.ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  const audience = text(env.ACCESS_AUD);
  if (!domain || !audience) return { error: json({ error: 'access_not_configured', message: 'Не налаштовано ACCESS_TEAM_DOMAIN та ACCESS_AUD у Worker.' }, 503) };
  const token = request.headers.get('cf-access-jwt-assertion') ?? '';
  if (!token) return { error: json({ error: 'access_login_required', message: 'Потрібна авторизація через Cloudflare Access.' }, 401) };
  const parts = token.split('.');
  if (parts.length !== 3) return { error: json({ error: 'invalid_access_token' }, 401) };

  try {
    const header = decodeJwtJson<{ alg?: string; kid?: string }>(parts[0]);
    const payload = decodeJwtJson<AccessJwtPayload>(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return { error: json({ error: 'invalid_access_token' }, 401) };
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud ?? ''];
    if (payload.iss !== 'https://' + domain || !audiences.includes(audience) ||
        !payload.exp || payload.exp <= now || (payload.nbf !== undefined && payload.nbf > now) || !payload.email) {
      return { error: json({ error: 'access_claims_invalid' }, 401) };
    }

    let jwk = (await getAccessJwks(domain)).find(key => key.kid === header.kid);
    if (!jwk) {
      accessJwksCachedAt = 0;
      jwk = (await getAccessJwks(domain)).find(key => key.kid === header.kid);
    }
    if (!jwk) return { error: json({ error: 'access_signing_key_not_found' }, 401) };
    const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodeBase64Url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!valid) return { error: json({ error: 'access_signature_invalid' }, 401) };
    return { identity: { email: payload.email.trim().toLowerCase(), name: text(payload.name) || payload.email.trim() } };
  } catch {
    return { error: json({ error: 'access_verification_failed', message: 'Не вдалося перевірити Cloudflare Access JWT. Перевірте домен команди й сертифікати.' }, 503) };
  }
};

const getAuthenticatedUser = async (request: Request, env: WorkerEnv):
  Promise<{ user: AuthenticatedUser; error?: never } | { user?: never; error: Response }> => {
  const verified = await verifyAccessIdentity(request, env);
  if (verified.error) return { error: verified.error };
  if (!env.DB) return { error: json({ error: 'database_unavailable' }, 503) };
  const email = verified.identity.email;
  const initialAdminEmail = text(env.INITIAL_ADMIN_EMAIL).toLowerCase();
  if (initialAdminEmail && email === initialAdminEmail) {
    const bootstrapId = 'usr_' + (await sha256(email)).slice(0, 40);
    await env.DB.prepare(
      'INSERT INTO user_profiles (id, email, full_name, role, is_active, all_facilities) VALUES (?, ?, ?, ?, 1, 1) ON CONFLICT(email) DO NOTHING',
    ).bind(bootstrapId, email, verified.identity.name, 'admin').run();
  }
  const profile = await env.DB.prepare(
    'SELECT id, email, full_name, role, is_active, all_facilities FROM user_profiles WHERE email = ? COLLATE NOCASE',
  ).bind(email).first<UserProfileRow>();
  if (!profile) return { error: json({ error: 'profile_not_provisioned', message: 'Ваш профіль ще не створено адміністратором системи.' }, 403) };
  if (profile.is_active !== 1) return { error: json({ error: 'profile_inactive', message: 'Обліковий запис деактивовано.' }, 403) };
  const scope = await env.DB.prepare('SELECT facility_code FROM user_facility_access WHERE user_id = ? ORDER BY facility_code')
    .bind(profile.id).all<{ facility_code: string }>();
  return { user: { ...profile, facilityCodes: (scope.results ?? []).map(item => item.facility_code) } };
};

const userCanWrite = (user: AuthenticatedUser): boolean => user.role === 'admin' || user.role === 'operator';
const userCanAccessFacility = (user: AuthenticatedUser, code: string): boolean =>
  user.role === 'admin' || user.all_facilities === 1 || user.facilityCodes.includes(code);
const publicUser = (user: AuthenticatedUser) => ({
  id: user.id, email: user.email, fullName: user.full_name, role: user.role,
  isActive: user.is_active === 1, allFacilities: user.all_facilities === 1 || user.role === 'admin',
  facilityCodes: user.facilityCodes,
});

const handleAdminUsers = async (request: Request, env: WorkerEnv, actor: AuthenticatedUser): Promise<Response> => {
  if (actor.role !== 'admin') return json({ error: 'forbidden', message: 'Потрібна роль адміністратора.' }, 403);
  if (!env.DB) return json({ error: 'database_unavailable' }, 503);
  if (request.method === 'GET') {
    const profiles = await env.DB.prepare('SELECT id, email, full_name, role, is_active, all_facilities, created_at FROM user_profiles ORDER BY full_name, email')
      .all<UserProfileRow & { created_at: string }>();
    const scopes = await env.DB.prepare('SELECT user_id, facility_code FROM user_facility_access ORDER BY facility_code')
      .all<{ user_id: string; facility_code: string }>();
    const map = new Map<string, string[]>();
    for (const item of scopes.results ?? []) map.set(item.user_id, [...(map.get(item.user_id) ?? []), item.facility_code]);
    return json({ users: (profiles.results ?? []).map(p => ({
      id: p.id, email: p.email, fullName: p.full_name, role: p.role, isActive: p.is_active === 1,
      allFacilities: p.all_facilities === 1 || p.role === 'admin', facilityCodes: map.get(p.id) ?? [], createdAt: p.created_at,
    })) });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body: { email?: unknown; fullName?: unknown; role?: unknown; isActive?: unknown; allFacilities?: unknown; facilityCodes?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ error: 'invalid_json' }, 400); }
  const email = text(body.email).toLowerCase();
  const fullName = text(body.fullName) || email;
  const role = text(body.role) as UserRole;
  const isActive = body.isActive === undefined ? true : body.isActive === true;
  const allFacilities = body.allFacilities === true || role === 'admin';
  const facilityCodes = Array.isArray(body.facilityCodes) ? [...new Set(body.facilityCodes.map(text).filter(Boolean))] : [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (!['admin', 'operator', 'analyst'].includes(role)) return json({ error: 'invalid_role' }, 400);
  if (facilityCodes.length > 500 || facilityCodes.some(code => code.length > 120)) return json({ error: 'invalid_facility_scope' }, 400);

  const existing = await env.DB.prepare('SELECT id, role, is_active FROM user_profiles WHERE email = ? COLLATE NOCASE')
    .bind(email).first<{ id: string; role: UserRole; is_active: number }>();
  const userId = existing?.id ?? crypto.randomUUID();
  if (email === actor.email && (role !== 'admin' || !isActive)) return json({ error: 'cannot_remove_own_admin_access' }, 409);
  if (existing?.role === 'admin' && existing.is_active === 1 && (role !== 'admin' || !isActive)) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM user_profiles WHERE role = ? AND is_active = 1')
      .bind('admin').first<{ total: number }>();
    if ((count?.total ?? 0) <= 1) return json({ error: 'last_admin_required' }, 409);
  }

  const statements: LocalD1PreparedStatement[] = [
    env.DB.prepare('INSERT INTO user_profiles (id, email, full_name, role, is_active, all_facilities, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET full_name = excluded.full_name, role = excluded.role, is_active = excluded.is_active, all_facilities = excluded.all_facilities, updated_at = CURRENT_TIMESTAMP')
      .bind(userId, email, fullName, role, isActive ? 1 : 0, allFacilities ? 1 : 0, actor.id),
    env.DB.prepare('DELETE FROM user_facility_access WHERE user_id = ?').bind(userId),
    ...facilityCodes.map(code => env.DB!.prepare('INSERT INTO user_facility_access (user_id, facility_code) VALUES (?, ?)').bind(userId, code)),
    env.DB.prepare('INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), actor.id, 'user_profile_upsert', 'user_profile', userId, JSON.stringify({ email, role, isActive, allFacilities, facilityCodesCount: facilityCodes.length })),
  ];
  await env.DB.batch(statements);
  const saved = await env.DB.prepare('SELECT id, email, full_name, role, is_active, all_facilities FROM user_profiles WHERE id = ?')
    .bind(userId).first<UserProfileRow>();
  const savedScopes = await env.DB.prepare('SELECT facility_code FROM user_facility_access WHERE user_id = ? ORDER BY facility_code')
    .bind(userId).all<{ facility_code: string }>();
  if (!saved) return json({ error: 'profile_save_failed' }, 500);
  return json({ user: publicUser({ ...saved, facilityCodes: (savedScopes.results ?? []).map(x => x.facility_code) }) }, existing ? 200 : 201);
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

const importAst = async (request: Request, env: WorkerEnv, sourceType: 'excel' | 'manual'): Promise<Response> => {
  const authenticated = await getAuthenticatedUser(request, env);
  if (authenticated.error) return authenticated.error;
  const actor = authenticated.user;
  if (!userCanWrite(actor)) return json({ error: 'forbidden', message: 'Ваш профіль має лише права перегляду.' }, 403);
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
  const deniedFacilities = [...new Set(rows.map(row => row.Hospital_ID))].filter(code => !userCanAccessFacility(actor, code));
  if (deniedFacilities.length) return json({ error: 'facility_scope_denied', message: 'Профіль не має доступу до одного або кількох закладів.', deniedFacilityCodes: deniedFacilities }, 403);
  const rejectedRows = rawCount - rows.length;
  const batchId = crypto.randomUUID();
  const sourceName = text(payload.sourceName).slice(0, 250) || 'AST import';

  try {
    await env.DB.prepare(
      `INSERT INTO import_batches (id, source_type, source_name, status, rows_received, rows_rejected, validation_summary, created_by)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).bind(batchId, sourceType, sourceName, rawCount, rejectedRows, JSON.stringify(issues.slice(0, 100)), actor.id).run();

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_system, source_record_id) DO UPDATE SET
           facility_id=excluded.facility_id, pseudonymous_patient_id=excluded.pseudonymous_patient_id,
           sampling_date=excluded.sampling_date, sample_matrix_type=excluded.sample_matrix_type,
           hromada=excluded.hromada, settlement=excluded.settlement, updated_at=CURRENT_TIMESTAMP`,
      ).bind(isolateId, facilityId, row.Sample_ID, patientHash, row.Sampling_Date || null,
        row.Sample_Matrix_Type, row.Bacterial_Species, row.Territorial_Hromada, row.Settlement, batchId, sourceType, isolateSourceId));

      statements.push(env.DB.prepare(
        `INSERT INTO ast_results (id, isolate_id, antimicrobial_agent, mic_operator, mic_value,
           zone_diameter, sir_category, interpretation_standard, source_batch_id, source_system, source_record_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_system, source_record_id) DO UPDATE SET
           mic_operator=excluded.mic_operator, mic_value=excluded.mic_value,
           zone_diameter=excluded.zone_diameter, sir_category=excluded.sir_category,
           interpretation_standard=excluded.interpretation_standard, source_batch_id=excluded.source_batch_id,
           updated_at=CURRENT_TIMESTAMP`,
      ).bind(astId, isolateId, row.Antimicrobial_Agent, row.MIC_Operator || null, row.MIC_Value || null,
        row.Zone_Diameter || null, row.SIR_Category || null, row.Interpretation_Standard, batchId, sourceType, astSourceId));
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
      `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, details_json)
       VALUES (?, ?, 'import', 'amr_ast_batch', ?, ?)`,
    ).bind(crypto.randomUUID(), actor.id, batchId, JSON.stringify({ rowsReceived: rawCount, rowsProcessed: rows.length, rowsRejected: rejectedRows, sourceType })).run();

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

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const authenticated = await getAuthenticatedUser(request, env);
      if (authenticated.error) return authenticated.error;
      return json({ user: publicUser(authenticated.user) });
    }

    if (url.pathname === '/api/admin/users') {
      const authenticated = await getAuthenticatedUser(request, env);
      if (authenticated.error) return authenticated.error;
      return handleAdminUsers(request, env, authenticated.user);
    }

    if (url.pathname === '/api/amr/ast' && request.method === 'GET') {
      const authenticated = await getAuthenticatedUser(request, env);
      if (authenticated.error) return authenticated.error;
      if (!env.DB) return json({ error: 'database_unavailable' }, 503);
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 500)));
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      if (!Number.isFinite(limit) || !Number.isFinite(offset)) return json({ error: 'invalid_pagination' }, 400);
      const actor = authenticated.user;
      const codes = actor.role === 'admin' || actor.all_facilities === 1 ? [] : actor.facilityCodes;
      const scopeSql = actor.role === 'admin' || actor.all_facilities === 1
        ? ''
        : codes.length ? 'WHERE f.external_code IN (' + codes.map(() => '?').join(',') + ')' : 'WHERE 1 = 0';
      try {
        const result = await env.DB.prepare(
          \`SELECT f.external_code AS Hospital_ID, f.name AS Hospital_Name, f.oblast AS Region_Oblast,
             i.hromada AS Territorial_Hromada, i.settlement AS Settlement,
             COALESCE(i.pseudonymous_patient_id, '') AS Patient_ID, i.sample_id AS Sample_ID,
             i.sampling_date AS Sampling_Date, i.sample_matrix_type AS Sample_Matrix_Type,
             i.bacterial_species AS Bacterial_Species, a.antimicrobial_agent AS Antimicrobial_Agent,
             a.mic_operator AS MIC_Operator, a.mic_value AS MIC_Value,
             a.zone_diameter AS Zone_Diameter, a.sir_category AS SIR_Category,
             a.interpretation_standard AS Interpretation_Standard
           FROM ast_results a
           INNER JOIN isolates i ON i.id = a.isolate_id
           INNER JOIN facilities f ON f.id = i.facility_id
           \${scopeSql}
           ORDER BY i.sampling_date DESC, i.sample_id
           LIMIT ? OFFSET ?\`,
        ).bind(...codes, limit, offset).all<AstRow>();
        return json({ rows: result.results ?? [], count: result.results?.length ?? 0, limit, offset });
      } catch {
        return json({ error: 'query_failed', message: 'Не вдалося прочитати AST з D1.' }, 500);
      }
    }

    if (url.pathname === '/api/amr/ast/import' && request.method === 'POST') {
      return importAst(request, env, 'excel');
    }

    if (url.pathname === '/api/amr/ast/manual' && request.method === 'POST') {
      return importAst(request, env, 'manual');
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
