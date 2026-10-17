# ANALISE D1 — read-only migration drift audit

This diagnostic does not alter D1. It only reads schema metadata and Wrangler's migration ledger using SELECT queries. It is deliberately separate from the deployment and migration workflows.

## Known findings (operator screenshots, 17 October 2026)

- Standard `d1_migrations` currently records `0001` to `0015`.
- The expected `0016` and `0019` SQLite objects were observed by name/type, and `demo_import_documents.version_id` is present as TEXT.
- The selected `0017` and `0018` objects were absent.
- Presence of objects does **not** prove exact SQL-definition parity or referential/data integrity.

## Browser-only audit

After review and merge, open **Actions → ANALISE D1 migration drift (read only) → Run workflow → main**. It uses the existing Cloudflare credentials in GitHub Actions, but the script sends **only SELECT queries** and prints only migration statuses and missing-object counts. GitHub Actions logs may be public because this repository is public; no private row contents are intentionally printed. Never paste API tokens into actions inputs or chat.

The scripts can also run inside a trusted environment with Wrangler installed:

```bash
cd api
node scripts/audit-d1-migrations.mjs
```

Environment variables `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` must be available.

## Before any change

1. Check **Cloudflare D1 → analise-db → Time Travel** and retain the current bookmark. Cloudflare creates Time Travel bookmarks automatically, and their retention depends on the plan. Restoration is destructive.
2. Compare all relevant full SQL definitions in `sqlite_master.sql` with the migration source, and inspect the `demo_import_documents.version_id` column and foreign keys. This script checks **names/types only**.
3. Verify `PRAGMA foreign_key_check;` returns **zero rows**, and ensure no other migration workflow is running.
4. Do **not** run `migrate-d1.yml` while existing 0016/0019 objects are missing from `d1_migrations`; rerunning ALTER TABLE may fail.
5. Only after a human review of exact SQL definitions and a recorded rollback point, prepare a separate change that reconciles `d1_migrations`. Do not insert ledger rows solely based on this script's output.
6. Decide on 0017 and 0018 separately; they are outside the dedicated synthetic Word migration script.

No INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, migration apply, restore or deploy is performed by this tool. Running the audit does **not** authorize running the general migration workflow.
