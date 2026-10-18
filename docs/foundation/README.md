# ANALISE / OSM MAP STUDIO · Foundation implementation

**Status (2026-10-18): IN PROGRESS. Gate 00 has NOT passed.**

Architecture: **one GitHub monorepo**, two logical applications.
- Existing `api/` remains the operational ANALISE Worker with **unchanged** D1/R2 bindings.
- `gis/` contains a standalone **synthetic-only** React + TypeScript + MapLibre shell and GIS contracts.
- New GIS D1/R2/KV/Queues are **not provisioned or deployed** by this PR. Existing ANALISE references will eventually be exposed through a narrowly scoped, authenticated read-only API — not direct client-side D1 access.
- `gis/infra/wrangler.{dev,staging,production}.toml.example` are undeployable placeholders. The node guard only proves text templates are distinct, **not actual Cloudflare isolation**.

## Foundation backlog progress (against FND-001...018)

| Tasks | Evidence added | Status |
|---|---|---|
| FND-001 | Existing monorepo plus CODEOWNERS file | PARTIAL: `main` branch rules require GitHub admin action |
| FND-002 | GIS Foundation CI, Node tests, typechecks, build and secret-pattern guard | PARTIAL: no lockfile / `npm ci`; no real staging E2E |
| FND-003 | Versioned Workspace/Project/Dataset/Layer/Feature contracts | PARTIAL: no API or schema integration |
| FND-004/005 | Independent three-environment resource templates and separation test | BLOCKED: provision real D1/R2/KV/Queues and Access, verify binding IDs |
| FND-006/009 | GIS API always denies data reads/writes pending resource RBAC; existing ANALISE `/api/files` list/upload/download now requires an active `admin` | PARTIAL: no per-workspace membership, object-level permissions or negative IDOR suite for GIS yet |
| FND-007/008 | Standalone synthetic React/MapLibre UI shell with themes and density | PARTIAL: requires CI build evidence and later user approval to integrate into ANALISE |
| FND-010...018 | Design/POC/DR/acceptance work pending | NOT ACCEPTED |

## Cloudflare operations — do not shortcut

1. Inventory current resources and read `d1_migrations` / `sqlite_master` **read-only**. The existing 0016/0019 schema-vs-ledger divergence must be reconciled separately.
2. Provision distinct GIS Dev and Staging **real** Cloudflare resources; avoid binding production D1 to non-production GIS Workers.
3. Verify Cloudflare Access and service-token scopes individually. Never commit Access secrets/tokens into GitHub.
4. Run negative cross-environment tests and prove staging cannot read/write production.
5. Only then begin GIS resource schema / R2 revision-manifest POC, and separately review production resources.

No `wrangler d1 migrations apply` or deploy runs from the GIS Foundation workflow. `gis/apps/api` exposes only a fail-closed API and a non-sensitive local health endpoint.

## Manual GitHub action required

Enable **branch protection / repository ruleset** for `main`: require PR, at least one independent review, CODEOWNERS approval, status checks (existing ANALISE CI and GIS Foundation checks where relevant), dismiss stale approvals, block force pushes. GitHub repository settings were not accessible to this implementation and this file does **not** claim enforcement.

## Dev commands

```bash
cd gis
npm install
npm run check
npm run dev
```

Run this synthetic-only preview locally; it has no connection to Cloudflare or the ANALISE database. GIS Foundation CI will validate bundling in GitHub Actions. Do not mark FND-002 PASS until lockfile and `npm ci` are in place.

## Change in existing ANALISE file permissions

As a conservative interim control, the previously general authenticated `/api/files` listing, download and upload routes now require `user.role === "admin"` and `active === 1`. Existing administrator workflows remain; nonadmins receive HTTP 403 before any D1 or R2 access. This is **not** object-scoped RBAC: delegated access remains blocked until explicit ACLs and IDOR tests are implemented. RAW document routes and existing Purgatory data have not been modified.
