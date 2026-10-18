# OSM MAP STUDIO · Adaptive Workspace v0.2

This step reuses the existing Access-protected ANALISE `/api/gis-preview`, current OSM tile renderer and eastern Ukraine demo viewport. **All synthetic, no D1/R2 read or writes, no GIS API deployment.**

## Implemented interactive UI

- Upper mode bar: **KPI, Маршрути, Підрозділи, Час, Чергові, Налаштування**. These change the sidebar scenario menu without reloading the map.
- Context sidebar: scenario cards (all clearly labeled DEMO), layer switches, center navigation and mode-specific info (example comparisons, fictional groups, routes, fake contacts, time stage slider).
- Right inspector and color-coded summary cards. Toggle left/right docks separately and hide both using the full-workspace button.
- Floating map tools: layers, reset, fictional connections, inspector, export studio, fullscreen.
- Demo shapes follow the viewport via the map's read-only projection bridge; no real or imported routes/units.
- User preferences for layout and selected mode are stored **only in localStorage** (no coordinates, contact details, uploaded files or private information).
- `Ctrl+K` keyboard shortcut opens a basic command prompt for switching modes and export.

## Export Studio

- Overlay dialog with map title, author, seven checkbox options (title, legend, scale label, north marker, information, KPI, grid).
- Live map preview based on the current raster tiles and active demo markers.
- `PNG`: attempts to draw **CORS-authorized** OSM tiles to a canvas; if a tile cannot be loaded with browser CORS permission, the app reports an error rather than producing a misleading blank map.
- `PDF · друк`: opens browser print dialog; use **Save as PDF**. Landscape A4 stylesheet provided, no server-side PDF generation.
- `Excel · CSV`: downloads a UTF-8 BOM, semicolon-separated CSV of the currently visible fictional demo points, Excel-compatible (not .xlsx). No operational records.

## Remaining scope and limitations

This is the interactive **UI prototype of the reference site's logic**, not a production GIS. There is no actual Workspace RBAC, live KPI calculation from backend data, real logs, real routes, measurement or graphic editing, geospatial file import, persistent user-project layers or server export jobs. GIS-only React/MapLibre foundation still lives in `gis/apps/web` and requires isolated Workers and Access after FND-004.

The map in the background uses public OpenStreetMap tiles. User identifiers/documents are not sent to the tile provider; only tile requests of the current preview area are sent. Real operational data must not be loaded here.

## Smoke test

1. After deployment open `/api/gis-preview`, hard refresh, verify six modes.
2. Change `Маршрути` and confirm fictional links, then `Підрозділи → Території` for polygon.
3. Switch `Час` and drag the demo slider to show 1, 2 or 3 fictional points.
4. Toggle layer switches, left and right docks, navigate the map then reset to eastern Ukraine.
5. Open `Експорт карти`: enter map title/author, toggle all seven options and review the live map preview.
6. Download `Excel · CSV`, check PDF print preview, try PNG (success depends on OSM CORS and tiles being loaded).
7. No D1 or R2 mutation; regression tests: `cd api && npm test`.
