# Google OAuth та профілі користувачів

## Як працює вхід

Додаток не має власного логіна/пароля і не використовує Cloudflare D1. Користувач входить через Google Identity Services. Профіль перевіряється за email і Google Subject у вкладці `Users` головної книги Google Sheets.

Перший Google-акаунт, який увійде, коли `Users` не містить профілів, буде доданий як адміністратор. Тому спочатку надайте доступ до книги лише відповідальному адміністратору, виконайте перший вхід, а вже потім надавайте доступ іншим працівникам.

## Структура аркуша Users

`Google_Sub | Email | Full_Name | Role | Is_Active | All_Facilities | Facility_Codes | Created_At | Updated_At`

Допустимі ролі: `admin`, `operator`, `analyst`. Пароль не створюється та не зберігається.

## Google Cloud

1. Створіть Google Cloud project.
2. Увімкніть Google Sheets API.
3. Налаштуйте OAuth consent screen для вебзастосунку.
4. Створіть OAuth Client ID типу Web application.
5. Додайте production origin застосунку в Authorized JavaScript origins.
6. Додайте до GitHub repository variables `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_API_KEY` та `GOOGLE_CLOUD_PROJECT_NUMBER`.

OAuth Client ID — публічний ідентифікатор, не секретний ключ. Google refresh/access tokens у поточній реалізації зберігаються лише в оперативній пам'яті сторінки; після перезавантаження користувач входить повторно.

## Права доступу: важливе обмеження

OAuth використовує scope `drive.file`; Google Picker надає застосунку доступ до вибраної користувачем книги, а не до всіх таблиць його Google Drive. Проте права Drive на саму книгу не розділяють вкладки або рядки. Ролі в Users застосовуються на рівні інтерфейсу й не є серверною авторизацією. Користувач, якому надано доступ до книги, може обійти UI й працювати з усіма вкладками через Google API.

Не використовуйте це як захищений багаторівневий контур доступу для пацієнтських даних. Для справжньої ізоляції потрібні окремі Google-книги з різними Drive permissions або авторизований серверний посередник.

## Розгортання

Cloudflare Worker лише роздає статичний застосунок. D1 migrations не використовуються. Для автоматичного розгортання GitHub Actions все ще потрібен Cloudflare token у secret `CLOUDFLARE_API_TOKEN`.
