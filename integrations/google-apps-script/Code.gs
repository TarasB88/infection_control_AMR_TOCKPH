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
  maxPayloadBytes: 900000,
  facilitySources: [
    { key: 'registry', spreadsheetId: '10Tsfk408PbyzHmPoJdZ1QVtzfULed3yxkpGAFK_M6ew', sheetId: 0 },
    { key: 'monitoring', spreadsheetId: '12GH5WBi9X6HOJ2QRPkj2-wlqG1XmE6O26hDMlU-EanQ', sheetId: 933221082 }
  ]
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


    if (action === 'getFacilitiesSyncStatus') {
      return output_({ ok: true, autoSync: getFacilitiesAutoSyncStatus_() });
    }

    if (action === 'enableFacilitiesAutoSync') {
      return output_({ ok: true, autoSync: installFacilitiesAutoSync_() });
    }

    if (action === 'disableFacilitiesAutoSync') {
      return output_({ ok: true, autoSync: removeFacilitiesAutoSync_() });
    }

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

    if (action === 'inspectSheets') {
      return output_({
        ok: true,
        spreadsheetId: ssId,
        sheets: ss.getSheets().map(sheet => {
          const lastColumn = sheet.getLastColumn();
          const headers = lastColumn > 0
            ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(v => String(v).trim())
            : [];
          const normalized = headers.map(h => h.toLocaleLowerCase());
          const headerIssues = [];
          if (!headers.length) headerIssues.push('missing_header_row');
          if (headers.some(h => !h)) headerIssues.push('blank_header');
          if (new Set(normalized).size !== normalized.length) headerIssues.push('duplicate_header');
          if (sheet.getLastRow() > 1 && !headers.length) headerIssues.push('rows_without_headers');
          return {
            name: sheet.getName(),
            rows: Math.max(0, sheet.getLastRow() - 1),
            columns: lastColumn,
            headers,
            headerIssues
          };
        })
      });
    }

    if (action === 'previewFacilitiesSync') {
      return output_(previewFacilitiesSync_(ss, false));
    }

    if (action === 'syncFacilities') {
      if (body.confirm !== true) return output_({ ok: false, error: 'confirmation_required' });
      const result = runFacilitiesSync_('manual');
      return output_(result);
    }

    const sheetName = String(body.sheet || '');
    if (!CONFIG.allowedSheets.includes(sheetName)) return output_({ ok: false, error: 'sheet_not_allowed' }, 400);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return output_({ ok: false, error: 'sheet_not_found', sheet: sheetName }, 404);

    if (action === 'getRows') {
      // Credentials are never available through the generic bridge API.
      if (sheetName === 'Users') return output_({ ok: false, error: 'users_sheet_requires_dedicated_auth_flow' });
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow < 1 || lastCol < 1) return output_({ ok: true, sheet: sheetName, headers: [], rows: [], rowCount: 0 });
      if (lastRow - 1 > CONFIG.maxRows) {
        return output_({ ok: false, error: 'row_limit_exceeded', sheet: sheetName, rowCount: lastRow - 1, maxRows: CONFIG.maxRows });
      }
      const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
      const headers = values.shift().map(v => String(v).trim());
      if (headers.some(h => !h)) return output_({ ok: false, error: 'blank_header', sheet: sheetName }, 422);
      const normalizedHeaders = headers.map(h => h.toLocaleLowerCase());
      if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
        return output_({ ok: false, error: 'duplicate_header', sheet: sheetName }, 422);
      }
      const rows = values.filter(row => row.some(cell => cell !== '')).map(row => {
        const item = {};
        headers.forEach((header, i) => item[header] = row[i] == null ? '' : row[i]);
        return item;
      });
      return output_({ ok: true, sheet: sheetName, headers, rows, rowCount: rows.length });
    }

    if (action === 'upsertRows') {
      // Prevent accidental or generic writes to the credential registry.
      if (sheetName === 'Users') return output_({ ok: false, error: 'users_sheet_is_read_only_via_generic_bridge' });
      if (!Array.isArray(body.rows) || body.rows.length > 1000) return output_({ ok: false, error: 'invalid_rows' }, 400);
      const keyColumn = String(body.keyColumn || '');
      const headers = sheet.getLastColumn()
        ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(v => String(v).trim())
        : [];
      if (!headers.length || !keyColumn || !headers.includes(keyColumn)) {
        return output_({ ok: false, error: 'invalid_key_column_or_headers' }, 422);
      }
      const normalizedHeaders = headers.map(h => h.toLocaleLowerCase());
      if (headers.some(h => !h) || new Set(normalizedHeaders).size !== normalizedHeaders.length) {
        return output_({ ok: false, error: 'invalid_headers' }, 422);
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
      const incomingKeys = new Set();
      body.rows.forEach(record => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid_record');
        const key = String(record[keyColumn] == null ? '' : record[keyColumn]).trim();
        if (!key) throw new Error('missing_key:' + keyColumn);
        if (incomingKeys.has(key)) throw new Error('duplicate_input_key');
        incomingKeys.add(key);
      });
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) return output_({ ok: false, error: 'write_busy_retry' }, 409);
      let updated = 0, inserted = 0;
      try {
      body.rows.forEach(record => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid_record');
        const key = String(record[keyColumn] == null ? '' : record[keyColumn]).trim();
        if (!key) throw new Error('missing_key:' + keyColumn);
        const values = headers.map(h => {
          const value = Object.prototype.hasOwnProperty.call(record, h) ? record[h] : '';
          // Prevent untrusted text from being interpreted as a spreadsheet formula.
          return typeof value === 'string' && /^[=+@-]/.test(value) && !Number.isFinite(Number(value)) ? "'" + value : value;
        });
        const rowNumber = index.get(key);
        if (rowNumber) {
          sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
          updated++;
        } else {
          sheet.appendRow(values);
          inserted++;
        }
      });
      } finally {
        lock.releaseLock();
      }
      return output_({ ok: true, sheet: sheetName, inserted, updated });
    }

    return output_({ ok: false, error: 'unknown_action' }, 400);
  } catch (err) {
    const message = String(err && err.message || err);
    const safeMessage = /^(invalid_record|missing_key:[A-Za-z0-9_ -]{1,80}|duplicate_input_key)$/.test(message) ? message : 'internal_error';
    return output_({ ok: false, error: 'bridge_error', message: safeMessage }, 500);
  }
}


