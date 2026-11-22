# IPC & AMR Monitoring — Ternopil CDC

Внутрішній україномовний вебзастосунок для моніторингу інфекційного контролю (IPC) та антимікробної резистентності (AMR) у закладах охорони здоров'я.

## Єдине джерело даних

- Усі робочі дані зберігаються в одній приватній книзі Google Sheets.
- Cloudflare D1 повністю вилучено: немає binding, міграцій, SQL-запитів або D1 API.
- Cloudflare Worker лише роздає статичний frontend.
- Користувач входить через Google Identity Services (OAuth).
- Браузер напряму читає та записує Google Sheets API; service account, Google client secret, private key і Apps Script не використовуються.
- OAuth Client ID — публічний параметр збірки, не секрет.

## Робочі аркуші

`Facilities`, `Facility_IPC_Profile`, `IPC_Visits`, `IPC_Assessments`, `Recommendations`, `Training_Events`, `Training_Facility_Stats`, `AST_Data`, `WGS_Staging`, `Legal_Acts`, `Dictionaries`, `Users`.

Відсутні аркуші створюються автоматично, а початкові заголовки додаються лише до порожніх вкладок. Уже наявні заголовки не перезаписуються.

## Налаштування Google OAuth

1. У Google Cloud Console створіть проєкт та увімкніть Google Sheets API.
2. Налаштуйте OAuth consent screen.
3. Створіть OAuth Client ID типу Web application.
4. Додайте production origin у Authorized JavaScript origins.
5. У GitHub → Settings → Secrets and variables → Actions → Variables створіть змінну `GOOGLE_OAUTH_CLIENT_ID` з цим Client ID.
6. Переконайтеся, що перший адміністратор має доступ до робочої книги в Google Drive.
7. Перший Google-акаунт, який увійде, якщо Users ще не містить профілів, стане адміністратором. Після цього адміністратор додає інші email у Users.

Додаткові параметри наведені в [Google Sheets setup](docs/GOOGLE_SHEETS_DIRECT_API_SETUP.md).

## Важливе обмеження безпеки

Google Sheets permissions діють на всю книгу. Ролі з аркуша Users керують інтерфейсом, але не є серверним контролем доступу до окремих вкладок або рядків. Кожен користувач, якому надано доступ до книги та який авторизувався, технічно може прочитати/змінити її вкладки через Google API.

Не зберігайте прямі ідентифікатори пацієнтів. Для Patient_ID використовуйте заздалегідь погоджені псевдоніми. Не надавайте доступ до книги тим, кому не можна бачити всі її дані.

## Розгортання

GitHub Actions запускає TypeScript/Vite build та розгортання Worker. Для Cloudflare deploy все ще потрібен Cloudflare API token як GitHub Actions secret `CLOUDFLARE_API_TOKEN`. Це токен Cloudflare deployment, не Google secret.

## Локальна розробка

```bash
npm install
# створіть .env.local на основі .env.example
npm run dev
npm run build
```

