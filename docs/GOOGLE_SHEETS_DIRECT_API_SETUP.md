# Серверна авторизація та Google Sheets

## Цільова архітектура

- Єдина база робочих даних: одна приватна Google Sheets книга.
- Cloudflare Worker — серверний API, авторизація, сесії та контроль доступу.
- Працівники не входять через Google і не отримують доступу до книги в Google Drive.
- Worker використовує Google service account для читання/запису книги.
- Cloudflare D1 не використовується.
- Паролі зберігаються тільки як PBKDF2-HMAC-SHA256 хеші з випадковою сіллю.

## 1. Google service account

1. У Google Cloud Console створіть або виберіть проєкт.
2. Увімкніть **Google Sheets API**.
3. Створіть **IAM & Admin → Service Accounts → Create service account**.
4. Створіть JSON key для service account і збережіть локально в захищеному місці. Не додавайте файл у репозиторій.
5. Відкрийте головну Google-книгу та надайте адресу service account роль **Editor**.
6. Скопіюйте адресу service account і поле `private_key` із JSON key. Приватний ключ нікому не надсилайте.

## 2. Cloudflare Worker secrets

У корені локальної копії репозиторію виконайте команди. Wrangler запитуватиме значення в інтерактивному режимі:

```bash
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put GOOGLE_SPREADSHEET_ID
npx wrangler secret put SESSION_SECRET
```

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: поле `client_email` service account.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: повне значення `private_key`, включно з BEGIN/END PRIVATE KEY. Збережіть переноси рядків; Worker також обробляє escaped `\\n`.
- `GOOGLE_SPREADSHEET_ID`: частина URL книги між `/d/` та `/edit`.
- `SESSION_SECRET`: випадковий секрет щонайменше 32 байти. Згенерувати локально можна командою `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

## 3. Початковий адміністратор

У вкладці `Users` має бути перший рядок заголовків із такими полями (порядок колонок може відрізнятися):

`User_ID | Username | Email | Display_Name | Password | Password_Hash | Role | All_Facilities | Facility_Codes | Is_Active | Must_Change_Password | Created_At | Updated_At | Last_Login_At | Notes`

Колонка `Password` залишається порожньою. Хеш записується в `Password_Hash`. Генеруйте його локально:

```bash
node scripts/generate-password-hash.mjs
```

Тимчасово задайте:
```bash
npx wrangler secret put BOOTSTRAP_ADMIN_USERNAME
npx wrangler secret put BOOTSTRAP_ADMIN_PASSWORD_HASH
```

За потреби також задайте `BOOTSTRAP_ADMIN_DISPLAY_NAME`.

Якщо у `Users` немає жодного запису, Worker створить адміністратора з цими значеннями під час першої спроби входу. Початковий адміністратор отримає `Must_Change_Password=TRUE), тому після першого входу система примусово запропонує змінити пароль. Після успішного створення першого користувача видаліть тимчасові секрети:

```bash
npx wrangler secret delete BOOTSTRAP_ADMIN_USERNAME
npx wrangler secret delete BOOTSTRAP_ADMIN_PASSWORD_HASH
npx wrangler secret delete BOOTSTRAP_ADMIN_DISPLAY_NAME
```

Не використовуйте простий пароль. Мінімальна довжина пароля, який задає адміністратор або користувач, — 12 символів.

## 4. Керування користувачами

У вкладці Users:
- `Username` — унікальний логін (3–40 символів: латиниця, цифри, крапка, дефіс, підкреслення).
- `Email` — контактна адреса, не використовується як логін.
- `Display_Name` — ПІБ або відображуване ім'я.
- `Role` — `admin`, `operator`, `analyst`.
- `All_Facilities=TRUE` — доступ до всіх закладів.
- `All_Facilities=FALSE` — доступ лише до кодів із `Facility_Codes`, розділених комою або крапкою з комою.
- `Is_Active=FALSE` — блокування облікового запису.
- `Must_Change_Password=TRUE` — примусова зміна пароля під час входу.

Початковий пароль передається Worker через HTTPS, хешується на сервері та не повертається браузеру. Значення `Password` не використовується.

## 5. Контроль доступу

Worker перевіряє сесію, роль і доступ до закладів для кожного API-запиту. Для обмежених користувачів рядки фільтруються за:
- `Facilities.EDRPOU`;
- `AST_Data.Hospital_ID` та `WGS_Staging.Hospital_ID`;
- `Facility_ID` у профілях IPC, візитах, оцінюваннях, рекомендаціях і статистиці навчань.

Довідники та нормативні акти є спільними. `Training_Events` наразі розглядається як спільний реєстр заходів; деталізація за закладами зберігається у `Training_Facility_Stats`.

Ролі:
- admin: повний доступ і адміністрування;
- operator: запис у межах призначених закладів; реєстр закладів і Users змінює лише admin;
- analyst: читання без запису.

Важливо: серверний контроль доступу працює лише через Worker API. Не використовуйте service account credentials у браузері або інших клієнтах.

## 6. Розгортання та перевірка

1. Переконайтеся, що всі чотири основні Worker secrets задані.
2. Виконайте `npm run build`.
3. Розгорніть `npx wrangler deploy` або злийте PR, якщо Cloudflare deploy запускається GitHub Actions.
4. Перевірте `GET /api/health`: очікується `{"ok":true,"storage":"google-sheets"}`.
5. Увійдіть під bootstrap admin, змініть пароль, створіть тестового оператора з обмеженим переліком кодів.
6. Переконайтеся, що оператор бачить лише призначені заклади та не може записувати дані поза їх межами.

GitHub Actions secret `CLOUDFLARE_API_TOKEN` потрібен окремо для автоматичного deploy. Не зберігайте Google private key у GitHub Actions або Vite build variables.