/**
 * Read-only source inspection + guarded Facilities upsert.
 * Source spreadsheet IDs and sheet GIDs are allow-listed in CONFIG; callers cannot
 * choose arbitrary spreadsheets or tabs. Existing non-empty fields are refreshed
 * only where an incoming value is present. Unmapped columns and formulas are kept.
 */
const FACILITY_FIELD_ALIASES_ = Object.freeze({
  edrpou: ['єдрпоу', 'кодєдрпоу', 'єдрпоукод', 'єдрпоузоз', 'кодзаєдрпоу', 'кодзгідноєдрпоу', 'кодєдрпоузакладу', 'кодзакладу', 'кодзакладуєдрпоу', 'edrpou', 'hospitalid', 'facilitycode', 'externalcode'],
  name: ['назва', 'назвазоз', 'назвазакладу', 'повнаназва', 'повнаназвазакладу', 'найменування', 'найменуваннязакладу', 'закладохорониздоровя', 'hospitalname', 'facilityname'],
  director: ['керівник', 'пібкерівника', 'директор', 'керівникзакладу', 'director', 'manager'],
  email: ['email', 'електроннапошта', 'електроннаадреса', 'поштоваадреса', 'emailзакладу'],
  phone: ['телефон', 'контактнийтелефон', 'телефонзакладу', 'phone', 'contactphone'],
  address: ['адреса', 'юридичнаадреса', 'фактичнаадреса', 'місцезнаходження', 'address'],
  oblast: ['область', 'regionoblast', 'oblast', 'областьрозташування'],
  district: ['район', 'адміністративнийрайон', 'районрозташування', 'district'],
  hromada: ['територіальнагромада', 'громада', 'територіальнагромадазоз', 'hromada', 'territorialhromada'],
  settlement: ['населенийпункт', 'місто', 'село', 'селище', 'settlement', 'locality'],
  ownership: ['формавласності', 'форма власності', 'ownership', 'propertyform'],
  care_level: ['рівеньнаданнядопомоги', 'рівеньнаданнямедичноїдопомоги', 'рівеньмедичноїдопомоги', 'рівеньзакладу', 'carelevel', 'levelofcare'],
  network_status: ['статусуспроможніймережі', 'включеннядоспоможноїмережі', 'включеннядоспроможноїмережі', 'спроможнамережа', 'статусмережі', 'networkstatus'],
  monitoring_years: ['рокимоніторингу', 'рікмоніторингу', 'рокипроведеннямоніторингу', 'monitoringyears', 'monitoringyear']
});

