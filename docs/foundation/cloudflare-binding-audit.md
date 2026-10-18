# FND-004.2 · Аудит прив'язок GIS Dev і Staging

**Передумова:** GitHub Actions `GIS Cloudflare environment provisioning` успішно виконав `create` та `verify` окремо для `dev` і `staging`. Фактичні ресурси були створені 2026-10-18.

## Що перевіряємо зараз

Ресурси вже є в Cloudflare. Тепер треба підтвердити **справжні** ідентичності, а не лише назви:

- Dev D1 UUID ≠ Staging D1 UUID; жоден не дорівнює `database_id` із поточного `api/wrangler.toml`.
- Dev KV namespace ID ≠ Staging KV namespace ID.
- Dev R2 bucket і Queue відрізняються від Staging; ні один GIS R2 не збігається з бакетом із `api/wrangler.toml`.
- Ресурси мають потрібні імена й усі присутні у відповідях Cloudflare API.

Аудит виконує `gis/scripts/audit-cloud-bindings.mjs`, використовуючи **тільки GET** через уже створений `CLOUDFLARE_GIS_PROVISION_TOKEN`. Він не виконує D1 SQL, не створює ресурси, не розгортає Worker.

## Як запустити

Відкрий GitHub → Actions → **GIS cloud binding audit** → Run workflow.

Перший запуск:

| Поле | Значення |
|---|---|
| Branch | `main` |
| Operation | `audit` |

Успіх означає `status: resource_identities_distinct` і `worker_deployed: false`. Ця перевірка не створює, не змінює й не видаляє ресурси.

Після успіху можна окремо запустити `operation = bundle`. Workflow створить **лише локальні тимчасові** файли `gis/infra/wrangler.dev.toml` і `gis/infra/wrangler.staging.toml`, перевірить заповнення D1/KV placeholder і видалить їх. Вони потрапляють під `.gitignore`; фактичні ID не друкуються і не зберігаються як CI артефакти.

## Безпека

- GitHub Workflow не запитує і не записує ресурси на стороні Cloudflare, крім запитів списку в рамках вже існуючого токена.
- `api/wrangler.toml` використовується виключно для **локального порівняння**, не змінюється.
- Згенерована конфігурація має `workers_dev = false`; жодна публічна URL не створюється.
- `GIS API` все ще повертає 503 для маршрутів даних, доки немає Cloudflare Access, серверного RBAC та перевірки авторизації.
- Навіть зелений `audit` **не є** підтвердженням runtime-ізоляції прав: для цього згодом потрібні окремі Workers, реальні політики доступу та негативні перевірки перехресного доступу.
- Не розгортай синтетичний GIS Worker вручну на робочий `analise-api` або з конфігом `api/wrangler.toml`.

## Після успішного audit

1. Налаштувати Cloudflare Access для **нових GIS-середовищ** з явними правилами, без відкритих маршрутів.
2. Створити окремі dev/staging Workers, які **за замовчуванням відхиляють** запити до даних.
3. Виконати negative auth і cross-environment перевірки.
4. Лише після доказу ізоляції переходити до початкової GIS D1-моделі та R2 маніфестів.

Foundation Gate 00 залишається в роботі. Збережені документи ANALISE й production D1 не змінюються.
