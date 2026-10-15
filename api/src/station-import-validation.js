// Administrative spreadsheet preflight for ANALISE station directories.
// Pure validation only: no operational coordinates, coverage calculation or deployment controls.
const clean = value => String(value ?? '').trim();
const flag = value => value === true || value === 1 || /^(true|1|так|yes)$/i.test(clean(value));
const numeric = (value, label, errors, row) => {
  const n = Number(value);
  if (clean(value) === '' || !Number.isFinite(n)) errors.push({row, field:label, message:'Потрібне числове значення'});
  return n;
};
export function validateStationWorkbook({types = [], bands = [], stations = []} = {}) {
  const errors = [], warnings = [];
  const keys = new Map(), typeNames = new Map(), bandCodes = new Set(), stationCodes = new Set();
  types.forEach((t, i) => {
    const row = i + 2, id = clean(t.id), code = clean(t.type_code), name = clean(t['Назва засобу'] ?? t.name);
    if (!id || !code || !name) errors.push({sheet:'DICT_STATION_TYPES',row,message:'Потрібні id, type_code та назва'});
    for (const key of [id, code]) {
      if (!key) continue;
      if (keys.has(key) && keys.get(key) !== id) errors.push({sheet:'DICT_STATION_TYPES',row,message:'Неоднозначний ключ '+key});
      keys.set(key,id);
    }
    if (name) {
      const arr = typeNames.get(name) ?? [];
      arr.push(id);
      typeNames.set(name,arr);
    }
  });
  bands.forEach((b, i) => {
    const row = i + 2, code = clean(b.band_code), typeKey = clean(b.station_type_id);
    if (!code || bandCodes.has(code)) errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,message:'Порожній або повторний band_code'});
    bandCodes.add(code);
    if (!keys.has(typeKey)) errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,field:'station_type_id',message:'Ключ типу не знайдено. Числові ID не зіставляються за порядком рядків'});
    const name = clean(b['Назва'] ?? b.name);
    if (keys.has(typeKey) && name && !typeNames.get(name)?.includes(keys.get(typeKey)))
      errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,message:'Назва не відповідає пов’язаному типу'});
    const from = numeric(b.freq_from,'freq_from',errors,row);
    const to = numeric(b.freq_to,'freq_to',errors,row);
    const radius = numeric(b.radius,'radius',errors,row);
    const width = numeric(b.width,'width',errors,row);
    if (Number.isFinite(from) && Number.isFinite(to) && (from < 0 || to < from)) errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,message:'Некоректний частотний інтервал'});
    if (!(radius > 0)) errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,message:'radius має бути більше нуля'});
    const coverage = clean(b.coverage_type);
    if (!['omni','sector'].includes(coverage)) errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,message:'Невідомий coverage_type'});
    if (!(width > 0 && width <= 360) || (coverage === 'omni' && width !== 360) || (coverage === 'sector' && width >= 360))
      errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,message:'width не узгоджується з coverage_type'});
    if (!['detect','jam'].includes(clean(b['Режим'] ?? b.mode))) errors.push({sheet:'DICT_STATION_TYPE_BANDS',row,message:'Невідомий режим'});
  });
  stations.forEach((s,i) => {
    const row = i+2, code=clean(s.station_code ?? s.id), type=clean(s.station_type_id ?? s.type_code);
    if (!code || stationCodes.has(code)) errors.push({sheet:'DICT_STATIONS',row,message:'Порожній або повторний код станції'});
    stationCodes.add(code);
    if (type && !keys.has(type)) errors.push({sheet:'DICT_STATIONS',row,message:'Невідомий тип станції: '+type});
    if (!type) warnings.push({sheet:'DICT_STATIONS',row,message:'Не визначено ключ моделі: потрібне явне зіставлення'});
  });
  return {valid:errors.length===0,counts:{types:types.length,bands:bands.length,stations:stations.length},errors,warnings};
}
