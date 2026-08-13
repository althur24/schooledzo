-- Lock table untuk scheduler in-process (src/lib/scheduler.ts).
-- Klaim atomik via UPDATE ... WHERE last_run_at < threshold memastikan hanya
-- satu instance/replica yang menjalankan job pada satu waktu.
CREATE TABLE IF NOT EXISTS cron_runs (
    job text PRIMARY KEY,
    last_run_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cron_runs (job) VALUES ('notification_jobs') ON CONFLICT DO NOTHING;
