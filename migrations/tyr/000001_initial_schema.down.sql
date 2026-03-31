-- Rollback initial schema for tyr saga coordinator

DROP TABLE IF EXISTS confidence_events;
DROP TABLE IF EXISTS dispatcher_state;
DROP TABLE IF EXISTS raids;
DROP TABLE IF EXISTS phases;
DROP TABLE IF EXISTS sagas;
