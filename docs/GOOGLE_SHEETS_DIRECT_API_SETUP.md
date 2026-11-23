# Google Forms + Google Sheets: налаштування

## Архітектура

- Google Sheets — єдина база даних.
- Google Forms — форма внесення інформації в цю ж книгу.
- Google Apps Script Web App — приватний міст, що виконується від імені власника таблиці.
- Cloudflare Worker — серверний API та hosting frontend.
- Користувачі дашборду входять за логіном і паролем. Браузерний Google OAuth не використовується.
- 

## 1. Підготувати Google-книгу

Відкрийте існуючу робочу Google-книгу IPC & AMR. Вона має залишатися приватною; не використовуйте Publish to web.

## 2. Додати Apps Script bridge

1. У Google-книзі відкрийте **Extensions → Apps Script**.
2. У редакторі створіть/відкрийте файл `Code.gs` і вставте код із [integrations/google-apps-script/Code.gs](../integrations/google-apps-script/Code.gs).
3. Збережіть проєкт.
4. У списку функцій виберіть `setupBridge` та натисніть **Run**.
5. Надайте запитані Google permissions. Функція збереже ID книги та згенерує секрет bridge у Script Properties, а також створить необхідні аркуші з початковими заголовками.
6. Скопіюйте секрет, показаний у вікні завершення. Не надсилайте його в чат і не додавайте до GitHub.

## 3. Розгорнути Apps Script як Web App

1. Натисніть **Deploy → New deployment**.
2. Тип: **Web app**.
3. **Execute as:** Me (власник/редактор робочої книги).
4. **Who has access:** Anyone.
5. Натисніть Deploy та підтвердьте доступ.
6. Скопіюйте URL Web App, який закінчується на `/exec`.

Доступ Anyone потрібен лише для серверного виклику з Worker. Сам Apps Script перевіряє випадковий секрет із тіла кожного запиту. Браузер напряму до Apps Script не звертається, а Google-книга не публікується.

Після змін у Code.gs створіть нову версію deployment через **Deploy → Manage deployments → Edit → New version**.

## 4. Налаштувати Cloudflare Worker secrets

У Cloudflare Dashboard відкрийте Worker `infection-control-amr-tockph` → **Settings → Variables and Secrets** та додайте такі значення як **Secrets**:

| Назва | Значення |
|---|---|
| `SHEETS_SCRIPT_URL` | URL Apps Script Web App `/exec` |
| `SHEETS_BRIDGE_SECRET` | секрет, показаний функцією `setupBridge()` |
| `SESSION_SIGNING_SECRET` | випадковий унікальний секрет щонайменше 32 символи |
| `BOOTSTRAP_KEY` | окремий випадковий одноразовий ключ створення першого адміністратора |

Для `SESSION_SIGNING_SECRET` та `BOOTSTRAP_KEY` використовуйте генератор випадкових значень, а не звичайний пароль. Не зберігайте їх у GitHub repository variables, frontend `.env`, коді або чаті. Worker secrets налаштовуються в Cloudflare, а не в Vite.

Після збереження секретів перевірте, що нова версія Worker активна. Якщо користуєтеся локальним Wrangler, значення для локального запуску задаються в приватному `.dev.vars` (не комітити файл).

## 5. Створити першого адміністратора

1. Відкрийте production URL дашборду.
2. Під час першого запуску з'явиться форма початкового налаштування.
3. Введіть `BOOTSTRAP_KEY`, логін, пароль (мінімум 12 символів), ПІБ та email.
4. Після створення облікового запису додайте решту працівників у розділі **Користувачі**.

Паролі зберігаються в `Users` тільки як PBKDF2-HMAC-SHA256 хеші з індивідуальною сіллю. Відновити початковий пароль із таблиці неможливо.

## 6. Підключити Google Forms

Для кожного модуля:
1. Створіть Google Form.
2. У вкладці **Responses** виберіть **Link to Sheets** і вкажіть ту саму робочу книгу IPC & AMR.
3. Після створення вкладки відповідей перейменуйте її на відповідну назву:
   - `Form_IPC_Visits`
   - `Form_IPC_Assessments`
   - `Form_Training_Events`
   - `Form_AST_Data`
   - `Form_WGS_Staging`
4. Назви запитань налаштуйте так, щоб вони збігалися з назвами колонок цільового аркуша. Наприклад, для AST використовуйте `Hospital_ID`, `Hospital_Name`, `Sample_ID`, `Sampling_Date`, `Bacterial_Species`, `Antimicrobial_Agent`, `SIR_Category`, `Interpretation_Standard`.
5. Додавайте лише необхідні поля. Для `Patient_ID` використовуйте погоджений псевдонім, не ПІБ чи номер медичної карти.

Bridge автоматично приєднує відповіді з названих вкладок до відповідного набору даних при оновленні дашборду. Вихідна вкладка Google Forms залишається незміненою.

## 7. Ролі та права

- `admin`: повний доступ, створення користувачів і зміна ролей/активності;
- `operator`: перегляд і внесення записів;
- `analyst`: перегляд без запису.

Усі користувачі дашборду не повинні отримувати редакторський доступ до самої Google-книги. Bridge працює від імені власника. Поле `Facility_Codes` зберігається, але фільтрація рядків за закладами ще не реалізована.

## 8. Розгортання Cloudflare

GitHub Actions публікує Worker через Wrangler. Для CI/CD окремо потрібен чинний GitHub Actions secret `CLOUDFLARE_API_TOKEN` із правами Workers deployment і правильний Account ID. Цей токен не має стосунку до Google Sheets і не повинен передаватися в чат.

## 9. Перевірка

- `GET /api/health` має повертати `sheetsBridgeConfigured: true`, `sessionConfigured: true` і `bootstrapConfigured: true`.
- `GET /api/auth/status` має повертати кількість користувачів.
- Після входу дашборд завантажує аркуші Google Sheets.
- Тестова відповідь Google Form має з'явитися у відповідному модулі після оновлення.

