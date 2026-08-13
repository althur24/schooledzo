-- Fix seed lock: last_run_at dibuat basi (epoch) supaya run pertama scheduler
-- langsung jalan saat boot, bukan menunggu lock berumur > 9 menit.
UPDATE cron_runs SET last_run_at = '2000-01-01T00:00:00Z' WHERE job = 'notification_jobs';
