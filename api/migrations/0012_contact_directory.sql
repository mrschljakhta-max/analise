-- ANALISE private contact directory. No real contact records are seeded.
-- Phone numbers, email and DELTA account *identifiers* are personal data.
-- All routes are admin-only, protected by Cloudflare Access.
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
  normalized_name TEXT NOT NULL CHECK(length(normalized_name) BETWEEN 1 AND 160),
  aliases TEXT NOT NULL DEFAULT '' CHECK(length(aliases)<=500),
  group_label TEXT NOT NULL CHECK(length(trim(group_label)) BETWEEN 1 AND 100),
  group_key TEXT NOT NULL CHECK(length(trim(group_key)) BETWEEN 1 AND 100),
  phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 24),
  whatsapp TEXT NOT NULL DEFAULT 'unknown' CHECK(whatsapp IN ('yes','no','unknown')),
  signal TEXT NOT NULL DEFAULT 'unknown' CHECK(signal IN ('yes','no','unknown')),
  delta_account TEXT NOT NULL DEFAULT '' CHECK(length(delta_account) <= 160),
  email TEXT NOT NULL DEFAULT '' CHECK(length(email) <= 254),
  direction TEXT NOT NULL DEFAULT '' CHECK(length(direction) <= 120),
  unit_name TEXT NOT NULL DEFAULT '' CHECK(length(unit_name) <= 160),
  duty_role TEXT NOT NULL DEFAULT '' CHECK(length(duty_role) <= 160),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1200),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK(verification_status IN ('unverified','verified','conflict')),
  source_label TEXT NOT NULL DEFAULT '' CHECK(length(source_label) <= 180),
  verified_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_key,normalized_name)
);
CREATE INDEX IF NOT EXISTS contacts_by_group ON contacts(group_key,name);
CREATE INDEX IF NOT EXISTS contacts_by_verification ON contacts(verification_status,is_active);

CREATE TABLE IF NOT EXISTS contact_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_code TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created','updated')),
  actor_id TEXT,
  before_json TEXT,
  after_json TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS contact_audit_by_contact ON contact_audit(contact_code,id DESC);

CREATE TRIGGER IF NOT EXISTS contact_audit_insert
AFTER INSERT ON contacts
BEGIN
 INSERT INTO contact_audit(contact_code,action,actor_id,before_json,after_json)
 VALUES (NEW.code,'created',NEW.created_by,NULL,
  json_object(
   'name',NEW.name,'aliases',NEW.aliases,'group_label',NEW.group_label,'phone',NEW.phone,
   'whatsapp',NEW.whatsapp,'signal',NEW.signal,
   'delta_account',NEW.delta_account,'email',NEW.email,
   'direction',NEW.direction,'unit_name',NEW.unit_name,
   'duty_role',NEW.duty_role,'note',NEW.note,
   'verification_status',NEW.verification_status,
   'source_label',NEW.source_label,'verified_at',NEW.verified_at,'is_active',NEW.is_active
  )
 );
END;

CREATE TRIGGER IF NOT EXISTS contact_audit_update
AFTER UPDATE ON contacts
WHEN
 OLD.name IS NOT NEW.name OR OLD.aliases IS NOT NEW.aliases OR OLD.group_label IS NOT NEW.group_label OR
 OLD.phone IS NOT NEW.phone OR OLD.whatsapp IS NOT NEW.whatsapp OR
 OLD.signal IS NOT NEW.signal OR OLD.delta_account IS NOT NEW.delta_account OR
 OLD.email IS NOT NEW.email OR OLD.direction IS NOT NEW.direction OR
 OLD.unit_name IS NOT NEW.unit_name OR OLD.duty_role IS NOT NEW.duty_role OR
 OLD.note IS NOT NEW.note OR OLD.verification_status IS NOT NEW.verification_status OR
 OLD.source_label IS NOT NEW.source_label OR OLD.verified_at IS NOT NEW.verified_at OR OLD.is_active IS NOT NEW.is_active
BEGIN
 INSERT INTO contact_audit(contact_code,action,actor_id,before_json,after_json)
 VALUES (NEW.code,'updated',NEW.updated_by,
  json_object(
   'name',OLD.name,'aliases',OLD.aliases,'group_label',OLD.group_label,'phone',OLD.phone,
   'whatsapp',OLD.whatsapp,'signal',OLD.signal,
   'delta_account',OLD.delta_account,'email',OLD.email,
   'direction',OLD.direction,'unit_name',OLD.unit_name,
   'duty_role',OLD.duty_role,'note',OLD.note,
   'verification_status',OLD.verification_status,
   'source_label',OLD.source_label,'verified_at',OLD.verified_at,'is_active',OLD.is_active
  ),
  json_object(
   'name',NEW.name,'aliases',NEW.aliases,'group_label',NEW.group_label,'phone',NEW.phone,
   'whatsapp',NEW.whatsapp,'signal',NEW.signal,
   'delta_account',NEW.delta_account,'email',NEW.email,
   'direction',NEW.direction,'unit_name',NEW.unit_name,
   'duty_role',NEW.duty_role,'note',NEW.note,
   'verification_status',NEW.verification_status,
   'source_label',NEW.source_label,'verified_at',NEW.verified_at,'is_active',NEW.is_active
  )
 );
END;
