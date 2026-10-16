# ANALISE · Universal Drag & Drop (synthetic-only test)

This module is at /api/synthetic-upload and is an isolated, safe test stage.

## Supported input
- One or many DOCX/XLSX test files
- ZIP wrapping both files, including subfolders
- Dragged folders (Chromium webkitGetAsEntry and folder picker fallback)
- One upload zone, compact summary, detailed Word/Excel tables

## Test fixtures
- ANALISE_ДЕМО_таблиця_76.docx — four columns, 76 invented rows, two headings
- ANALISE_ДЕМО_журнал_21.xlsx — «Запити», 30 columns, 21 invented rows
- ANALISE_ДЕМО_пакет.zip — both documents nested in a folder

Each sample embeds analise-fixture.json with marker ANALISE_SYNTHETIC_ONLY_V1.
The server also validates fictional reference values against a strict allowlist.
Real reports and unmarked files are rejected.

## D1 behavior
- Migration 0014_synthetic_import_demo.sql seeds a synthetic reference type.
- An authorized test upload initializes two fictional canonical entries in demo_quality_labels.
- Fictional typos create Purgatory queue entries with stable source references.
- Re-uploads are idempotent; approved rules automatically resolve later test occurrences.
- Uploaded file bytes are never persisted in R2; only fictional review issues enter D1.
- Admin role and same-origin requests are mandatory.
- Maximum file is 5 MB; ZIP decompression is limited.

## Limitations
This is not a production report importer. It cannot accept operational
coordinates, stations, targets, frequency lists, or other military records.
It also does not yet implement R2 upload history or background processing.
The brief upload result exists only in the browser session.

## Deploy and QA
1. Merge PR into main.
2. Run ANALISE D1 schema migration (0014) successfully.
3. Run Deploy ANALISE API successfully.
4. Drop ANALISE_ДЕМО_пакет.zip.
5. Verify 2 accepted files, 97 rows and 49 synthetic issues (38 Word + 11 Excel).
6. In /api/purgatory link "Альфа деммo" to "Альфа-демо"
   and "Бетта-демо" to "Бета-демо".
7. Re-import: approved rules should not create pending duplicates.
8. Verify unmarked files and unauthenticated viewers cannot upload.
