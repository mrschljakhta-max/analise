# ANALISE — імпорт оперативних звітів (ОЧ_SE Excel + ПБД Word)

Модуль парсить структуровані рядки зі звітів, звіряє значення з довідниками, невідомі відправляє в «Чистилище» і після явного підтвердження записує в Cloudflare D1.

## Що підтримується

- **Excel ОЧ_SE** — колонки A–O.
- **Word ПБД** — таблиця активності станцій у розділі 3.2.1.

Оригінальні байти файлів не зберігаються.

## API

- `POST /api/operational-reports/prepare`
- `POST /api/operational-reports/commit` (confirmed + expected_fingerprint)

## Перевірка довідників

- ВП/СП → vp_sp_objects
- Населені пункти → settlements
- Станції → stations
- Підрозділи → org_units

Невідомі йдуть в «Чистилище» (dq_occurrences).

## Розгортання

1. Міграція 0018.
2. Deploy API.
3. prepare → перегляд unresolved → commit.
