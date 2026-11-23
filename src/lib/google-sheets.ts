export type SheetRecord = Record<string, string>;

export const GOOGLE_SHEET_TABS = [
  'Facilities',
  'Facility_IPC_Profile',
  'IPC_Assessments',
  'Legal_Acts',
  'Training_Events',
  'Training_Facility_Stats',
  'AST_Data',
  'WGS_Staging',
  'Dictionaries',
] as const;

export type GoogleSheetTab = typeof GOOGLE_SHEET_TABS[number];

let selectedSpreadsheetId =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('ipc-amr-spreadsheet-id') || ''
    : '';

export const getSelectedSpreadsheet = () => ({ id: selectedSpreadsheetId });

export const setSelectedSpreadsheet = (input: string): string => {
  const value = input.trim();
  if (!value) throw new Error('Вкажіть посилання на публічну Google-книгу або її ID.');

  let id = value;
  if (/^https?:\\/\\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Посилання на Google Sheets має некоректний формат.');
    }
    if (url.hostname !== 'docs.google.com' || !url.pathname.startsWith('/spreadsheets/d/')) {
      throw new Error('Потрібне посилання формату https://docs.google.com/spreadsheets/d/…');
    }
    id = url.pathname.split('/')[3] || '';
  }

  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) {
    throw new Error('Не вдалося визначити ID таблиці. Перевірте посилання Google Sheets.');
  }

  selectedSpreadsheetId = id;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('ipc-amr-spreadsheet-id', id);
  }
  return id;
};

const requireSpreadsheetId = (): string => {
  if (!selectedSpreadsheetId) {
    throw new Error('Спочатку вкажіть посилання на публічну робочу Google-книгу.');
  }
  return selectedSpreadsheetId;
};

const normalizeHeader = (value: string): string =>
  value.toLocaleLowerCase('uk')
    .replace(/[’'"_\\s-]/g, '')
    .replace(/[^a-zа-яіїєґ0-9]/gi, '');

export const readSheetTable = async (
  sheet: GoogleSheetTab,
): Promise<{ headers: string[]; rows: SheetRecord[] }> => {
  const id = encodeURIComponent(requireSpreadsheetId());
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?sheet=${encodeURIComponent(sheet)}&headers=1&tqx=out:json`;
  const response = await fetch(url, {
    headers: { Accept: 'text/plain' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Не вдалося прочитати аркуш ${sheet} (HTTP ${response.status}). Перевірте доступ «Усі, хто має посилання — Читач».`);
  }

  const raw = await response.text();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`Google Sheets не повернув дані аркуша ${sheet}. Перевірте публічний доступ до книги.`);
  }

  let payload: {
    table?: {
      cols?: Array<{ label?: string; id?: string }>;
      rows?: Array<{ c?: Array<{ v?: unknown; f?: string } | null> }>;
    };
  };
  try {
    payload = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error(`Не вдалося розібрати відповідь Google Sheets для аркуша ${sheet}.`);
  }

  const headers = (payload.table?.cols || [])
    .map((column, index) => String(column.label || column.id || `Column_${index + 1}`).trim());

  if (!headers.length) return { headers: [], rows: [] };

  const normalizedHeaders = headers.map(normalizeHeader);
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error(`Аркуш ${sheet}: знайдено дублікати технічних ключів у заголовках.`);
  }

  const rows = (payload.table?.rows || [])
    .map(row => {
      const record: SheetRecord = {};
      headers.forEach((header, index) => {
        const cell = row.c?.[index];
        record[header] = String(cell?.f ?? cell?.v ?? '').trim();
      });
      return record;
    })
    .filter(record => {
      const values = headers.map(header => record[header] ?? '');
      const isRepeatedKeyRow = values.length > 0 && values.every((value, index) =>
        value !== '' && normalizeHeader(value) === normalizedHeaders[index],
      );
      return !isRepeatedKeyRow && values.some(value => value !== '');
    });

  return { headers, rows };
};
