# Google Apps Script bridge

Цей каталог містить Apps Script код, який надає Cloudflare Worker контрольований серверний доступ до приватної робочої книги Google Sheets.

1. Відкрийте цільову книгу Google Sheets.
2. Extensions → Apps Script.
3. Замініть вміст `Code.gs` кодом із цього каталогу.
4. Запустіть `setupBridge()` і скопіюйте згенерований bridge secret.
5. Розгорніть як Web App: Execute as **Me**, access **Anyone**.
6. URL `/exec` та секрет передайте в Cloudflare Worker secrets як `SHEETS_SCRIPT_URL` і `SHEETS_BRIDGE_SECRET`.

Браузер не звертається до Google API напряму і не запускає Google OAuth. Доступ до приватної книги має Apps Script, який виконується від імені власника. Секрет перевіряється для кожної операції; він не передається frontend.

Google Forms можуть записувати відповіді у відповідні вкладки тієї самої книги. Назви вкладок форм задаються в `FORM_RESPONSE_TABS` на початку `Code.gs`.
