# GIS geographic layers (stations / VP-SP / UAV events)

Branch: `feature/gis-geo-layers`

## Migrations (apply on D1)

```bash
cd api
npx wrangler d1 migrations apply analise-db --remote
```

- `0020_vp_sp_locations.sql` — `vp_sp_location_history` (MGRS + lat/lon, one open row per object)
- `0021_operational_event_geo.sql` — derived WGS84 for committed operational events

Stations already use `station_location_history` (migration 0006).

## API (admin + Cloudflare Access)

| Method | Path | Source |
|--------|------|--------|
| GET | `/api/gis/stations-geo` | open `station_location_history` |
| GET | `/api/gis/vp-sp-geo` | open `vp_sp_location_history` |
| GET | `/api/gis/uav-events-grid?cell=0.5&from=&to=` | `operational_event_geo` cell centers |
| GET | `/api/gis-geo-layers.js` | client policy `ANALISE_GIS_GEO_LAYERS` |

Policy defaults (`api/src/gis-geo-layers.js`):

- stations: points
- vp_sp: points
- uav_events: **grid** (not individual points)

No frequencies, unit names, or raw report text are returned.

## Wire `index.js` (if not already applied)

```js
import {tryGisGeoApi, tryGisGeoAsset} from "./gis-geo-routes.js";

// after civil-grid:
{
  const geo = tryGisGeoApi(url, req, env, user);
  if (geo) return geo;
}

// inside gis-preview asset block, after reference-visibility:
{
  const asset = tryGisGeoAsset(url, req, appAsset, opts);
  if (asset) return asset;
}
```

## After merge

1. Apply migrations on remote D1.
2. Deploy Worker.
3. Populate `vp_sp_location_history` and backfill `operational_event_geo` from valid MGRS on committed events.
4. Map client: load layers from the three endpoints (next PR).
