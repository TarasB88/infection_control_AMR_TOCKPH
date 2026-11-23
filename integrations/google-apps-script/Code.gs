/**
 * IPC & AMR Google Sheets bridge.
 * Deploy as a Web App that executes as the spreadsheet owner.
 * The Cloudflare Worker is the only client; the bridge secret is never sent to browsers.
 */
const SHEET_HEADERS = {
  Facilities: ['EDRPOU','Name','Region_Oblast','District','Territorial_Hromada','Settlement','Address','Ownership','Care_Level','Network_Status','Monitoring_Years'],
  Facility_IPC_Profile: ['Facility_ID','Facility_Name','Profile_Date','VIK_Unit','VIK_Staff_Count','VIK_FTE_Count','IPC_Program','Notes'],
  IPC_Visits: ['Visit_ID','Facility_ID','Facility_Name','Planned_Month','Visit_Date','Responsible_Person','Status','Summary','Created_At'],
  IPC_Assessments: ['Assessment_ID','Facility_ID','Facility_Name','Visit_Date','Criterion_Code','Criterion_Name','Result','Score','Comment','Assessed_By','Created_At'],
  Recommendations: ['Recommendation_ID','Facility_ID','Visit_ID','Description','Responsible_Person','Due_Date','Status','Completion_Note','Created_At','Updated_At'],
  Legal_Acts: ['Act_ID','Title','Document_Number','Document_Date','Source_URL','Status','Effective_From','Checked_At','Next_Review_Date','Responsible','Notes'],
  Training_Events: ['Event_ID','Date','Title','Format','Organizer','Audience','Facilities','Participants','Hours','Assessed','Average_Score','Outcome','Notes','Created_By','Created_At'],
  Training_Facility_Stats: ['Event_ID','Facility_ID','Facility_Name','Participants','Staff_Category','Notes'],
  AST_Data: ['Hospital_ID','Hospital_Name','Region_Oblast','Territorial_Hromada','Settlement','Patient_ID','Sample_ID','Sampling_Date','Sample_Matrix_Type','Bacterial_Species','Antimicrobial_Agent','MIC_Operator','MIC_Value','Zone_Diameter','SIR_Category','Interpretation_Standard'],
  WGS_Staging: ['WGS_ID','Hospital_ID','Hospital_Name','Sample_ID','Isolate_ID','Sequencing_Date','Sequencing_Platform','MLST_ST','Serotype_K_O_Antigen','AMR_Genotype_Genes','Point_Mutations','Virulence_Genes','Plasmid_Replicon_Type','FASTA_FASTQ_File_Link','Notes','Created_By','Created_At'],
  Dictionaries: ['Dictionary','Code','Label','Parent_Code','Is_Active','Notes'],
  Users: ['Username','Password_Salt','Password_Hash','Email','Full_Name','Role','Is_Active','Facility_Codes','Created_At','Updated_At']
};

// Rename each Google Forms response tab to the matching name below.
// Form question titles should match the canonical sheet headers exactly.
const FORM_RESPONSE_TABS = {
  IPC_Visits: ['Form_IPC_Visits'],
  IPC_Assessments: ['Form_IPC_Assessments'],
  Training_Events: ['Form_Training_Events'],
  AST_Data: ['Form_AST_Data'],
  WGS_Staging: ['Form_WGS_Staging']
};

function setupBridge() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open Apps Script from the target Google spreadsheet (Extensions → Apps Script).');
  const secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  props.setProperty('BRIDGE_SECRET', secret);
  ensureSheets_(ss, Object.keys(SHEET_HEADERS));
  SpreadsheetApp.getUi().alert(
    'IPC & AMR Sheets bridge configured',
    'Copy this bridge secret to the Cloudflare Worker secret SHEETS_BRIDGE_SECRET.\n\n' + secret +
    '\n\nThe spreadsheet ID and secret are stored in Apps Script properties.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET') || '';
    if (!expected || !constantTimeEquals_(String(request.key || ''), expected)) {
      return json_({ ok: false, error: 'Unauthorized bridge request.' });
    }
    const ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!ssId) return json_({ ok: false, error: 'Run setupBridge() from the target spreadsheet first.' });
    const ss = SpreadsheetApp.openById(ssId);
    const result = dispatch_(ss, request);
    return json_({ ok: true, data: result });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function dispatch_(ss, request) {
  switch (String(request.action || '')) {
    case 'authStatus': {
      const users = getSheet_(ss, 'Users');
      return { userCount: Math.max(0, users.getLastRow() - 1), spreadsheetName: ss.getName() };
    }
    case 'findUser':
      return findUser_(ss, request.username);
    case 'listUsers':
      return listUsers_(ss);
    case 'createUser':
      return createUser_(ss, request.user || {});
    case 'updateUser':
      return updateUser_(ss, request.user || {});
    case 'ensureSheets':
      ensureSheets_(ss, Array.isArray(request.names) ? request.names : Object.keys(SHEET_HEADERS));
      return { ensured: true };
    case 'readSheet':
      return readSheet_(ss, String(request.sheet || ''));
    case 'appendRows':
      return appendRows_(ss, String(request.sheet || ''), request.rows || []);
    default:
      throw new Error('Unknown bridge action.');
  }
}