function normalizeFacilityHeader_(value) {
  return String(value == null ? '' : value).toLocaleLowerCase('uk-UA')
    .replace(/[’'"`]/g, '')
    .replace(/[^0-9a-zа-яіїєґ]/gi, '');
}

function facilityFieldForHeader_(header) {
  const normalized = normalizeFacilityHeader_(header);
  for (const field in FACILITY_FIELD_ALIASES_) {
    if (FACILITY_FIELD_ALIASES_[field].some(alias => { const candidate = normalizeFacilityHeader_(alias); return candidate === normalized || (candidate.length >= 4 && (normalized.indexOf(candidate) === 0 || normalized.slice(-candidate.length) === candidate)); })) return field;
  }
  return '';
}

function normalizeEdrpou_(value) {
  const digits = String(value == null ? '' : value).replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 10 ? digits : '';
}

function safeFacilityCell_(value) {
  const text = String(value == null ? '' : value).trim();
  return /^[=+@-]/.test(text) && !Number.isFinite(Number(text)) ? "'" + text : text;
}

function readFacilitySource_(source) {
  const sourceBook = SpreadsheetApp.openById(source.spreadsheetId);
  const sheet = sourceBook.getSheets().find(item => item.getSheetId() === source.sheetId);
  if (!sheet) throw new Error('source_sheet_missing_' + source.key);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) throw new Error('source_empty_' + source.key);
  if (lastRow - 1 > CONFIG.maxRows) throw new Error('source_row_limit_' + source.key);
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values.shift().map(value => String(value || '').trim());
  if (headers.some(header => !header)) throw new Error('source_blank_header_' + source.key);
  const normalized = headers.map(normalizeFacilityHeader_);
  if (new Set(normalized).size !== normalized.length) throw new Error('source_duplicate_header_' + source.key);
  const indexes = {};
  headers.forEach((header, index) => {
    const field = facilityFieldForHeader_(header);
    if (field && indexes[field] == null) indexes[field] = index;
  });
  if (indexes.edrpou == null) throw new Error('source_edrpou_column_missing_' + source.key);
  const rows = values.filter(row => row.some(cell => String(cell || '').trim() !== ''));
  const records = [];
  let invalidRows = 0;
  rows.forEach((row, index) => {
    const edrpou = normalizeEdrpou_(row[indexes.edrpou]);
    if (!edrpou) { invalidRows++; return; }
    const record = { edrpou: edrpou };
    Object.keys(indexes).forEach(field => {
      record[field] = String(row[indexes[field]] == null ? '' : row[indexes[field]]).trim();
    });
    records.push({ rowNumber: index + 2, record: record });
  });
  return { key: source.key, headers: headers, rowCount: rows.length, records: records, invalidRows: invalidRows };
}

function mergeUniqueFacilityText_(left, right, field) {
  const values = [];
  [left, right].forEach(value => {
    String(value || '').split(field === 'monitoring_years' ? /[,;\n/]+/ : /\s*;\s*/).forEach(part => {
      const cleaned = String(part || '').trim();
      if (cleaned && values.indexOf(cleaned) < 0) values.push(cleaned);
    });
  });
  return values.join('; ');
}

function previewFacilitiesSync_(targetBook, commit) {
  if (!commit) return buildFacilitiesSyncReport_(targetBook, false);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('write_busy_retry');
  try { return buildFacilitiesSyncReport_(targetBook, true); }
  finally { lock.releaseLock(); }
}

function buildFacilitiesSyncReport_(targetBook, commit) {
  const sourceA = readFacilitySource_(CONFIG.facilitySources[0]);
  const sourceB = readFacilitySource_(CONFIG.facilitySources[1]);
  const registryCounts = {};
  sourceA.records.forEach(item => registryCounts[item.record.edrpou] = (registryCounts[item.record.edrpou] || 0) + 1);
  const duplicateRegistryIds = Object.keys(registryCounts).filter(key => registryCounts[key] > 1);
  const duplicateRegistrySet = new Set(duplicateRegistryIds);

  const monitoringById = {};
  let duplicateMonitoringIds = 0;
  sourceB.records.forEach(item => {
    const record = item.record;
    if (!monitoringById[record.edrpou]) monitoringById[record.edrpou] = {};
    else duplicateMonitoringIds++;
    const current = monitoringById[record.edrpou];
    Object.keys(record).forEach(field => {
      if (field === 'edrpou') return;
      current[field] = mergeUniqueFacilityText_(current[field], record[field], field);
    });
  });

  const registryById = {};
  sourceA.records.forEach(item => {
    const record = item.record;
    if (!duplicateRegistrySet.has(record.edrpou)) registryById[record.edrpou] = record;
  });
  const allIds = new Set(Object.keys(registryById).concat(Object.keys(monitoringById)));
  const records = [];
  let incompleteRows = 0;
  allIds.forEach(edrpou => {
    const primary = registryById[edrpou] || {};
    const secondary = monitoringById[edrpou] || {};
    const record = { edrpou: edrpou };
    const fields = Object.keys(FACILITY_FIELD_ALIASES_);
    fields.forEach(field => {
      if (field === 'edrpou') return;
      const secondaryFirst = ['care_level', 'network_status', 'monitoring_years'].indexOf(field) >= 0;
      record[field] = secondaryFirst
        ? (secondary[field] || primary[field] || '')
        : (primary[field] || secondary[field] || '');
    });
    if (!record.name) { incompleteRows++; return; }
    records.push(record);
  });

  const target = targetBook.getSheetByName('Facilities');
  if (!target) throw new Error('target_facilities_sheet_missing');
  const lastColumn = target.getLastColumn();
  if (lastColumn < 1) throw new Error('target_facilities_headers_missing');
  const headers = target.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(value => String(value || '').trim());
  if (headers.some(header => !header)) throw new Error('target_facilities_blank_header');
  const fieldByColumn = headers.map(facilityFieldForHeader_);
  const keyIndex = fieldByColumn.indexOf('edrpou');
  if (keyIndex < 0) throw new Error('target_edrpou_column_missing');
  const mapping = {};
  headers.forEach((header, index) => { if (fieldByColumn[index]) mapping[header] = fieldByColumn[index]; });
  const lastRow = target.getLastRow();
  const existingValues = lastRow > 1 ? target.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];
  const existingFormulas = lastRow > 1 ? target.getRange(2, 1, lastRow - 1, lastColumn).getFormulas() : [];
  const existingKeyDisplay = lastRow > 1 ? target.getRange(2, keyIndex + 1, lastRow - 1, 1).getDisplayValues().map(row => row[0]) : [];
  const targetCounts = {};
  existingValues.forEach((row, index) => {
    const key = normalizeEdrpou_(existingKeyDisplay[index]);
    if (key) targetCounts[key] = (targetCounts[key] || 0) + 1;
  });
  const duplicateTargetIds = Object.keys(targetCounts).filter(key => targetCounts[key] > 1);
  const duplicateTargetSet = new Set(duplicateTargetIds);
  const existingIndex = {};
  existingValues.forEach((row, index) => {
    const key = normalizeEdrpou_(existingKeyDisplay[index]);
    if (key && !duplicateTargetSet.has(key)) existingIndex[key] = index;
  });

  const eligible = records.filter(record => !duplicateTargetSet.has(record.edrpou));
  let newCount = 0, updateCount = 0;
  eligible.forEach(record => {
    if (existingIndex[record.edrpou] == null) newCount++;
    else updateCount++;
  });
  const unmappedHeaders = headers.filter((header, index) => !fieldByColumn[index]);
  const report = {
    ok: true,
    mode: commit ? 'sync' : 'preview',
    registry: { rows: sourceA.rowCount, invalidRows: sourceA.invalidRows, duplicateIds: duplicateRegistryIds.length, headers: sourceA.headers },
    monitoring: { rows: sourceB.rowCount, invalidRows: sourceB.invalidRows, duplicateRows: duplicateMonitoringIds, headers: sourceB.headers },
    target: { rows: existingValues.length, headers: headers, mappedColumns: mapping, unmappedHeaders: unmappedHeaders },
    summary: {
      sourceFacilities: records.length,
      incompleteRows: incompleteRows,
      duplicateRegistryIds: duplicateRegistryIds.length,
      duplicateTargetIds: duplicateTargetIds.length,
      newRecords: newCount,
      recordsToUpdate: updateCount,
      skippedForAmbiguousTarget: duplicateTargetIds.length
    },
    sample: eligible.slice(0, 5).map(record => ({ edrpou: record.edrpou, name: record.name, oblast: record.oblast, hromada: record.hromada, care_level: record.care_level, network_status: record.network_status }))
  };
  if (!commit) return report;

  if (eligible.length === 0) {
    report.inserted = 0;
    report.updated = 0;
    report.unchanged = 0;
    return report;
  }

  const nextExisting = existingValues.map((row, rowIndex) => row.map((value, columnIndex) =>
    existingFormulas[rowIndex][columnIndex] ? existingFormulas[rowIndex][columnIndex] : value
  ));
  const newRows = [];
  let updated = 0, unchanged = 0;
  eligible.forEach(record => {
    const existingRowIndex = existingIndex[record.edrpou];
    const isNew = existingRowIndex == null;
    const row = isNew ? new Array(headers.length).fill('') : nextExisting[existingRowIndex].slice();
    let changed = false;
    headers.forEach((header, columnIndex) => {
      const field = fieldByColumn[columnIndex];
      if (!field) return;
      const incoming = String(record[field] || '').trim();
      if (!incoming || (!isNew && existingFormulas[existingRowIndex][columnIndex])) return;
      const safeValue = safeFacilityCell_(incoming);
      if (String(row[columnIndex] == null ? '' : row[columnIndex]) !== safeValue) {
        row[columnIndex] = safeValue;
        changed = true;
      }
    });
    if (isNew) newRows.push(row);
    else if (changed) { nextExisting[existingRowIndex] = row; updated++; }
    else unchanged++;
  });

  if (updated > 0 && nextExisting.length) {
    target.getRange(2, 1, nextExisting.length, headers.length).setValues(nextExisting);
  }
  if (newRows.length) {
    const startRow = Math.max(2, target.getLastRow() + 1);
    target.getRange(startRow, 1, newRows.length, headers.length).setValues(newRows);
  }
  report.inserted = newRows.length;
  report.updated = updated;
  report.unchanged = unchanged;
  return report;
}


