# Google Sheets integration

The dashboard now connects to Google Sheets directly from the Cloudflare Worker using a Google service account and the Google Sheets API.

**Do not create an Apps Script project or deploy an Apps Script Web App.** The previous bridge instructions, GOOGLE_SHEETS_BRIDGE_URL, and GOOGLE_SHEETS_BRIDGE_TOKEN are obsolete.

Follow the current setup guide:

- [Direct Google Sheets API setup](../../docs/GOOGLE_SHEETS_DIRECT_API_SETUP.md)

That guide covers service-account creation, private workbook sharing, Cloudflare Worker secrets, and connection verification.

The source and target spreadsheets must remain private. Never commit a service-account JSON key or share its private key in chat or frontend code.
