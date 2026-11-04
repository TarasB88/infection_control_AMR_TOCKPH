# AMR AST API: захищений імпорт до Cloudflare D1

## Поточний стан

Worker надає endpoint `POST /api/amr/ast/import`. Він приймає до 1000 рядків AST за запит, перевіряє обов’язкові поля та записує дані у таблиці `facilities`, `isolates`, `ast_results`, `import_batches` і `audit_log`.

API не приймає запити без Bearer-токена. Значення `Patient_ID` не зберігається: Worker формує HMAC-SHA-256 псевдонім із секретом `PATIENT_HMAC_SECRET`.

## 1. Обов’язкові секрети Worker

Створити два незалежні секрети:

```bash
npx wrangler secret put API_TOKEN
npx wrangler secret put PATIENT_HMAC_SECRET
```

- `API_TOKEN`: довгий випадковий токен для авторизованих операторів імпорту.
- `PATIENT_HMAC_SECRET`: окремий випадковий секрет щонайменше 32 символи. Не використовувати той самий секрет, що й API_TOKEN.
- Не додавати секрети до Git, `.env`, frontend-коду або Excel-файлів.
- Якщо PATIENT_HMAC_SECRET буде втрачено або змінено, псевдоніми тих самих пацієнтів перестануть збігатися між імпортами.

## 2. Застосувати D1-міграцію

Після перевірки, що D1 створена і database_id внесений у `wrangler.jsonc`:

```bash
npx wrangler d1 migrations apply infection-control-amr-tockph --remote
npx wrangler d1 migrations list infection-control-amr-tockph --remote
```

## 3. Формат запиту

```http
POST /api/amr/ast/import
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
```

Тіло:

```json
{
  "sourceName": "AMR_AST_2026.xlsx",
  "rows": [
    {
      "Hospital_ID": "FAC-001",
      "Hospital_Name": "Заклад охорони здоров'я",
      "Region_Oblast": "Тернопільська",
      "Territorial_Hromada": "Тернопільська міська",
      "Settlement": "Тернопіль",
      "Patient_ID": "PSEUDO-0001",
      "Sample_ID": "SAMPLE-0001",
      "Sampling_Date": "2026-10-15",
      "Sample_Matrix_Type": "Blood",
      "Bacterial_Species": "Klebsiella pneumoniae",
      "Antimicrobial_Agent": "Meropenem",
      "MIC_Operator": ">",
      "MIC_Value": "16",
      "Zone_Diameter": "10",
      "SIR_Category": "R",
      "Interpretation_Standard": "EUCAST 2026"
    }
  ]
}
```

## 4. Відповіді

- `201`: усі рядки прийняті та збережені.
- `207`: частковий імпорт; частина рядків відхилена валідацією. Відповідь містить `issues`.
- `401`: відсутній або неправильний Bearer-токен.
- `413`: тіло запиту завелике.
- `422`: жоден рядок не пройшов валідацію.
- `500`: помилка запису; перевірити Worker logs і D1.

Імпорт ідемпотентний за ключами джерела: повторний імпорт того самого закладу/зразка/мікроорганізму та препарату оновлює відповідні записи, а не створює дублікати.

## 5. Важливі обмеження MVP

- API-token є спільним секретом, а не повноцінною системою користувачів і ролей. Для промислової експлуатації потрібні Cloudflare Access/SSO, RBAC та індивідуальний аудит користувачів.
- `Patient_ID` має бути псевдонімізований у джерелі ще до передачі, якщо це можливо. Worker додатково не зберігає його у відкритому вигляді.
- `Isolate_ID` у поточній таблиці виводиться детерміновано з `Hospital_ID + Sample_ID + Bacterial_Species`. Якщо лабораторна форма матиме окремий стабільний Isolate_ID, модель потрібно буде розширити.
- Розрахунок відсотків резистентності не виконується цим endpoint. Для нього окремо погоджуються знаменник, дедуплікація, період і правила EUCAST.
- Не завантажувати реальні дані до підтвердження міграції, налаштування секретів, доступів, резервного копіювання та правових підстав обробки.
