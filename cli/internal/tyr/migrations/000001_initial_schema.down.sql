-- Rollback initial tyr schema

DROP INDEX IF EXISTS idx_dispatcher_state_owner;
DROP TABLE IF EXISTS dispatcher_state;

DROP INDEX IF EXISTS idx_confidence_events_raid_id;
DROP TABLE IF EXISTS confidence_events;

DROP INDEX IF EXISTS idx_raids_session_id;
DROP INDEX IF EXISTS idx_raids_status;
DROP INDEX IF EXISTS idx_raids_phase_id;
DROP TABLE IF EXISTS raids;

DROP INDEX IF EXISTS idx_phases_saga_id;
DROP TABLE IF EXISTS phases;

DROP INDEX IF EXISTS idx_sagas_owner_id;
DROP TABLE IF EXISTS sagas;
