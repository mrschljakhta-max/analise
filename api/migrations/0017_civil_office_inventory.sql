-- Approved, narrow civilian dataset: office stationery stock counts.
-- Not a generic document/JSON/SQL inbox. Original files, names, notes, coordinates
-- and arbitrary text do not enter this table.
CREATE TABLE IF NOT EXISTS civil_office_imports (
 id TEXT PRIMARY KEY NOT NULL,
 schema_code TEXT NOT NULL DEFAULT 'office_inventory_v1'
   CHECK(schema_code='office_inventory_v1'),
 fingerprint TEXT NOT NULL UNIQUE CHECK(length(fingerprint)=64),
 actor_id TEXT NOT NULL REFERENCES users(id),
 submitted_count INTEGER NOT NULL CHECK(submitted_count BETWEEN 1 AND 100),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_civil_office_imports_recent
 ON civil_office_imports(created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS civil_office_items (
 id TEXT PRIMARY KEY NOT NULL,
 batch_id TEXT NOT NULL REFERENCES civil_office_imports(id),
 item_code TEXT NOT NULL CHECK(item_code IN
  ('paper_a4','pen','pencil','notebook','folder','paperclips','sticky_notes','envelope','glue','marker')),
 stock_date TEXT NOT NULL CHECK(length(stock_date)=10 AND stock_date GLOB '????-??-??'),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 100000),
 unit_price_cents INTEGER CHECK(unit_price_cents IS NULL OR unit_price_cents BETWEEN 0 AND 10000000),
 source_row INTEGER NOT NULL CHECK(source_row BETWEEN 1 AND 15000),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(item_code,stock_date)
);
CREATE INDEX IF NOT EXISTS idx_civil_office_items_date
 ON civil_office_items(stock_date DESC,item_code);

-- Idempotent identical stock-date rows are ignored, but *different* quantities
-- or prices for the same item/date abort the entire D1 transaction.
CREATE TRIGGER IF NOT EXISTS civil_office_reject_conflict
 BEFORE INSERT ON civil_office_items
 WHEN EXISTS (
  SELECT 1 FROM civil_office_items prev
  WHERE prev.item_code=NEW.item_code AND prev.stock_date=NEW.stock_date
    AND (prev.quantity<>NEW.quantity
      OR prev.unit_price_cents IS NOT NEW.unit_price_cents)
 )
 BEGIN SELECT RAISE(ABORT,'OFFICE_ITEM_CONFLICT'); END;

CREATE TABLE IF NOT EXISTS civil_office_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_type TEXT NOT NULL CHECK(event_type IN ('import','item_added')),
 batch_id TEXT NOT NULL REFERENCES civil_office_imports(id),
 item_id TEXT REFERENCES civil_office_items(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_civil_office_audit_batch
 ON civil_office_audit(batch_id,id DESC);

CREATE TRIGGER IF NOT EXISTS civil_office_import_logged
 AFTER INSERT ON civil_office_imports
 BEGIN
  INSERT INTO civil_office_audit(event_type,batch_id,item_id,actor_id)
  VALUES('import',NEW.id,NULL,NEW.actor_id);
 END;

CREATE TRIGGER IF NOT EXISTS civil_office_row_logged
 AFTER INSERT ON civil_office_items
 BEGIN
  INSERT INTO civil_office_audit(event_type,batch_id,item_id,actor_id)
  SELECT 'item_added',NEW.batch_id,NEW.id,actor_id
    FROM civil_office_imports WHERE id=NEW.batch_id;
 END;
