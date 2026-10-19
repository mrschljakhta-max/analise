# Emergency restore: api/src/index.js

## Problem
After merge of PR #63, `api/src/index.js` on `main` was overwritten with the literal text `SEE_ARTIFACT` (tooling artifact). The Worker entry point is broken until restored.

## Option A — GitHub Actions (recommended)
1. Open **Actions** → workflow **Restore index.js**
2. Run workflow **workflow_dispatch** on `main` (from branch `fix/restore-index-js-geo-wire` after this PR merges, or run from this branch then merge)
3. The job restores `index.js` from commit `a489110a5fde9d512ff582d8889aac7661008f38` and wires:
   - `tryGisGeoApi` / `tryGisGeoAsset` from `./gis-geo-routes.js`

## Option B — local (1 minute)
```bash
GOOD=a489110a5fde9d512ff582d8889aac7661008f38
git show ${GOOD}:api/src/index.js > api/src/index.js
# then apply the 3 inserts from docs/GIS_GEO_LAYERS.md
git add api/src/index.js
git commit -m "fix: restore api/src/index.js and wire GIS geo routes"
git push origin main
```

## After restore
```bash
cd api
npx wrangler d1 migrations apply analise-db --remote
npx wrangler deploy
```
