-- walkthru inventory (SPEC 22.3). Idempotent: every statement can run again and changes nothing that is already there.
-- Applied by `npm run db:setup` (scripts/db-setup.ts), which also seeds the sample tower. Postgres (Neon).

-- one row per unit that has a status; a unit with no row simply has no status yet ("Status unavailable" in the viewer)
CREATE TABLE IF NOT EXISTS units (
  building_id text NOT NULL,
  unit_id     text NOT NULL,
  status      text NOT NULL CHECK (status IN ('available', 'sold')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (building_id, unit_id)
);

-- one row per building that has any setting
CREATE TABLE IF NOT EXISTS building_settings (
  building_id   text PRIMARY KEY,
  vastu_enabled boolean NOT NULL DEFAULT false,
  demo          boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- append only: every change of a status is written here and nothing ever updates or deletes a row
CREATE TABLE IF NOT EXISTS units_log (
  building_id text NOT NULL,
  unit_id     text NOT NULL,
  old_status  text,
  new_status  text NOT NULL CHECK (new_status IN ('available', 'sold')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS units_log_unit_idx ON units_log (building_id, unit_id, at);
