-- Oktober 2026: Gebühren in Prozent, Besichtigungen, feste Partner (Verwaltungen und Makler) mit Portal
-- Nur Ergänzungen: neue Spalten und Tabellen, bestehende Daten bleiben unverändert. Mehrfach ausführbar.

-- Gebühren: 5 % pro Einzelauftrag, Daueraufträge wahlweise ein Monatsumsatz oder 8 % monatlich für 24 Monate
ALTER TABLE vermittlung_betriebe ADD COLUMN IF NOT EXISTS dauer_modell text;
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS dauer_modell text;
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS gebuehr_hand numeric;
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS dauer_ende_am date;
CREATE TABLE IF NOT EXISTS dauer_raten (
  id serial PRIMARY KEY,
  vermittlung_id integer NOT NULL REFERENCES vermittlungen(id) ON DELETE CASCADE,
  nr integer NOT NULL,
  monat text NOT NULL,
  betrag numeric NOT NULL,
  rechnung_id integer REFERENCES rechnungen(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vermittlung_id, nr)
);

-- Feste Partner auf Auftraggeber-Seite: Hausverwaltungen, Immobilienmakler, Gewerbe
CREATE TABLE IF NOT EXISTS kunden (
  id serial PRIMARY KEY,
  name text NOT NULL,
  art text NOT NULL DEFAULT 'verwaltung',
  ansprechpartner text,
  email text,
  telefon text,
  adresse text,
  notizen text,
  kontakt_id integer REFERENCES crm_kontakte(id) ON DELETE SET NULL,
  vereinbarung_am timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kunden_zugaenge (
  id serial PRIMARY KEY,
  kunde_id integer NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  name text,
  email text NOT NULL,
  pw_hash text,
  einlade_token text UNIQUE,
  einlade_bis timestamptz,
  aktiv boolean NOT NULL DEFAULT true,
  letzter_login timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kunden_zugaenge_email_idx ON kunden_zugaenge (lower(email));
CREATE TABLE IF NOT EXISTS kunden_sitzungen (
  token_hash text PRIMARY KEY,
  zugang_id integer NOT NULL REFERENCES kunden_zugaenge(id) ON DELETE CASCADE,
  gueltig_bis timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS objekte (
  id serial PRIMARY KEY,
  kunde_id integer NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  name text NOT NULL,
  adresse text,
  art text NOT NULL DEFAULT 'wohnen',
  einheiten integer,
  vor_ort text,
  notizen text,
  qr_token text UNIQUE DEFAULT ('o_' || replace(gen_random_uuid()::text, '-', '')),
  aktiv boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meldungen (
  id serial PRIMARY KEY,
  kunde_id integer NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  objekt_id integer REFERENCES objekte(id) ON DELETE SET NULL,
  quelle text NOT NULL DEFAULT 'portal',
  name text,
  einheit text,
  kontakt text,
  titel text,
  text text,
  dringend boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'neu',
  vermittlung_id integer REFERENCES vermittlungen(id) ON DELETE SET NULL,
  notiz text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS meldung_fotos (
  id serial PRIMARY KEY,
  meldung_id integer NOT NULL REFERENCES meldungen(id) ON DELETE CASCADE,
  nr smallint NOT NULL,
  mime text NOT NULL,
  daten text NOT NULL,
  bytes integer NOT NULL,
  UNIQUE (meldung_id, nr)
);
CREATE TABLE IF NOT EXISTS fristen (
  id serial PRIMARY KEY,
  kunde_id integer NOT NULL REFERENCES kunden(id) ON DELETE CASCADE,
  objekt_id integer REFERENCES objekte(id) ON DELETE CASCADE,
  art text NOT NULL,
  intervall_monate integer NOT NULL,
  letzter date,
  notiz text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Anfragen wissen, von welchem festen Partner und zu welchem Objekt sie kommen
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS kunde_id integer REFERENCES kunden(id) ON DELETE SET NULL;
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS objekt_id integer REFERENCES objekte(id) ON DELETE SET NULL;

-- Besichtigung bei größeren Aufträgen: Adresse und Ansprechpartner vor Ort erst nach bestätigtem Termin
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS objekt_adresse text;
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS vor_ort text;
ALTER TABLE vermittlungen ADD COLUMN IF NOT EXISTS besichtigung text;
CREATE TABLE IF NOT EXISTS besichtigungen (
  id serial PRIMARY KEY,
  vermittlung_id integer NOT NULL REFERENCES vermittlungen(id) ON DELETE CASCADE,
  vb_id integer NOT NULL UNIQUE REFERENCES vermittlung_betriebe(id) ON DELETE CASCADE,
  wunsch text[] NOT NULL DEFAULT '{}',
  termin text,
  nachricht text,
  status text NOT NULL DEFAULT 'angefragt',
  bedingungen_am timestamptz NOT NULL DEFAULT now(),
  bestaetigt_am timestamptz,
  bestaetigt_von text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
