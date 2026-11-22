# Google Sheets bridge (staged integration)

The Apps Script bridge connects the IPC & AMR dashboard to the target workbook:
`1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc`.

## Current capabilities

- Authenticated sheet discovery and header inspection.
- Read-only access to allowlisted worksheets, excluding `Users`.
- Generic keyed upsert for approved non-credential worksheets.
- **Facilities source synchronization** from two fixed source tabs:
  - Registry: `10Tsfk408PbyzHmPoJdZ1QVtzfULed3yxkpGAFK_M6ew`, tab GID `0`.
  - Monitoring: `12GH5WBi9X6HOJ2QRPkj2-wlqG1XmE6O26hDMlU-EanQ`, tab GID `933221082`.
- Facility matching by EDRPOU, preview of new/update counts, duplicate detection, and a confirmed upsert into `Facilities`.
- Existing target rows are not cleared. Empty source values do not erase existing values; unmapped columns and formula cells are preserved. Ambiguous duplicate EDRPOU values are skipped rather than guessed.
- The Worker exposes admin-only preview, manual refresh, and automatic-sync controls. Manual sync attempts are recorded in the D1 audit log; automatic run status is stored in Apps Script Properties.

This feature is still **staged**. It has not been authorized against the live spreadsheets or deployed to the production Worker. Actual source/target headers and row counts must be validated with the preview action after setup. The code does not create, rename, or clear worksheets.

## One-time setup in the spreadsheet owner's Google account

1. Open the **target** spreadsheet and choose **Extensions → Apps Script**.
2. Replace the editor contents with `Code.gs` from this folder and save.
3. In **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID` = `1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc`
   - `BRIDGE_TOKEN` = a unique random value of at least 32 characters.
4. Make sure the account that owns/runs the Apps Script has permission to read both source spreadsheets listed above and edit the target spreadsheet.
5. Deploy → **New deployment** → **Web app**. Execute as the spreadsheet owner. Restrict access to the narrowest available audience compatible with the Worker-to-Apps-Script call. If "Anyone" is required by the deployment model, the random bridge token is mandatory and must remain server-side only.
6. Complete Google's authorization prompts for spreadsheet access and trigger management. If the dashboard cannot create triggers on first use, select `setupFacilitiesAutoSync` in the Apps Script editor, click Run, and approve the requested scopes. This one-time helper enables the edit, change, and hourly triggers; it is safe to run again because trigger creation is idempotent.
7. Configure Cloudflare Worker secrets:
   - `GOOGLE_SHEETS_BRIDGE_URL` = the deployed Web App URL.
   - `GOOGLE_SHEETS_BRIDGE_TOKEN` = the same secret as `BRIDGE_TOKEN`.
8. Open the dashboard as an administrator, go to **Імпорт даних → Інтеграція з Google Sheets**, and run the preview. Do not run sync until the field mapping and duplicate counts look correct.

Do not send the bridge token in chat or put it in frontend code.


## Automatic refresh behavior

The administrator can enable or disable automatic refresh from the dashboard's Google Sheets integration panel:

- Installable `onEdit` and `onChange` triggers are attached to each source spreadsheet. Cell edits and structural changes are debounced for about 60 seconds, so nearby changes are grouped into one synchronization.
- A time-driven trigger performs a reconciliation every hour as a fallback for API/import changes that do not fire spreadsheet edit triggers. Apps Script may schedule the hourly run within its hourly window rather than at an exact minute.
- The dashboard button **Оновити зараз → Facilities** performs an immediate source read, shows the changes to be applied, and asks for confirmation before writing.
- The administrator can inspect active edit/change trigger counts, last successful run, last error, and pending debounce status in the integration panel.
- Disabling auto-refresh removes edit, change, hourly, and pending debounce triggers. It does not delete or change any spreadsheet data.

Installable triggers run under the Google account that created them. The account must retain access to both source spreadsheets and edit access to the target. An edit made through a script/API may not emit an edit trigger; the hourly reconciliation covers such changes. If source rows are changed by formulas recalculating without a user edit, they are also picked up by the hourly reconciliation.

## Bridge request format

All calls use POST JSON. The server-side token is required:

```json
{"token":"<server-side secret>","action":"listSheets"}
```

Read an allowlisted target worksheet:

```json
{"token":"<server-side secret>","action":"getRows","sheet":"AST_Data"}
```

Preview the two facility source tabs and target mapping:

```json
{"token":"<server-side secret>","action":"previewFacilitiesSync"}
```

Perform the write only after a validated preview and explicit confirmation:

```json
{"token":"<server-side secret>","action":"syncFacilities","confirm":true}
```

The facility actions are intended to be invoked through the authenticated admin-only Worker endpoint, not from frontend code or a public script URL.

## Security and data handling

- Keep the source and target spreadsheets private; do not change their sharing settings to public.
- Do not put the bridge token in the React app, URL query string, Git repository, or spreadsheet cells.
- Generic bridge access to the `Users` worksheet is blocked. Do not store plaintext passwords in that sheet. Dashboard credentials remain in the D1 authentication flow using PBKDF2 hashes and secure server-side sessions.
- The bridge reads the first row as headers. Header matching is tolerant of common Ukrainian/English field-name variants, but the actual preview must be reviewed before the first write.
- The facility sync is limited to the `Facilities` target sheet. It does not write to the source workbooks or other target tabs.
