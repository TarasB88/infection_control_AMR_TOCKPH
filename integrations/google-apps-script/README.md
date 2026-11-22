# Google Sheets bridge (staged integration)

This repository includes an Apps Script bridge for the spreadsheet:
`1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc`.

## Current status

- The bridge source is in `integrations/google-apps-script/Code.gs`.
- It supports authenticated sheet discovery, reading rows, and keyed upserts.
- It does not create, rename, or clear worksheets.
- The Cloudflare Worker and React UI are **not yet switched to Google Sheets**. That requires validating the real worksheet headers and then implementing typed, validated sync into D1 and the relevant dashboard modules. Do not treat this bridge alone as a completed production integration.

## One-time setup in the spreadsheet owner's Google account

1. Open the spreadsheet and choose **Extensions → Apps Script**.
2. Replace the editor contents with `Code.gs` from this folder and save.
3. In **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID` = `1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc`
   - `BRIDGE_TOKEN` = a unique random value of at least 32 characters.
4. Deploy → **New deployment** → **Web app**. Execute as the spreadsheet owner. Restrict access to the narrowest available audience compatible with the Worker-to-Apps-Script call. If "Anyone" is required by the deployment model, the random bridge token is mandatory and must remain server-side only.
5. Complete Google's authorization prompt.
6. Send the resulting Web App URL to the developer/administrator configuring the Worker. Do not send the bridge token in chat or put it in frontend code.

## Bridge request format

POST JSON to the Web App URL:

```json
{"token":"<server-side secret>","action":"listSheets"}
```

Read rows:

```json
{"token":"<server-side secret>","action":"getRows","sheet":"AST_Data"}
```

Keyed upsert (the key column must exist in row 1):

```json
{"token":"<server-side secret>","action":"upsertRows","sheet":"Legal_Acts","keyColumn":"Act_ID","rows":[{"Act_ID":"..."}]}
```

The bridge reads the first row as headers and returns objects keyed by those exact header names. Worksheet names are allowlisted in `Code.gs`.

## Security and data handling

- Do not make the spreadsheet itself publicly readable.
- Do not put the bridge token in the React app, URL query string, Git repository, or spreadsheet cells.
- The temporary `Users` worksheet may contain the requested login/password columns, but access to the spreadsheet must remain tightly restricted. Use unique dashboard-only temporary passwords; never reuse email or other service passwords.
- The existing D1 authentication currently uses PBKDF2 password hashes and secure server-side sessions. It is not automatically replaced by this bridge. A migration from D1 auth to the temporary spreadsheet credential source must be implemented and security-reviewed separately.
- The bridge's upsert is row-level keyed replacement; it is not a general-purpose conflict resolver. Do not use it for a worksheet until its key column and data ownership rules have been confirmed.
