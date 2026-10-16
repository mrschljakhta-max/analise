-- ANALISE: separate UAV model directory. Migration is additive, no model rows are seeded.
-- Frequency data must be entered and verified explicitly; historic PDF values are not imported.
-- No location, deployment, jamming, targeting, or live control data is stored.
CREATE TABLE IF NOT EXISTS uav_models (
 id TEXT PRIMARY KEY,
 code TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 normalized_name TEXT NOT NULL,
 airframe TEXT NOT NULL CHECK(airframe IN ('wing','multirotor')),
 subtype TEXT NOT NULL DEFAULT '' CHECK(
  (airframe='wing' AND subtype='')
  OR (airframe='multirotor' AND subtype IN ('quadcopter','fpv'))
 ),
 entry_kind TEXT NOT NULL DEFAULT 'model' CHECK(entry_kind IN ('model','generic')),
 country TEXT NOT NULL DEFAULT '',
 manufacturer TEXT NOT NULL DEFAULT '',
 purpose TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS uav_models_classification ON uav_models(airframe,subtype,is_active);

CREATE TABLE IF NOT EXISTS uav_frequency_profiles (
 id TEXT PRIMARY KEY,
 uav_id TEXT NOT NULL REFERENCES uav_models(id),
 channel_kind TEXT NOT NULL CHECK(channel_kind IN ('control','telemetry','navigation','video','backup_video','other')),
 freq_min_mhz REAL NOT NULL CHECK(freq_min_mhz>0 AND freq_min_mhz<=100000),
 freq_max_mhz REAL NOT NULL CHECK(freq_max_mhz>=freq_min_mhz AND freq_max_mhz<=100000),
 bandwidth_mhz REAL CHECK(bandwidth_mhz IS NULL OR (bandwidth_mhz>0 AND bandwidth_mhz<=100000)),
 modulation TEXT NOT NULL DEFAULT '',
 source_label TEXT NOT NULL DEFAULT '',
 verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','verified','reference')),
 note TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS uav_frequency_profiles_model ON uav_frequency_profiles(uav_id);

CREATE TABLE IF NOT EXISTS uav_materials (
 id TEXT PRIMARY KEY,
 uav_id TEXT NOT NULL REFERENCES uav_models(id),
 title TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('image','document','link')),
 url TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS uav_materials_model ON uav_materials(uav_id);

CREATE TABLE IF NOT EXISTS uav_catalog_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 uav_id TEXT NOT NULL,
 uav_code TEXT NOT NULL,
 section TEXT NOT NULL CHECK(section IN ('general','frequencies','materials')),
 action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')),
 old_json TEXT,
 new_json TEXT,
 changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS uav_catalog_audit_lookup ON uav_catalog_audit(uav_code,id DESC);

-- SQLite triggers run atomically with writes, including edits through other clients.
CREATE TRIGGER IF NOT EXISTS uav_model_audit_insert AFTER INSERT ON uav_models BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.id,NEW.code,'general','created',NULL,json_object('name',NEW.name,'airframe',NEW.airframe,'subtype',NEW.subtype,'entry_kind',NEW.entry_kind,'country',NEW.country,'manufacturer',NEW.manufacturer,'purpose',NEW.purpose,'note',NEW.note,'is_active',NEW.is_active));
END;
CREATE TRIGGER IF NOT EXISTS uav_model_audit_update AFTER UPDATE OF name,airframe,subtype,entry_kind,country,manufacturer,purpose,note,is_active ON uav_models
 FOR EACH ROW WHEN OLD.name IS NOT NEW.name OR OLD.airframe IS NOT NEW.airframe OR OLD.subtype IS NOT NEW.subtype OR OLD.entry_kind IS NOT NEW.entry_kind OR OLD.country IS NOT NEW.country OR OLD.manufacturer IS NOT NEW.manufacturer OR OLD.purpose IS NOT NEW.purpose OR OLD.note IS NOT NEW.note OR OLD.is_active IS NOT NEW.is_active BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.id,NEW.code,'general','updated',json_object('name',OLD.name,'airframe',OLD.airframe,'subtype',OLD.subtype,'entry_kind',OLD.entry_kind,'country',OLD.country,'manufacturer',OLD.manufacturer,'purpose',OLD.purpose,'note',OLD.note,'is_active',OLD.is_active),json_object('name',NEW.name,'airframe',NEW.airframe,'subtype',NEW.subtype,'entry_kind',NEW.entry_kind,'country',NEW.country,'manufacturer',NEW.manufacturer,'purpose',NEW.purpose,'note',NEW.note,'is_active',NEW.is_active));
