interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SHEETS_SCRIPT_URL?: string;
  SHEETS_BRIDGE_SECRET?: string;
  SESSION_SIGNING_SECRET?: string;
  BOOTSTRAP_KEY?: string;
}
type AppUser = {
  username: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'analyst';
  facilityCodes: string;
};
const SHEET_NAMES = new Set([
  'Facilities','Facility_IPC_Profile','IPC_Visits','IPC_Assessments','Recommendations',
  'Legal_Acts','Training_Events','Training_Facility_Stats','AST_Data','WGS_Staging','Dictionaries'
]);
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PBKDF2_ITERATIONS = 210000;
const encoder = new TextEncoder();
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
function encodeBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/=/g, '').replaceAll('+', '-').replaceAll('/', '_');
}
function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function issueSession(user: AppUser, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({ ...user, iat: now, exp: now + SESSION_TTL_SECONDS }));
  const body = header + '.' + payload;
  return body + '.' + encodeBase64Url(await hmac(secret, body));
}
async function verifySession(request: Request, env: WorkerEnv): Promise<AppUser | null> {
  const secret = env.SESSION_SIGNING_SECRET || '';
  if (secret.length < 32) return null;
  const header = request.headers.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const parts = header.slice(7).trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const signed = parts[0] + '.' + parts[1];
    const expected = await hmac(secret, signed);
    const actual = decodeBase64Url(parts[2]);
    if (expected.length !== actual.length) return null;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ actual[i];
    if (mismatch !== 0) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as AppUser & { exp: number };
    if (!payload.username || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return {
      username: payload.username,
      email: payload.email || '',
      name: payload.name || payload.username,
      role: payload.role,
      facilityCodes: payload.facilityCodes || ''
    };
  } catch {
    return null;
  }
}
async function derivePassword(password: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/.{1,2}/g) || [], pair => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return Array.from(new Uint8Array(bits), byte => byte.toString(16).padStart(2, '0')).join('');
}
function randomHex(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 5_000_000) throw new Error('Request body is too large.');
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid JSON request.');
  return body as Record<string, unknown>;
}
async function bridgeCall(env: WorkerEnv, action: string, payload: Record<string, unknown> = {}): Promise<any> {
  if (!env.SHEETS_SCRIPT_URL || !env.SHEETS_BRIDGE_SECRET) {
    throw new Error('Google Sheets bridge is not configured. Deploy the Apps Script bridge and set Worker secrets.');
  }
  const response = await fetch(env.SHEETS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, action, key: env.SHEETS_BRIDGE_SECRET })
  });
  if (!response.ok) throw new Error('Google Apps Script returned HTTP ' + response.status + '.');
  const result = await response.json() as { ok?: boolean; data?: unknown; error?: string };
  if (!result.ok) throw new Error(result.error || 'Google Sheets bridge request failed.');
  return result.data;
}
async function requireUser(request: Request, env: WorkerEnv): Promise<AppUser> {
  const user = await verifySession(request, env);
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}
function requireRole(user: AppUser, roles: AppUser['role'][]): void {
  if (!roles.includes(user.role)) throw new Error('FORBIDDEN');
}
function normalizeUser(row: Record<string, string>): AppUser {
  return {
    username: String(row.Username || ''),
    email: String(row.Email || ''),
    name: String(row.Full_Name || row.Username || ''),
    role: (String(row.Role || 'analyst') as AppUser['role']),
    facilityCodes: String(row.Facility_Codes || '')
  };
}
async function handleApi(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/health' && request.method === 'GET') {
    return json({
      ok: true,
      sheetsBridgeConfigured: Boolean(env.SHEETS_SCRIPT_URL && env.SHEETS_BRIDGE_SECRET),
      sessionConfigured: Boolean(env.SESSION_SIGNING_SECRET && env.SESSION_SIGNING_SECRET.length >= 32),
      bootstrapConfigured: Boolean(env.BOOTSTRAP_KEY)
    });
  }
  if (path === '/api/auth/status' && request.method === 'GET') {
    const status = await bridgeCall(env, 'authStatus');
    return json({ userCount: Number(status.userCount || 0), bootstrapConfigured: Boolean(env.BOOTSTRAP_KEY) });
  }
  if (path === '/api/auth/bootstrap' && request.method === 'POST') {
    const body = await readBody(request);
    const submittedKey = String(body.bootstrapKey || '');
    if (!env.BOOTSTRAP_KEY || !constantTimeEqual(submittedKey, env.BOOTSTRAP_KEY)) return json({ error: 'Неправильний ключ початкового налаштування.' }, 403);
    if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) return json({ error: 'SESSION_SIGNING_SECRET не налаштовано у Worker.' }, 500);
    const status = await bridgeCall(env, 'authStatus');
    if (Number(status.userCount || 0) !== 0) return json({ error: 'Початковий адміністратор уже створений. Увійдіть зі своїм обліковим записом.' }, 409);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const email = String(body.email || '').trim();
    const name = String(body.name || '').trim();
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) return json({ error: 'Логін має містити 3–40 латинських літер, цифр, крапку, дефіс або підкреслення.' }, 400);
    if (password.length < 12) return json({ error: 'Пароль адміністратора має містити щонайменше 12 символів.' }, 400);
    const salt = randomHex(16);
    const hash = await derivePassword(password, salt);
    await bridgeCall(env, 'createUser', { user: {
      Username: username, Password_Salt: salt, Password_Hash: hash, Email: email,
      Full_Name: name || username, Role: 'admin', Is_Active: 'TRUE',
      Facility_Codes: '*', Created_At: new Date().toISOString(), Updated_At: new Date().toISOString()
    }});
    const user = { username, email, name: name || username, role: 'admin' as const, facilityCodes: '*' };
    if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) return json({ error: 'SESSION_SIGNING_SECRET не налаштовано у Worker.' }, 500);
    return json({ token: await issueSession(user, env.SESSION_SIGNING_SECRET), user });
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    const body = await readBody(request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return json({ error: 'Вкажіть логін і пароль.' }, 400);
    const row = await bridgeCall(env, 'findUser', { username });
    if (!row || !String(row.Is_Active || '').toUpperCase().match(/^(TRUE|1|YES)$/)) return json({ error: 'Неправильний логін або пароль.' }, 401);
    const salt = String(row.Password_Salt || '');
    const expected = String(row.Password_Hash || '');
    if (!salt || !expected) return json({ error: 'Обліковий запис не має налаштованого пароля. Зверніться до адміністратора.' }, 401);
    const actual = await derivePassword(password, salt);
    if (!constantTimeEqual(actual, expected)) return json({ error: 'Неправильний логін або пароль.' }, 401);
    if (!env.SESSION_SIGNING_SECRET || env.SESSION_SIGNING_SECRET.length < 32) return json({ error: 'SESSION_SIGNING_SECRET не налаштовано у Worker.' }, 500);
    const user = normalizeUser(row);
    return json({ token: await issueSession(user, env.SESSION_SIGNING_SECRET), user });
  }
  if (path === '/api/admin/users' && request.method === 'GET') {
    const user = await requireUser(request, env);
    requireRole(user, ['admin']);
    return json({ users: await bridgeCall(env, 'listUsers') });
  }
  if (path === '/api/admin/users' && request.method === 'POST') {
    const admin = await requireUser(request, env);
    requireRole(admin, ['admin']);
    const body = await readBody(request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const email = String(body.email || '').trim();
    const name = String(body.name || '').trim();
    const role = String(body.role || 'operator') as AppUser['role'];
    const facilityCodes = String(body.facilityCodes || '');
    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) return json({ error: 'Некоректний логін.' }, 400);
    if (password.length < 12) return json({ error: 'Пароль має містити щонайменше 12 символів.' }, 400);
    if (!['admin','operator','analyst'].includes(role)) return json({ error: 'Некоректна роль.' }, 400);
    const salt = randomHex(16);
    const hash = await derivePassword(password, salt);
    await bridgeCall(env, 'createUser', { user: {
      Username: username, Password_Salt: salt, Password_Hash: hash, Email: email,
      Full_Name: name || username, Role: role, Is_Active: 'TRUE',
      Facility_Codes: facilityCodes, Created_At: new Date().toISOString(), Updated_At: new Date().toISOString()
    }});
    return json({ created: true });
  }
  if (path === '/api/admin/users' && request.method === 'PATCH') {
    const admin = await requireUser(request, env);
    requireRole(admin, ['admin']);
    const body = await readBody(request);
    const username = String(body.username || '').trim();
    const role = body.role === undefined ? undefined : String(body.role);
    const isActive = body.isActive === undefined ? undefined : Boolean(body.isActive);
    if (!username) return json({ error: 'Username is required.' }, 400);
    if (role !== undefined && !['admin','operator','analyst'].includes(role)) return json({ error: 'Invalid role.' }, 400);
    const patch: Record<string, string> = { Username: username };
    if (role !== undefined) patch.Role = role;
    if (isActive !== undefined) patch.Is_Active = isActive ? 'TRUE' : 'FALSE';
    await bridgeCall(env, 'updateUser', { user: patch });
    return json({ updated: true });
  }
  if (path === '/api/sheets/ensure' && request.method === 'POST') {
    const user = await requireUser(request, env);
    requireRole(user, ['admin']);
    const body = await readBody(request);
    const names = Array.isArray(body.names) ? body.names.map(String).filter(name => SHEET_NAMES.has(name)) : Array.from(SHEET_NAMES);
    await bridgeCall(env, 'ensureSheets', { names });
    return json({ ensured: names.length });
  }
  const sheetPathPrefix = '/api/sheets/';
  const sheetName = path.startsWith(sheetPathPrefix) ? decodeURIComponent(path.slice(sheetPathPrefix.length)) : '';
  if (sheetName && SHEET_NAMES.has(sheetName)) {
    const user = await requireUser(request, env);
    const sheet = sheetName;
    if (request.method === 'GET') {
      const data = await bridgeCall(env, 'readSheet', { sheet });
      return json(data);
    }
    if (request.method === 'POST') {
      requireRole(user, ['admin','operator']);
      const body = await readBody(request);
      if (!Array.isArray(body.rows)) return json({ error: 'Rows must be an array.' }, 400);
      const result = await bridgeCall(env, 'appendRows', { sheet, rows: body.rows });
      return json(result);
    }
  }
  return json({ error: 'API endpoint not found.' }, 404);
}
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'UNAUTHORIZED') return json({ error: 'Сеанс завершився. Увійдіть повторно.' }, 401);
        if (message === 'FORBIDDEN') return json({ error: 'Недостатньо прав для цієї операції.' }, 403);
        return json({ error: message }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};