function ensureSheets_(ss, names) {
  names.concat(['Users']).forEach(name => {
    if (!Object.prototype.hasOwnProperty.call(SHEET_HEADERS, name)) return;
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = SHEET_HEADERS[name];
    if (sheet.getLastRow() === 0 && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });
}

function getSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet && SHEET_HEADERS[name]) {
    ensureSheets_(ss, [name]);
    sheet = ss.getSheetByName(name);
  }
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function readSheet_(ss, name) {
  if (!Object.prototype.hasOwnProperty.call(SHEET_HEADERS, name) || name === 'Users') {
    throw new Error('Reading this sheet is not allowed.');
  }
  const sheet = getSheet_(ss, name);
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.length ? values[0].map(value => String(value).trim()) : [];
  if (!headers.length) return { headers: [], rows: [] };
  const rows = values.slice(1).filter(row => row.some(value => String(value).trim() !== '')).map(row => {
    const record = {};
    headers.forEach((header, index) => record[header] = String(row[index] || '').trim());
    return record;
  });

  (FORM_RESPONSE_TABS[name] || []).forEach(formTabName => {
    const formTab = ss.getSheetByName(formTabName);
    if (!formTab || formTab.getLastRow() < 2) return;
    const formValues = formTab.getDataRange().getDisplayValues();
    const formHeaders = (formValues[0] || []).map(normalizeHeader_);
    formValues.slice(1).forEach(formRow => {
      if (!formRow.some(value => String(value).trim() !== '')) return;
      const formRecord = {};
      headers.forEach(header => {
        const index = formHeaders.indexOf(normalizeHeader_(header));
        formRecord[header] = index >= 0 ? String(formRow[index] || '').trim() : '';
      });
      if (Object.values(formRecord).some(value => value !== '')) rows.push(formRecord);
    });
  });
  return { headers: headers, rows: rows };
}

function appendRows_(ss, name, rows) {
  if (!Object.prototype.hasOwnProperty.call(SHEET_HEADERS, name) || name === 'Users') {
    throw new Error('Writing to this sheet is not allowed.');
  }
  if (!Array.isArray(rows) || !rows.length) return { appended: 0 };
  const sheet = getSheet_(ss, name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(String);
  if (!headers.length || rows.some(row => !Array.isArray(row) || row.length !== headers.length)) {
    throw new Error('Rows do not match the existing sheet header width.');
  }
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
  return { appended: rows.length };
}

function findUser_(ss, username) {
  const sheet = getSheet_(ss, 'Users');
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return null;
  const headers = values[0].map(String);
  const usernameIndex = headers.indexOf('Username');
  if (usernameIndex < 0) throw new Error('Users sheet is missing Username column.');
  const wanted = String(username || '').trim().toLowerCase();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][usernameIndex] || '').trim().toLowerCase() === wanted) {
      const row = {};
      headers.forEach((header, index) => row[header] = String(values[i][index] || ''));
      return row;
    }
  }
  return null;
}

function listUsers_(ss) {
  const sheet = getSheet_(ss, 'Users');
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(value => String(value).trim() !== '')).map(row => {
    const user = {};
    headers.forEach((header, index) => {
      if (header !== 'Password_Salt' && header !== 'Password_Hash') user[header] = String(row[index] || '');
    });
    return user;
  });
}

function createUser_(ss, user) {
  const username = String(user.Username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 characters: letters, digits, dot, underscore or hyphen.');
  if (findUser_(ss, username)) throw new Error('Username already exists.');
  const sheet = getSheet_(ss, 'Users');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(String);
  const row = headers.map(header => user[header] !== undefined ? user[header] : '');
  sheet.appendRow(row);
  return { created: true };
}

function updateUser_(ss, user) {
  const username = String(user.Username || '').trim();
  const sheet = getSheet_(ss, 'Users');
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) throw new Error('User not found.');
  const headers = values[0].map(String);
  const usernameIndex = headers.indexOf('Username');
  const rowIndex = values.findIndex((row, index) => index > 0 && String(row[usernameIndex] || '').toLowerCase() === username.toLowerCase());
  if (rowIndex < 1) throw new Error('User not found.');
  ['Role','Is_Active','Facility_Codes'].forEach(field => {
    const col = headers.indexOf(field);
    if (col >= 0 && user[field] !== undefined) sheet.getRange(rowIndex + 1, col + 1).setValue(user[field]);
  });
  const updatedIndex = headers.indexOf('Updated_At');
  if (updatedIndex >= 0) sheet.getRange(rowIndex + 1, updatedIndex + 1).setValue(new Date().toISOString());
  return { updated: true };
}

function normalizeHeader_(value) {
  return String(value || '').toLowerCase().replace(/[’'"_\s-]/g, '').replace(/[^a-zа-яіїєґ0-9]/gi, '');
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
