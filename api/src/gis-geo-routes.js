// Optional GIS geographic layer routes. Wire from index.js fetch handler.
import { gisStationsGeoApi } from "./gis-stations-geo-api.js";
import { gisVpSpGeoApi } from "./gis-vp-sp-geo-api.js";
import { gisUavEventsGridApi } from "./gis-uav-events-grid-api.js";
import { GIS_GEO_LAYERS_JS } from "./gis-geo-layers.js";

/** @returns {Response|null} */
export function tryGisGeoApi(url, req, env, user) {
  if (url.pathname === "/api/gis/stations-geo") return gisStationsGeoApi(req, env, user);
  if (url.pathname === "/api/gis/vp-sp-geo") return gisVpSpGeoApi(req, env, user);
  if (url.pathname === "/api/gis/uav-events-grid") return gisUavEventsGridApi(req, env, user);
  return null;
}

/** @returns {Response|null} */
export function tryGisGeoAsset(url, req, appAsset, opts) {
  if (url.pathname === "/api/gis-geo-layers.js") {
    return appAsset(GIS_GEO_LAYERS_JS, "text/javascript; charset=utf-8", opts);
  }
  return null;
}
