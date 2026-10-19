// Single source of truth for GEOGRAPHIC map layers (admin GIS preview).
-- mode: points | grid | off
// Never use this file to expose frequencies, unit names, or raw report text.
export const GIS_GEO_LAYERS = Object.freeze({
  stations: Object.freeze({ enabled: true, mode: "points" }),
  vp_sp: Object.freeze({ enabled: true, mode: "points" }),
  uav_events: Object.freeze({ enabled: true, mode: "grid" }),
});

export const isGeoLayerEnabled = (key, policy = GIS_GEO_LAYERS) =>
  policy?.[key]?.enabled === true &&
  (policy[key].mode === "points" || policy[key].mode === "grid");

export const GIS_GEO_LAYERS_JS =
  "'use strict';window.ANALISE_GIS_GEO_LAYERS=" +
  JSON.stringify(GIS_GEO_LAYERS) +
  ";";
