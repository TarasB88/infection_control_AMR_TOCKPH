export type AppUser = {
  username: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'analyst';
  facilityCodes: string;
};

export type ManagedUser = {
  Username: string;
  Email: string;
  Full_Name: string;
  Role: 'admin' | 'operator' | 'analyst';
  Is_Active: string;
  Facility_Codes: string;
  Created_At: string;
  Updated_At: string;
};

export type AuthStatus = {
  userCount: number;
  bootstrapConfigured: boolean;
};

export type SheetRecord = Record<string, string>;

export const GOOGLE_SHEET_TABS = [
  'Facilities',
  'Facility_IPC_Profile',
  'IPC_Visits',
  'IPC_Assessments',
  'Recommendations',
  'Legal_Acts',
  'Training_Events',
  'Training_Facility_Stats',
  'AST_Data',
  'WGS_Staging',
  'Dictionaries',
] as const;

export type GoogleSheetTab = typeof GOOGLE_SHEET_TABS[number];

let sessionToken = '';

const apiRequest = async <T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> => {
  const headers = new Headers(init.headers || {});
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (authenticated && sessionToken) headers.set('Authorization', 'Bearer ' + sessionToken);

  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error || 'Помилка API: HTTP ' + response.status);
  return result;
};

export const getAuthStatus = (): Promise<AuthStatus> =>
  apiRequest<AuthStatus>('/api/auth/status', { method: 'GET' }, false);

export const loginWithPassword = async (username: string, password: string): Promise<AppUser> => {
  const result = await apiRequest<{ token: string; user: AppUser }>(
    '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ username, password }) },
    false
  );
  if (!result.token || !result.user) throw new Error('Сервер не повернув обліковий сеанс.');
  sessionToken = result.token;
  return result.user;
};

export const bootstrapAdmin = async (input: {
  bootstrapKey: string;
  username: string;
  password: string;
  email: string;
  name: string;
}): Promise<AppUser> => {
  const result = await apiRequest<{ token: string; user: AppUser }>(
    '/api/auth/bootstrap',
    { method: 'POST', body: JSON.stringify(input) },
    false
  );
  if (!result.token || !result.user) throw new Error('Сервер не повернув сеанс адміністратора.');
  sessionToken = result.token;
  return result.user;
};

export const clearGoogleSession = (): void => {
  sessionToken = '';
};

export const createMissingSheetTabs = async (names: string[]): Promise<void> => {
  await apiRequest('/api/sheets/ensure', { method: 'POST', body: JSON.stringify({ names }) });
};

export const readSheetTable = async (sheet: GoogleSheetTab): Promise<{ headers: string[]; rows: SheetRecord[] }> =>
  apiRequest<{ headers: string[]; rows: SheetRecord[] }>('/api/sheets/' + encodeURIComponent(sheet), { method: 'GET' });

export const appendSheetRows = async (
  sheet: GoogleSheetTab,
  _headers: string[],
  rows: Array<Array<string | number | boolean>>,
): Promise<void> => {
  if (!rows.length) return;
  await apiRequest('/api/sheets/' + encodeURIComponent(sheet), {
    method: 'POST',
    body: JSON.stringify({ rows })
  });
};

export const listUsers = async (): Promise<ManagedUser[]> => {
  const result = await apiRequest<{ users: ManagedUser[] }>('/api/admin/users', { method: 'GET' });
  return result.users || [];
};

export const createUser = async (input: {
  username: string;
  password: string;
  email: string;
  name: string;
  role: ManagedUser['Role'];
  facilityCodes: string;
}): Promise<void> => {
  await apiRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(input) });
};

export const updateUser = async (input: {
  username: string;
  role?: ManagedUser['Role'];
  isActive?: boolean;
}): Promise<void> => {
  await apiRequest('/api/admin/users', { method: 'PATCH', body: JSON.stringify(input) });
};
