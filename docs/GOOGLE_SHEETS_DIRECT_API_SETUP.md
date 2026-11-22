# Google Sheets integration

The dashboard uses two server-side connection patterns. No Apps Script project, Apps Script Web App, or Apps Script trigger is used.

## 1. Facility directory sources — direct XLSX export

The two facility source tabs are fetched in the same way as the pixel-perfect-picture-378 project:

`https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=xlsx&gid=SHEET_GID`

The Cloudflare Worker downloads the XLSX file server-side and parses it with the existing `xlsx` package. This avoids browser CORS restrictions and does not require a service account for these two read-only source tabs.

Configured sources:

| Source | Spreadsheet ID | Sheet GID |
| --- | --- | ---: |
| Facility registry | `10Tsfk408PbyzHmPoJdZ1QVtzfULed3yxkpGAFK_M6ew` | `0` |
| Facility monitoring | `12GH5WBi9X6HOJ2QRPkj2-wlqG1XmE6O26hDMlU-EanQ` | `933221082` |

**Access and privacy requirement:** Google's export URL works only when the spreadsheet is accessible to the Worker without an interactive login (for example, link-view access). Link-view access is granted at the workbook level, not just to the selected GID. Therefore, do not enable link-view access on a workbook containing personal contact details, patient-level data, credentials, or other non-public tabs. If a source workbook contains such material, create a separate sanitized workbook containing only the fields needed for the facility directory, then update the spreadsheet ID/GID constants in `src/worker.ts` to those sanitized sources.

The Worker returns only the mapped organizational fields. It does not return director names, emails, or phone numbers.

## 2. IPC/AMR target workbook — private Google Sheets API

The target workbook remains private because it contains operational data, including the `AST_Data` tab and potentially patient identifiers. It is accessed server-side through the Google Sheets API using a service account.

| Workbook | Spreadsheet ID | Permission |
| --- | --- | --- |
| IPC/AMR target workbook | `1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc` | Editor |

Create a dedicated Google service account, enable Google Sheets API, and share only the target workbook with its `client_email`. Add these encrypted Cloudflare Worker secrets:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Do not commit the service-account JSON key or send the private key in chat. The `Users` tab is excluded from generic reads.

The private target workbook is intentionally not made public. A public XLSX export of the whole target workbook could expose AST patient identifiers and other restricted tabs.

## 3. Verify

After deployment:

1. Sign in as an administrator.
2. Open **Імпорт та контроль якості даних** and select **Перевірити з’єднання**. This checks the private target workbook and lists allow-listed tabs.
3. Open **Реєстр закладів**. The Worker fetches the two source tabs using direct XLSX export.
4. Use **Попередній перегляд змін** before **Оновити зараз → Facilities**. The latter writes mapped non-empty values into the private target workbook and does not overwrite formula cells.

AST data is read from the private `AST_Data` tab and passes through authenticated validation and D1 persistence, including HMAC pseudonymization of patient identifiers.

## 4. Limitations

- Direct XLSX export is read-only. It cannot write back to Google Sheets.
- Facility synchronization writes to the private target workbook through the Google Sheets API.
- Automatic scheduled sync is not implemented; use the manual preview and synchronization controls.
- If a source export returns HTTP 403/404 or an HTML login page, check its sharing settings or replace it with a sanitized, link-view export workbook.