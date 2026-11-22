# Direct Google Sheets API setup

This integration uses the Cloudflare Worker and Google Sheets API directly. No Apps Script project, Apps Script Web App, published CSV, or bridge token is used.

## 1. Create a Google service account

1. Open Google Cloud Console and select or create a project.
2. Enable **Google Sheets API** for that project.
3. Create a service account dedicated to this dashboard.
4. Create a JSON key for the service account and download it securely.
5. From the JSON file, use only `client_email` and `private_key` for the Cloudflare secrets below. Do not commit the JSON file or send the private key in chat.

## 2. Share the spreadsheets with the service account

Share each workbook with the exact service-account `client_email`:

| Workbook | Spreadsheet ID | Permission |
| --- | --- | --- |
| Facility registry source | `10Tsfk408PbyzHmPoJdZ1QVtzfULed3yxkpGAFK_M6ew` | Viewer |
| Facility monitoring source | `12GH5WBi9X6HOJ2QRPkj2-wlqG1XmE6O26hDMlU-EanQ` | Viewer |
| IPC/AMR target workbook | `1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc` | Editor |

Keep all workbooks private. Do not enable link sharing or publish tabs as CSV.

## 3. Add Cloudflare Worker secrets

In Cloudflare Dashboard, open **Workers & Pages → infection-control-amr-tockph → Settings → Variables and Secrets**. Add these as encrypted secrets:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: the service account's `client_email` value.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: the complete `private_key` value, including the PEM BEGIN/END lines.

Do not add these values as plain-text variables, commit them to GitHub, or expose them in frontend code. The Worker signs a short-lived OAuth assertion server-side and obtains a Google access token with the Sheets scope.

## 4. Verify the connection

After the Worker with this integration is deployed:

1. Sign in to the dashboard as an administrator.
2. Open **Імпорт та контроль якості даних**.
3. Select **Перевірити з’єднання**. The response should list the allow-listed target tabs and their headers.
4. Open **Реєстр закладів**. The directory should load from the two private source tabs.
5. Use **Попередній перегляд змін** before **Оновити зараз → Facilities**. The latter writes only mapped, non-empty fields and does not overwrite formula cells.

AST import from `AST_Data` also reads directly through the Sheets API and continues to pass through the authenticated Worker validation and D1 persistence path.

## Notes

- The service account needs Viewer on source workbooks and Editor on the target workbook.
- The `Users` tab is deliberately excluded from generic reads.
- Facility source rows containing director, email, and phone columns are not returned by the facility endpoint.
- Facility auto-sync triggers are not part of this direct-API implementation. Use the manual preview and synchronization controls.
- If the dashboard reports `google_service_account_not_configured`, one or both Cloudflare secrets are missing. If Google returns 403, check API enablement and workbook sharing permissions.