END;

CREATE TRIGGER IF NOT EXISTS uav_frequency_audit_insert AFTER INSERT ON uav_frequency_profiles BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.uav_id,(SELECT code FROM uav_models WHERE id=NEW.uav_id),'frequencies','created',NULL,json_object('channel_kind',NEW.channel_kind,'freq_min_mhz',NEW.freq_min_mhz,'freq_max_mhz',NEW.freq_max_mhz,'bandwidth_mhz',NEW.bandwidth_mhz,'modulation',NEW.modulation,'source_label',NEW.source_label,'verification_status',NEW.verification_status,'note',NEW.note));
END;
CREATE TRIGGER IF NOT EXISTS uav_frequency_audit_update AFTER UPDATE OF channel_kind,freq_min_mhz,freq_max_mhz,bandwidth_mhz,modulation,source_label,verification_status,note ON uav_frequency_profiles
 FOR EACH ROW WHEN OLD.channel_kind IS NOT NEW.channel_kind OR OLD.freq_min_mhz IS NOT NEW.freq_min_mhz OR OLD.freq_max_mhz IS NOT NEW.freq_max_mhz OR OLD.bandwidth_mhz IS NOT NEW.bandwidth_mhz OR OLD.modulation IS NOT NEW.modulation OR OLD.source_label IS NOT NEW.source_label OR OLD.verification_status IS NOT NEW.verification_status OR OLD.note IS NOT NEW.note BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.uav_id,(SELECT code FROM uav_models WHERE id=NEW.uav_id),'frequencies','updated',json_object('channel_kind',OLD.channel_kind,'freq_min_mhz',OLD.freq_min_mhz,'freq_max_mhz',OLD.freq_max_mhz,'bandwidth_mhz',OLD.bandwidth_mhz,'modulation',OLD.modulation,'source_label',OLD.source_label,'verification_status',OLD.verification_status,'note',OLD.note),json_object('channel_kind',NEW.channel_kind,'freq_min_mhz',NEW.freq_min_mhz,'freq_max_mhz',NEW.freq_max_mhz,'bandwidth_mhz',NEW.bandwidth_mhz,'modulation',NEW.modulation,'source_label',NEW.source_label,'verification_status',NEW.verification_status,'note',NEW.note));
END;
CREATE TRIGGER IF NOT EXISTS uav_frequency_audit_delete AFTER DELETE ON uav_frequency_profiles BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(OLD.uav_id,(SELECT code FROM uav_models WHERE id=OLD.uav_id),'frequencies','deleted',json_object('channel_kind',OLD.channel_kind,'freq_min_mhz',OLD.freq_min_mhz,'freq_max_mhz',OLD.freq_max_mhz,'bandwidth_mhz',OLD.bandwidth_mhz,'modulation',OLD.modulation,'source_label',OLD.source_label,'verification_status',OLD.verification_status,'note',OLD.note),NULL);
END;

CREATE TRIGGER IF NOT EXISTS uav_material_audit_insert AFTER INSERT ON uav_materials BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.uav_id,(SELECT code FROM uav_models WHERE id=NEW.uav_id),'materials','created',NULL,json_object('title',NEW.title,'kind',NEW.kind,'url',NEW.url,'note',NEW.note));
END;
CREATE TRIGGER IF NOT EXISTS uav_material_audit_update AFTER UPDATE OF title,kind,url,note ON uav_materials
 FOR EACH ROW WHEN OLD.title IS NOT NEW.title OR OLD.kind IS NOT NEW.kind OR OLD.url IS NOT NEW.url OR OLD.note IS NOT NEW.note BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.uav_id,(SELECT code FROM uav_models WHERE id=NEW.uav_id),'materials','updated',json_object('title',OLD.title,'kind',OLD.kind,'url',OLD.url,'note',OLD.note),json_object('title',NEW.title,'kind',NEW.kind,'url',NEW.url,'note',NEW.note));
END;
CREATE TRIGGER IF NOT EXISTS uav_material_audit_delete AFTER DELETE ON uav_materials BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(OLD.uav_id,(SELECT code FROM uav_models WHERE id=OLD.uav_id),'materials','deleted',json_object('title',OLD.title,'kind',OLD.kind,'url',OLD.url,'note',OLD.note),NULL);
END;

