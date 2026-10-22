-- 002_triggers.sql
-- Financial ledger append-only and zero-sum balance triggers

CREATE OR REPLACE FUNCTION forbid_postings_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Postings are append-only. UPDATE and DELETE are strictly forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_postings_immutable ON postings;
CREATE TRIGGER trg_postings_immutable
BEFORE UPDATE OR DELETE ON postings
FOR EACH ROW
EXECUTE FUNCTION forbid_postings_mutation();

CREATE OR REPLACE FUNCTION verify_journal_balanced()
RETURNS TRIGGER AS $$
DECLARE
  imbalance RECORD;
BEGIN
  FOR imbalance IN
    SELECT unit, SUM(amount) AS total
    FROM postings
    WHERE journal_id = NEW.id
    GROUP BY unit
    HAVING SUM(amount) <> 0
  LOOP
    RAISE EXCEPTION 'Journal % violates double-entry invariant: unit % sums to % (must be 0)',
      NEW.id, imbalance.unit, imbalance.total;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_balanced ON journals;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
AFTER INSERT ON journals
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION verify_journal_balanced();