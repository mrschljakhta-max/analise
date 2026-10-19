// Single source of truth for NON-GEOGRAPHIC D1 reference panels.
// Change "enabled" here to show/hide each safe catalog; never use this file
// to gate or reveal military coordinates, routes, sectors or events.
// Geographic settlement layers have their own civilian-only endpoints.
export const GIS_REFERENCE_VISIBILITY=Object.freeze({
  uav:Object.freeze({enabled:true,mode:"reference_only"}),
  vp:Object.freeze({enabled:true,mode:"reference_only"}),
  station:Object.freeze({enabled:true,mode:"reference_only"})
});
export const isVisibleReference=(key,policy=GIS_REFERENCE_VISIBILITY)=>
  policy?.[key]?.enabled===true&&policy?.[key]?.mode==="reference_only";
export const GIS_REFERENCE_VISIBILITY_JS=
  "'use strict';window.ANALISE_GIS_REFERENCE_VISIBILITY="+
  JSON.stringify(GIS_REFERENCE_VISIBILITY)+";";
