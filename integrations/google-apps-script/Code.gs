/**
 * IPC & AMR Google Sheets bridge.
 *
 * Deploy as a Web App (execute as the spreadsheet owner; restrict access as tightly
 * as the deployment model permits). Set Script Properties:
 *   SPREADSHEET_ID = 1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc
 *   BRIDGE_TOKEN   = a random secret of at least 32 characters
 *
 * All calls are POST JSON. Never expose BRIDGE_TOKEN in browser code.
 * This bridge deliberately does not create, rename, or clear sheets.
 */
const CONFIG = Object.freeze({
  spreadsheetId: '1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc',
  allowedSheets: [
    'Facilities',
    'Facility_IPC_Profile',
    'IPC_Assessments',
    'Legal_Acts',
    'Training_Events',
    'Training_Facility_Stats',
    'AST_Data',
    'WGS_Staging',
    'Users',
    'Dictionaries'
  ],
  maxRows: 5000,
  maxPayloadBytes: 900000
});

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!raw || raw.length > CONFIG.maxPayloadBytes) return output_({ ok: false, error: 'invalid_payload' }, 413);
    const body = JSON.parse(raw);
    const expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_TOKEN') || '';
    if (expected.length < 32 || !constantTimeEqual_(String(body.token || ''), expected)) {
      return output_({ ok: false, error: 'unauthorized' }, 401);
    }

    const ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || CONFIG.spreadsheetId;
    const ss = SpreadsheetApp.openById(ssId);
    const action = String(body.action || '');

    if (action === 'listSheets') {
      return output_({
        ok: true,
        spreadsheetId: ssId,
        sheets: ss.getSheets().map(s => ({
          name: s.getName(),
          rows: Math.max(0, s.getLastRow() - 1),
          columns: s.getLastColumn()
        }))
      });
    }

    const sheetName = String(body.sheet || '');
    if (!CONFIG.allowedSheets.includes(sheetName)) return output_({ ok: false, error: 'sheet_not_allowed' }, 400);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return output_({ ok: false, error: 'sheet_not_found', sheet: sheetName }, 404);

    if (action === 'getRows') {
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < 1 || lastCol < 1) return output_({ ok: true, sheet: sheetName, headers: [], rows: [] });
      const values = sheet.getRange(1, 1, Math.min(lastRow, CONFIG.maxRows + 1), lastCol).getDisplayValues();
      const headers = values.shift().map(v => String(v).trim());
      if (headers.some(h => !h)) return output_({ ok: false, error: 'blank_header', sheet: sheetName }, 422);
      const rows = values.filter(row => row.some(cell => cell !== '')).map(row => {
        const item = {};
        headers.forEach((header, i) => item[header] = row[i] == null ? '' : row[i]);
        return item;
      });
      return output_({ ok: true, sheet: sheetName, headers, rows, rowCount: rows.length });
    }

    if (action === 'upsertRows') {
      if (!Array.isArray(body.rows) || body.rows.length > 1000) return output_({ ok: false, error: 'invalid_rows' }, 400);
      const keyColumn = String(body.keyColumn || '');
      const headers = sheet.getLastColumn()
        ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(v => String(v).trim())
        : [];
      if (!headers.length || !keyColumn || !headers.includes(keyColumn)) {
        return output_({ ok: false, error: 'invalid_key_column_or_headers' }, 422);
      }
      const existing = sheet.getLastRow() > 1
        ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
        : [];
      const keyIndex = headers.indexOf(keyColumn);
      const index = new Map();
      existing.forEach((row, i) => {
        const key = String(row[keyIndex] == null ? '' : row[keyIndex]).trim();
        if (key) index.set(key, i + 2);
      });
      let updated = 0, inserted = 0;
      body.rows.forEach(record => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid_record');
        const key = String(record[keyColumn] == null ? '' : record[keyColumn]).trim();
        if (!key) throw new Error('missing_key:' + keyColumn);
        const values = headers.map(h => Object.prototype.hasOwnProperty.call(record, h) ? record[h] : '');
        const rowNumber = index.get(key);
        if (rowNumber) {
          sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
          updated++;
        } else {
          sheet.appendRow(values);
          inserted++;
        }
      });
      return output_({ ok: true, sheet: sheetName, inserted, updated });
    }

    return output_({ ok: false, error: 'unknown_action' }, 400);
  } catch (err) {
    return output_({ ok: false, error: 'bridge_error', message: String(err && err.message || err) }, 500);
  }
}

function output_(data, status) {
  // Apps Script ContentService does not allow arbitrary HTTP status codes.
  // Consumers must inspect the JSON "ok"/"error" fields.
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEqual_(a, b) {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