/**
 * Trigger installation is explicit and idempotent. It listens for direct edits
 * in both source workbooks and runs an hourly reconciliation as a safety net
 * for changes made by APIs/imports that do not fire onEdit triggers.
 */
function installFacilitiesAutoSync_() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers();
  const handler = 'sourceSpreadsheetEditHandler_';
  const created = [];
  CONFIG.facilitySources.forEach(source => {
    const exists = triggers.some(trigger =>
      trigger.getHandlerFunction() === handler &&
      trigger.getTriggerSourceId() === source.spreadsheetId &&
      trigger.getEventType() === ScriptApp.EventType.ON_EDIT
    );
    if (!exists) {
      ScriptApp.newTrigger(handler).forSpreadsheet(source.spreadsheetId).onEdit().create();
      created.push('onEdit:' + source.key);
    }
  });
  const hasHourly = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === 'scheduledFacilitiesSync_' &&
    trigger.getEventType() === ScriptApp.EventType.CLOCK
  );
  if (!hasHourly) {
    ScriptApp.newTrigger('scheduledFacilitiesSync_').timeBased().everyHours(1).create();
    created.push('hourly');
  }
  props.setProperty('FACILITIES_AUTO_SYNC_ENABLED', 'true');
  props.setProperty('FACILITIES_AUTO_SYNC_CONFIGURED_AT', new Date().toISOString());
  props.setProperty('FACILITIES_AUTO_SYNC_LAST_ERROR', '');
  return Object.assign(getFacilitiesAutoSyncStatus_(), { created: created });
}

