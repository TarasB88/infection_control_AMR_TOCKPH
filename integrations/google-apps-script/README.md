# Google Sheets integration

The dashboard uses a **credential-free, read-only XLSX export** for the two Google Sheets that supply the facility directory.

- No Google service account, OAuth credentials, API key, private key, Apps Script project, web app, or trigger is required.
- The Cloudflare Worker downloads the selected source sheets through Google's XLSX export URL and merges organizational facility fields by EDRPOU.
- The Worker never writes to Google Sheets.
- The private IPC/AMR workbook and its restricted tabs are not accessed by this integration.
- AST data is imported to Cloudflare D1 through authenticated Excel upload or manual entry.

Follow [Google Sheets without service account or Apps Script](../../docs/GOOGLE_SHEETS_DIRECT_API_SETUP.md) for the source IDs, GIDs, access requirements and privacy constraints.

**Privacy:** Google link-view permissions apply to the entire workbook. Use separate sanitized source workbooks containing only the organizational fields needed by the facility directory. Never open a workbook publicly if it contains patient data, personal contact details, credentials, or restricted worksheets.

The folder name is retained for repository history only. There is no Apps Script code or deployment step in the current implementation.
