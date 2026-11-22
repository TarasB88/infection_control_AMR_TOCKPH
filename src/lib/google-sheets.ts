export type GoogleProfile = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export type SheetRecord = Record<string, string>;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleSheetsResponse = {
  values?: unknown[][];
};

type GooglePickerBuilder = {
  addView(view: unknown): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setAppId(appId: string): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  setCallback(callback: (data: { action?: string; docs?: Array<{ id?: string; name?: string }> }) => void): GooglePickerBuilder;
  build(): { setVisible(visible: boolean): void };
};
type GooglePickerApi = {
  ViewId: { SPREADSHEETS: unknown };
  Action: { PICKED: string; CANCEL: string };
  PickerBuilder: new () => GooglePickerBuilder;
};
type GoogleGIS = {
  picker?: GooglePickerApi;
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string;
        scope: string;
        callback: (response: GoogleTokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }): { requestAccessToken(options?: { prompt?: string }): void };
    };
  };
};

declare global {
  interface Window {
    google?: GoogleGIS;
    gapi?: { load(name: string, options: { callback: () => void; onerror?: () => void; ontimeout?: () => void; timeout?: number }): void };
  }
}

const configuredClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
const pickerApiKey = import.meta.env.VITE_GOOGLE_API_KEY?.trim() ?? '';
const googleCloudProjectNumber = import.meta.env.VITE_GOOGLE_APP_ID?.trim() ?? '';
let selectedSpreadsheetId = '';
let selectedSpreadsheetName = '';
const scopes = 'openid email profile https://www.googleapis.com/auth/drive.file';
let accessToken = '';
let expiresAt = 0;

export const getSelectedSpreadsheet = () => ({ id: selectedSpreadsheetId, name: selectedSpreadsheetName });
const requireSpreadsheetId = (): string => {
  if (!selectedSpreadsheetId) throw new Error('Спочатку виберіть робочу Google-книгу через вікно Google Picker.');
  return selectedSpreadsheetId;
};
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

export const getMissingGoogleConfiguration = (): string[] => {
  const missing: string[] = [];
  if (!configuredClientId) missing.push('VITE_GOOGLE_CLIENT_ID');
  if (!pickerApiKey) missing.push('VITE_GOOGLE_API_KEY');
  if (!googleCloudProjectNumber) missing.push('VITE_GOOGLE_APP_ID');
  return missing;
};
export const googleClientConfigured = (): boolean => getMissingGoogleConfiguration().length === 0;

export const clearGoogleSession = (): void => {
  accessToken = '';
  expiresAt = 0;
  selectedSpreadsheetId = '';
  selectedSpreadsheetName = '';
};

export const getGoogleAccessToken = (): string => {
  if (!accessToken || Date.now() >= expiresAt) {
    clearGoogleSession();
    throw new Error('Сеанс Google завершився. Увійдіть через Google повторно.');
  }
  return accessToken;
};

/**
 * Starts Google's browser-based OAuth token flow.
 * The OAuth client ID is public configuration, not a client secret.
 * Tokens are kept in memory only and are never written to localStorage or D1.
 */
export const signInWithGoogle = (): Promise<string> => {
  if (!configuredClientId) {
    return Promise.reject(new Error('Не задано VITE_GOOGLE_CLIENT_ID. Потрібні публічні параметри Google Cloud: OAuth Client ID, API key і номер проєкту для Google Picker.'));
  }
  if (!window.google?.accounts?.oauth2) {
    return Promise.reject(new Error('Бібліотека Google Identity Services ще не завантажилася. Оновіть сторінку та повторіть вхід.'));
  }

  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: configuredClientId,
      scope: scopes,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google не надав доступ до таблиці.'));
          return;
        }
        accessToken = response.access_token;
        expiresAt = Date.now() + Math.max(60, Number(response.expires_in || 3600) - 60) * 1000;
        resolve(accessToken);
      },
      error_callback: (error) => reject(new Error(error.message || 'Не вдалося відкрити вікно авторизації Google.')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
};

const googleFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const token = getGoogleAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  if (response.status === 401) {
    clearGoogleSession();
    throw new Error('Google завершив сеанс доступу. Увійдіть через Google повторно.');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let message = `Google API повернув HTTP ${response.status}.`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
      if (parsed.error?.message) message += ' ' + parsed.error.message;
    } catch {
      // Keep the stable HTTP error if Google returns a non-JSON response.
    }
    if (response.status === 403) {
      message += ' Переконайтеся, що цей Google-акаунт має доступ до робочої таблиці, а Google Sheets API увімкнено.';
    }
    throw new Error(message);
  }
  return response;
};

export const getGoogleProfile = async (): Promise<GoogleProfile> => {
  const response = await googleFetch('https://www.googleapis.com/oauth2/v3/userinfo');
  const profile = await response.json() as GoogleProfile;
  if (!profile.email || profile.email_verified === false) {
    throw new Error('Google не повернув підтверджену адресу електронної пошти.');
  }
  return profile;
};

const ensurePickerLoaded = async (): Promise<GooglePickerApi> => {
  if (!pickerApiKey || !googleCloudProjectNumber) {
    throw new Error('Для Google Picker потрібні VITE_GOOGLE_API_KEY і VITE_GOOGLE_APP_ID. API key має бути обмежений за HTTP referrer.');
  }
  if (!window.gapi) throw new Error('Google Picker API ще не завантажився. Оновіть сторінку та повторіть вхід.');
  await new Promise<void>((resolve, reject) => {
    window.gapi!.load('picker', {
      callback: resolve,
      onerror: () => reject(new Error('Не вдалося завантажити Google Picker API.')),
      ontimeout: () => reject(new Error('Час очікування Google Picker API вичерпано.')),
      timeout: 10000,
    });
  });
  if (!window.google?.picker) throw new Error('Google Picker не ініціалізовано.');
  return window.google.picker;
};