/**
 * Run once from the Apps Script editor if Google asks the owner to authorize
 * trigger-management scopes before the dashboard can enable auto-refresh.
 * This enables the same edit and hourly triggers as the dashboard control.
 */
function setupFacilitiesAutoSync() {
  return installFacilitiesAutoSync_();
}

function removeFacilitiesAutoSync_() {
  const handlers = ['sourceSpreadsheetEditHandler_', 'scheduledFacilitiesSync_', 'debouncedFacilitiesSync_'];
  let deleted = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (handlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  const props = PropertiesService.getScriptProperties();
  props.setProperty('FACILITIES_AUTO_SYNC_ENABLED', 'false');
  props.setProperty('FACILITIES_AUTO_SYNC_PENDING', 'false');
  return Object.assign(getFacilitiesAutoSyncStatus_(), { deleted: deleted });
}

function getFacilitiesAutoSyncStatus_() {
  const props = PropertiesService.getScriptProperties();
  const triggers = ScriptApp.getProjectTriggers();
  const enabled = props.getProperty('FACILITIES_AUTO_SYNC_ENABLED') === 'true';
  const editTriggers = triggers.filter(trigger =>
    trigger.getHandlerFunction() === 'sourceSpreadsheetEditHandler_' &&
    trigger.getEventType() === ScriptApp.EventType.ON_EDIT
  ).map(trigger => trigger.getTriggerSourceId());
  const hourly = triggers.some(trigger =>
    trigger.getHandlerFunction() === 'scheduledFacilitiesSync_' &&
    trigger.getEventType() === ScriptApp.EventType.CLOCK
  );
  let lastSummary = null;
  try { lastSummary = JSON.parse(props.getProperty('FACILITIES_AUTO_SYNC_LAST_SUMMARY') || 'null'); } catch (_) {}
  return {
    enabled: enabled && (editTriggers.length > 0 || hourly),
    sourceEditTriggers: editTriggers.length,
    hourlyFallback: hourly,
    configuredAt: props.getProperty('FACILITIES_AUTO_SYNC_CONFIGURED_AT') || '',
    lastAttemptAt: props.getProperty('FACILITIES_AUTO_SYNC_LAST_ATTEMPT_AT') || '',
    lastSuccessAt: props.getProperty('FACILITIES_AUTO_SYNC_LAST_SUCCESS_AT') || '',
    lastSource: props.getProperty('FACILITIES_AUTO_SYNC_LAST_SOURCE') || '',
    lastError: props.getProperty('FACILITIES_AUTO_SYNC_LAST_ERROR') || '',
    pending: props.getProperty('FACILITIES_AUTO_SYNC_PENDING') === 'true',
    lastSummary: lastSummary
  };
}

function runFacilitiesSync_(source) {
  const props = PropertiesService.getScriptProperties();
  const startedAt = new Date().toISOString();
  props.setProperty('FACILITIES_AUTO_SYNC_LAST_ATTEMPT_AT', startedAt);
  props.setProperty('FACILITIES_AUTO_SYNC_LAST_SOURCE', String(source || 'unknown'));
  try {
    const targetId = props.getProperty('SPREADSHEET_ID') || CONFIG.spreadsheetId;
    const targetBook = SpreadsheetApp.openById(targetId);
    const result = previewFacilitiesSync_(targetBook, true);
    const summary = result.summary || {};
    const compact = {
      inserted: Number(result.inserted || 0),
      updated: Number(result.updated || 0),
      unchanged: Number(result.unchanged || 0),
      sourceFacilities: Number(summary.sourceFacilities || 0),
      duplicateRegistryIds: Number(summary.duplicateRegistryIds || 0),
      duplicateTargetIds: Number(summary.duplicateTargetIds || 0),
      incompleteRows: Number(summary.incompleteRows || 0)
    };
    props.setProperty('FACILITIES_AUTO_SYNC_LAST_SUCCESS_AT', new Date().toISOString());
    props.setProperty('FACILITIES_AUTO_SYNC_LAST_SUMMARY', JSON.stringify(compact));
    props.setProperty('FACILITIES_AUTO_SYNC_LAST_ERROR', '');
    result.autoSync = getFacilitiesAutoSyncStatus_();
    return result;
  } catch (error) {
    const message = String(error && error.message || error).slice(0, 500);
    props.setProperty('FACILITIES_AUTO_SYNC_LAST_ERROR', message);
    throw error;
  }
}

function sourceSpreadsheetEditHandler_(event) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FACILITIES_AUTO_SYNC_ENABLED') !== 'true') return;
  // Debounce rapid consecutive edits so a paste or multi-cell update causes one sync.
  const hasPending = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === 'debouncedFacilitiesSync_' &&
    trigger.getEventType() === ScriptApp.EventType.CLOCK
  );
  props.setProperty('FACILITIES_AUTO_SYNC_PENDING', 'true');
  if (!hasPending) {
    ScriptApp.newTrigger('debouncedFacilitiesSync_').timeBased().after(60 * 1000).create();
  }
}

function debouncedFacilitiesSync_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FACILITIES_AUTO_SYNC_ENABLED') !== 'true') return;
  props.setProperty('FACILITIES_AUTO_SYNC_PENDING', 'false');
  runFacilitiesSync_('source_edit');
}

function scheduledFacilitiesSync_() {
  const enabled = PropertiesService.getScriptProperties().getProperty('FACILITIES_AUTO_SYNC_ENABLED') === 'true';
  if (!enabled) return;
  runFacilitiesSync_('hourly');
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
