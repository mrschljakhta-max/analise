-- ANALISE 0010: distinguish original usage side from one-or-many operating countries.
-- This is administrative metadata; no operational location, live tracking or signal data.
-- Existing legacy uav_models.country is retained unchanged for backward data safety.
ALTER TABLE uav_models ADD COLUMN use_side TEXT NOT NULL DEFAULT '';
ALTER TABLE uav_models ADD COLUMN operating_country_codes TEXT NOT NULL DEFAULT '[]'
 CHECK(json_valid(operating_country_codes) AND json_type(operating_country_codes)='array');

CREATE TABLE IF NOT EXISTS uav_countries (
 code TEXT PRIMARY KEY CHECK(length(code)=2 AND code=upper(code)),
 name_uk TEXT NOT NULL CHECK(length(trim(name_uk))>0),
 is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);

INSERT OR IGNORE INTO uav_countries(code,name_uk) VALUES
('UA','Україна'),
('PL','Польща'),
('RU','Росія'),
('TR','Туреччина'),
('BY','Білорусь'),
('MD','Молдова'),
('RO','Румунія'),
('BG','Болгарія'),
('HU','Угорщина'),
('SK','Словаччина'),
('CZ','Чехія'),
('DE','Німеччина'),
('FR','Франція'),
('GB','Велика Британія'),
('US','США'),
('CA','Канада'),
('IT','Італія'),
('ES','Іспанія'),
('PT','Португалія'),
('NL','Нідерланди'),
('BE','Бельгія'),
('AT','Австрія'),
('CH','Швейцарія'),
('SE','Швеція'),
('NO','Норвегія'),
('FI','Фінляндія'),
('DK','Данія'),
('EE','Естонія'),
('LV','Латвія'),
('LT','Литва'),
('GR','Греція'),
('CY','Кіпр'),
('HR','Хорватія'),
('SI','Словенія'),
('RS','Сербія'),
('BA','Боснія і Герцеговина'),
('ME','Чорногорія'),
('MK','Північна Македонія'),
('AL','Албанія'),
('GE','Грузія'),
('AM','Вірменія'),
('AZ','Азербайджан'),
('KZ','Казахстан'),
('UZ','Узбекистан'),
('KG','Киргизстан'),
('TJ','Таджикистан'),
('TM','Туркменістан'),
('IL','Ізраїль'),
('IR','Іран'),
('IQ','Ірак'),
('SA','Саудівська Аравія'),
('AE','Об''єднані Арабські Емірати'),
('QA','Катар'),
('JO','Йорданія'),
('EG','Єгипет'),
('MA','Марокко'),
('TN','Туніс'),
('CN','Китай'),
('TW','Тайвань'),
('JP','Японія'),
('KR','Південна Корея'),
('KP','Північна Корея'),
('IN','Індія'),
('PK','Пакистан'),
('BD','Бангладеш'),
('ID','Індонезія'),
('MY','Малайзія'),
('SG','Сінгапур'),
('TH','Таїланд'),
('VN','В''єтнам'),
('PH','Філіппіни'),
('AU','Австралія'),
('NZ','Нова Зеландія'),
('BR','Бразилія'),
('AR','Аргентина'),
('CL','Чилі'),
('CO','Колумбія'),
('MX','Мексика'),
('ZA','Південна Африка'),
('NG','Нігерія'),
('KE','Кенія'),
('ET','Ефіопія'),
('SD','Судан'),
('SY','Сирія'),
('LB','Ліван'),
('AF','Афганістан'),
('PE','Перу'),
('VE','Венесуела'),
('CU','Куба'),
('MN','Монголія');

-- The original DICT_UAV supplies exactly one populated "Сторона": Lancet -> "Ворог".
-- No countries of use are inferred from name, manufacturer or country of origin.
CREATE TRIGGER IF NOT EXISTS uav_model_operating_audit_insert
AFTER INSERT ON uav_models
FOR EACH ROW WHEN NEW.use_side<>'' OR NEW.operating_country_codes<>'[]'
BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.id,NEW.code,'general','updated',
 json_object('use_side','','operating_countries','[]'),
 json_object('use_side',NEW.use_side,'operating_countries',NEW.operating_country_codes));
END;

CREATE TRIGGER IF NOT EXISTS uav_model_operating_audit_update
AFTER UPDATE OF use_side,operating_country_codes ON uav_models
FOR EACH ROW WHEN OLD.use_side IS NOT NEW.use_side
  OR OLD.operating_country_codes IS NOT NEW.operating_country_codes
BEGIN
 INSERT INTO uav_catalog_audit(uav_id,uav_code,section,action,old_json,new_json)
 VALUES(NEW.id,NEW.code,'general','updated',
 json_object('use_side',OLD.use_side,'operating_countries',OLD.operating_country_codes),
 json_object('use_side',NEW.use_side,'operating_countries',NEW.operating_country_codes));
END;

-- One safely-grounded backfill from the provided workbook. Does not touch other UAV rows.
UPDATE uav_models SET use_side='Ворог',version=version+1,updated_at=CURRENT_TIMESTAMP
 WHERE code='UAV-0001' AND use_side='';