export const selectSpreadsheetWithPicker = async (): Promise<{ id: string; name: string }> => {
  const token = getGoogleAccessToken();
  const pickerApi = await ensurePickerLoaded();
  return new Promise((resolve, reject) => {
    const picker = new pickerApi.PickerBuilder()
      .addView(pickerApi.ViewId.SPREADSHEETS)
      .setOAuthToken(token)
      .setDeveloperKey(pickerApiKey)
      .setAppId(googleCloudProjectNumber)
      .setTitle('Виберіть робочу книгу IPC & AMR')
      .setCallback(data => {
        if (data.action === pickerApi.Action.PICKED && data.docs?.[0]?.id) {
          selectedSpreadsheetId = data.docs[0].id;
          selectedSpreadsheetName = data.docs[0].name || 'Google Sheets workbook';
          resolve({ id: selectedSpreadsheetId, name: selectedSpreadsheetName });
        } else if (data.action === pickerApi.Action.CANCEL) {
          reject(new Error('Вибір робочої книги скасовано.'));
        }
      })
      .build();
    picker.setVisible(true);
  });
};

const quoteSheet = (sheet: string): string => `'${sheet.replace(/'/g, "''")}'`;

export const readSheetTable = async (sheet: GoogleSheetTab): Promise<{ headers: string[]; rows: SheetRecord[] }> => {
  const range = encodeURIComponent(`${quoteSheet(sheet)}!A:ZZ`);
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(requireSpreadsheetId())}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`,
  );
  const data = await response.json() as GoogleSheetsResponse;
  const values = Array.isArray(data.values) ? data.values : [];
  const headers = (values[0] || []).map(value => String(value ?? '').trim());
  if (!headers.length) return { headers: [], rows: [] };
  if (headers.some(header => !header)) {
    throw new Error(`Аркуш ${sheet}: заголовки містять порожні клітинки в першому рядку.`);
  }
  const normalized = headers.map(header => header.toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Аркуш ${sheet}: знайдено дублікати назв колонок.`);
  }
  const rows = values.slice(1).filter(row => row.some(value => String(value ?? '').trim() !== '')).map(row => {
    const record: SheetRecord = {};
    headers.forEach((header, index) => {
      record[header] = String(row[index] ?? '').trim();
    });
    return record;
  });
  return { headers, rows };
};

export const appendSheetRows = async (
  sheet: GoogleSheetTab,
  headers: string[],
  rows: Array<Array<string | number | boolean>>,
): Promise<void> => {
  if (!rows.length) return;
  if (!headers.length) throw new Error(`Аркуш ${sheet}: немає заголовків для зіставлення колонок.`);
  const range = encodeURIComponent(`${quoteSheet(sheet)}!A:${columnName(headers.length)}`);
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(requireSpreadsheetId())}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values: rows }),
    },
  );
  await response.json().catch(() => undefined);
};

export const updateSheetRow = async (
  sheet: GoogleSheetTab,
  rowNumber: number,
  headers: string[],
  row: Array<string | number | boolean>,
): Promise<void> => {
  if (rowNumber < 2) throw new Error('Не можна перезаписувати рядок заголовків.');
  if (row.length !== headers.length) throw new Error('Кількість значень не відповідає кількості колонок.');
  const range = encodeURIComponent(`${quoteSheet(sheet)}!A${rowNumber}:${columnName(headers.length)}${rowNumber}`);
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(requireSpreadsheetId())}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ majorDimension: 'ROWS', values: [row] }),
    },
  );
  await response.json().catch(() => undefined);
};

export const getSpreadsheetMetadata = async (): Promise<Array<{ title: string; sheetId: number }>> => {
  const fields = encodeURIComponent('sheets.properties(title,sheetId)');
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(requireSpreadsheetId())}?fields=${fields}`,
  );
  const data = await response.json() as { sheets?: Array<{ properties?: { title?: string; sheetId?: number } }> };
  return (data.sheets || []).map(sheet => ({
    title: sheet.properties?.title || '',
    sheetId: Number(sheet.properties?.sheetId ?? -1),
  })).filter(sheet => sheet.title && sheet.sheetId >= 0);
};

export const createMissingSheetTabs = async (names: string[]): Promise<void> => {
  const existing = new Set((await getSpreadsheetMetadata()).map(sheet => sheet.title));
  const missing = names.filter(name => !existing.has(name));
  if (!missing.length) return;
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(requireSpreadsheetId())}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: missing.map(title => ({ addSheet: { properties: { title } } })),
      }),
    },
  );
};

export const getSpreadsheetTabs = async (): Promise<string[]> => {
  const fields = encodeURIComponent('sheets.properties(title,sheetId)');
  const response = await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(requireSpreadsheetId())}?fields=${fields}`,
  );
  const data = await response.json() as { sheets?: Array<{ properties?: { title?: string } }> };
  return (data.sheets || []).map(sheet => sheet.properties?.title || '').filter(Boolean);
};

const columnName = (column: number): string => {
  let value = column;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};
