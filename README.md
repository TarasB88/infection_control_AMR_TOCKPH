# IPC & AMR Monitoring — Ternopil CDC

Внутрішній вебзастосунок для моніторингу інфекційного контролю (IPC) та антимікробної резистентності (AMR).

## Архітектура та сховище

- Єдине постійне сховище робочих даних і користувачів — одна приватна Google-книга.
- Cloudflare D1 не використовується.
- Cloudflare Worker виконує серверну авторизацію, перевірку ролей і доступу до закладів та єдиний серверний доступ до Google Sheets API.
- Працівники входять за логіном і паролем. Їм не потрібні Google-акаунти або доступ до книги у Drive.
- Google service account є технічним серверним обліковим записом. Його приватний ключ зберігається лише в Cloudflare Secrets і ніколи не передається браузеру.
- Паролі не зберігаються відкритим текстом. Worker використовує PBKDF2-HMAC-SHA256 із випадковою сіллю; сесія — підписана HttpOnly/Secure/SameSite cookie.
- Права на заклади перевіряються на сервері: усі заклади або визначений перелік кодів.

## Робочі аркуші

`Facilities`, `Facility_IPC_Profile`, `IPC_Visits`, `IPC_Assessments`, `Recommendations`, `Training_Events`, `Training_Facility_Stats`, `AST_Data`, `WGS_Staging`, `Legal_Acts`, `Dictionaries`, `Users`.

У `Users` потрібні заголовки, зокрема: `User_ID`, `Username`, `Email`, `Display_Name`, `Password`, `Password_Hash`, `Role`, `All_Facilities`, `Facility_Codes`, `Is_Active`, `Must_Change_Password`, `Created_At`, `Updated_At`, `Last_Login_At`, `Notes`. Колонка `Password` має залишатися порожньою; фактичний пароль зберігається лише у `Password_Hash`. Не видаляйте цю колонку, якщо вона вже є.

## Налаштування

Повна інструкція: [docs/GOOGLE_SHEETS_DIRECT_API_SETUP.md](docs/GOOGLE_SHEETS_DIRECT_API_SETUP.md).

Коротко:
1. Створіть Google Cloud service account та увімкніть Google Sheets API.
2. Надайте service account Editor-доступ до головної книги.
3. Додайте серверні секрети в Cloudflare Worker: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_SPREADSHEET_ID`, `SESSION_SECRET`.
4. Для першого адміністратора тимчасово задайте `BOOTSTRAP_ADMIN_USERNAME` і `BOOTSTRAP_ADMIN_PASSWORD_HASH`. Після першого входу та створення запису адміністратора ці два секрети можна видалити.
5. Розгорніть Worker. Після входу адміністратор створює облікові записи працівників у вкладці «Користувачі та доступ».

Для генерації початкового PBKDF2-хешу запустіть `node scripts/generate-password-hash.mjs` у локальному терміналі. Введений пароль не передається до GitHub або ChatGPT.

## Ролі та доступ до закладів

- `admin`: керування користувачами, доступ до всіх даних і закладів.
- `operator`: перегляд і внесення даних у межах призначених закладів.
- `analyst`: перегляд без запису.
- `All_Facilities=TRUE`: доступ до всіх закладів.
- `All_Facilities=FALSE`: доступ лише до кодів у `Facility_Codes`, розділених крапкою з комою або комою.

Сервер фільтрує рядки та перевіряє scope під час запису. Google service account має доступ до всієї книги, але його ключ не розкривається клієнтам.

## Безпека даних

Не зберігайте прямі ідентифікатори пацієнтів. Для `Patient_ID` використовуйте погоджені псевдоніми. Доступ до системи не замінює організаційні вимоги щодо класифікації, мінімізації та захисту медичної інформації.

## Розгортання

GitHub Actions потребує Cloudflare API token у GitHub Actions secret `CLOUDFLARE_API_TOKEN`. Для налаштування runtime secrets використовуйте Cloudflare Dashboard або `wrangler secret put`; не додавайте приватні ключі до GitHub Variables, вихідного коду чи Vite `.env`.

Локально: `npm install`, `npm run dev`, `npm run build`.
