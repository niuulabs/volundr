-- NIU-555: Vaka wakefulness — thread memory table.
--
-- A thread is a Mímir page that represents unfinished business.
-- The Sjón enrichment step populates this table after each ingest;
-- the Vaka tick loop (M2) reads from it ordered by weight descending.

CREATE TABLE IF NOT EXISTS ravn_threads (
    thread_id        TEXT PRIMARY KEY,
    page_path        TEXT NOT NULL,
    title            TEXT NOT NULL DEFAULT '',
    weight           DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    next_action      TEXT NOT NULL DEFAULT '',
    tags             JSONB NOT NULL DEFAULT '[]',
    status           TEXT NOT NULL DEFAULT 'open',
    created_at       TIMESTAMPTZ NOT NULL,
    last_seen_at     TIMESTAMPTZ NOT NULL
);

-- Uniqueness: one open thread per Mímir page path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ravn_threads_page_path
    ON ravn_threads (page_path)
    WHERE status = 'open';

-- Queue scan: open threads ordered by weight descending (Vaka tick loop).
CREATE INDEX IF NOT EXISTS idx_ravn_threads_weight
    ON ravn_threads (weight DESC)
    WHERE status = 'open';
