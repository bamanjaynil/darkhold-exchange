-- 003_batch_trigger_opt.sql
-- Optimize verify_journal_balanced to skip row-by-row queries when batch-validated

CREATE OR REPLACE FUNCTION verify_journal_balanced()
RETURNS TRIGGER AS $$
DECLARE
  imbalance RECORD;
BEGIN
  IF current_setting('darkhold.batch_validated', true) = '1' THEN
    RETURN NEW;
  END IF;

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
