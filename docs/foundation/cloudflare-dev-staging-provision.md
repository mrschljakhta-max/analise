# FND-004 · Створення ізольованих Cloudflare Dev / Staging

## Статус

Код автоматизації готовий; **реальні ресурси не створено**, доки окремий GitHub Actions workflow не завершиться успішно для кожного середовища. Не позначати FND-004 / Quality Gate 00 як PASS лише після коміту.

| Компонент | Dev | Staging |
|---|---|---|
| D1 | `analise-gis-dev-db` | `analise-gis-staging-db` |
| R2 | `analise-gis-dev-geodata` | `analise-gis-staging-geodata` |
| KV | `analise-gis-dev-cache` | `analise-gis-staging-cache` |
| Queue | `analise-gis-dev-jobs` | `analise-gis-staging-jobs` |

Продукційні ANALISE `analise-db` та `analise-private-documents` **не використовуються**, SQL-міграції не запускаються, Workers не деплояться, R2 публічним не стає.

## Підготовка доступів

У GitHub: Settings → Secrets and variables → Actions. Потрібні два секрети:

- `CLOUDFLARE_ACCOUNT_ID` — вже наявний ідентифікатор Cloudflare-акаунта.
- `CLOUDFLARE_GIS_PROVISION_TOKEN` — новий тимчасовий Cloudflare API token лише з необхідними Account дозволами: D1 Write, Workers R2 Storage Write, Workers KV Storage Write та Queues Write (якщо дозволи цього потребують, також читання інвентарю).

Не додавай токен у репозиторій, чат, PR, чи поле підтвердження workflow. Після завершення створення токен бажано відкликати.

**Важливо:** якщо для сховища потрібна конкретна юрисдикція (EU/US тощо), її треба погодити **до** запуску create. Поточна автоматизація використовує налаштування Cloudflare за замовчуванням і не створює регіональних обмежень.

## Порядок виконання

Відкрий GitHub → Actions → **GIS Cloudflare environment provisioning** → Run workflow:

1. `environment: dev`, `operation: plan`. Це локальний план без звернень до Cloudflare.
2. `environment: dev`, `operation: create`, `confirm: CREATE_GIS_DEV`. Workflow повністю читає інвентар чотирьох типів перед будь-яким POST.
3. `environment: dev`, `operation: verify`. Лише читає хмарний інвентар; нічого не змінює.
4. Повтори створення та verify для `staging`, підтвердження `CREATE_GIS_STAGING`.

У режимі `create` наявний ресурс із таким самим іменем вважається конфліктом — **автоматично перезаписувати, переймати або видаляти його заборонено**. Якщо створення зупиниться посередині, необхідна ручна звірка з Dashboard; автоматичного rollback немає. Для кожного нового середовища створюється чотири окремі ресурси.

У логах і summary з'являються тільки назви ресурсів без секретів та внутрішніх ID.

## Що ще потрібно до FND-004 PASS

- Реальні створені ресурси підтверджені через `verify`, у Dev та Staging різні D1/KV IDs.
- GIS Worker для кожного середовища матиме окрему перевірену прив'язку до своїх ресурсів; поки Workers **не** публікуються.
- Cloudflare Access policy на майбутні GIS endpoints, негативні тести доступу до чужого середовища й production.
- Політика відновлення D1/R2, інвентар ресурсів у приватній операційній документації та контроль видимості бакетів.
- Розбіжність журналу міграцій основного ANALISE вирішується окремо, загальний workflow `migrate-d1.yml` запускати не можна.

API Cloudflare: [D1](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/), [R2](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/), [KV](https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/methods/create/), [Queues](https://developers.cloudflare.com/api/resources/queues/methods/create/).
