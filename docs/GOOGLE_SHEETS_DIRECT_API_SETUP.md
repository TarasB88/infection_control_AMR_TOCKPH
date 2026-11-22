# Google Sheets only: налаштування

## Архітектура

Браузерний застосунок напряму читає та записує Google Sheets. Серверний застосунок не має бази даних, не зберігає сесії, не виконує Google OAuth від імені користувача і не отримує Google private key.

- Cloudflare Worker: лише статичний frontend.
- Дані: одна приватна Google-книга.
- Вхід: персональний Google OAuth.
- API: Google Sheets API напряму з браузера.
- Немає D1, SQL, service account, client secret, private key, Apps Script.

Робоча книга за замовчуванням:
`1xXq4cXqLM7Jvs0ewDsFgGn9lLl7UtCn26fhDVIEqWVc`.

## 1. Google Cloud project

1. Відкрийте Google Cloud Console та створіть або виберіть проєкт.
2. Увімкніть **Google Sheets API**, **Google Drive API** та **Google Picker API**.
3. Налаштуйте OAuth consent screen (назва застосунку, контакт, тип користувачів/аудиторія).
4. Створіть credential типу **OAuth Client ID → Web application**.
5. У Authorized JavaScript origins додайте:
   - `https://docs.google.com` (потрібно для сторінки Picker у iframe; також додайте цей origin у Website restrictions API key).
   - `https://infection-control-amr-tockph.burdataras.workers.dev`
   - локальний origin для розробки, наприклад `http://localhost:5173`.
6. Скопіюйте OAuth Client ID. Client ID є публічним параметром; не створюйте й не використовуйте client secret для цього SPA token flow.

Для організаційного Google Workspace OAuth consent screen може вимагати внутрішній тип аудиторії та адміністративне схвалення.

## 2. GitHub Actions variable

У репозиторії відкрийте **Settings → Secrets and variables → Actions → Variables** і створіть:

| Назва | Значення |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Web OAuth Client ID з Google Cloud Console |
| `GOOGLE_API_KEY` | Публічний API key з обмеженням за HTTP referrer і Google Picker API |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | Числовий номер Google Cloud project (App ID для Picker) |

Це GitHub Actions repository variables, не secrets. Workflow передає їх у Vite як `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` і `VITE_GOOGLE_APP_ID`.

ID робочої книги зафіксований у workflow і в `.env.example`. Для локальної розробки створіть `.env.local` на основі `.env.example`.

## 3. Права на Google-книгу

Надайте Google-акаунтам працівників доступ до робочої книги у Google Drive. Для запису їм потрібен Editor. Для читання достатній Viewer, але застосунок у поточній версії має функції запису, тож практично потрібен Editor.

Після першого входу:
- якщо Users порожній, перший Google-акаунт автоматично додається як admin;
- адміністратор додає інші email, ПІБ, роль, статус і коди закладів;
- кожен доданий Google-акаунт окремо має отримати доступ до книги у Drive.

## 4. Робочі вкладки

Застосунок перевіряє та створює такі вкладки, якщо вони відсутні:

| Аркуш | Призначення |
|---|---|
| Facilities | Реєстр закладів |
| Facility_IPC_Profile | Організаційний IPC-профіль |
| IPC_Visits | Моніторингові візити |
| IPC_Assessments | Оцінювання за критеріями |
| Recommendations | Коригувальні заходи |
| Training_Events | Навчальні заходи |
| Training_Facility_Stats | Охоплення закладів навчанням |
| AST_Data | Результати AST |
| WGS_Staging | Геномні результати |
| Legal_Acts | Нормативно-правові акти |
| Dictionaries | Довідники |
| Users | Google-акаунти й ролі |

Якщо вкладка порожня, застосунок записує стандартний рядок заголовків. Якщо заголовки вже існують, вони залишаються без змін.

## 5. Patient_ID та клінічна інформація

Оскільки серверної псевдонімізації більше немає, не завантажуйте ПІБ, номер медичної карти, адресу, телефон, дату народження або інший прямий ідентифікатор. У Patient_ID має бути лише попередньо погоджений внутрішній псевдонім. Саме по собі хешування в браузері не перетворює клінічні дані на анонімні.

## 6. Межі доступу

Google Sheets permissions діють на всю книгу. Роль у Users лише визначає, які функції показує інтерфейс; вона не обмежує прямий доступ Google API до вкладок. Користувач із правом доступу до книги може обійти інтерфейс і прочитати/змінити її дані через Google API.

Це не еквівалент row-level security або окремих прав на вкладки. Не надавайте доступ до книги тим, кому не можна переглядати її повністю. Для суворої ізоляції потрібні окремі книги з різними Drive permissions або серверний шар авторизації.

## 7. Cloudflare deploy

Для автоматичного розгортання потрібен GitHub Actions secret `CLOUDFLARE_API_TOKEN` із правами на Workers deployment та відповідний account. Це єдиний deployment secret у цьому процесі; Google credentials на сервері відсутні.

Збірка виконується командою `npm run build`, розгортання — `npx wrangler deploy`. Міграції D1 не запускаються.
