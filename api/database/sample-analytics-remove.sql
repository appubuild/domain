-- ============================================================================
--  Safe Home Network — REMOVE SAMPLE ANALYTICS DATA
-- ----------------------------------------------------------------------------
--  Deletes exactly the rows created by api/database/sample-analytics.sql and
--  rebuilds the daily rollup so every number goes back to real, measured data.
--  Real events / leads / calls / revenue are NOT touched.
--
--  Run this before launch, before a client hand-over, or any time you want the
--  admin panel to show only what actually happened.
--
--  Import through phpMyAdmin -> your database -> Import -> this file.
-- ============================================================================

SET NAMES utf8mb4;

/* 1. Sample events (page views, service clicks, call clicks) */
DELETE FROM analytics_events
 WHERE visitor_id LIKE 'demo0000%'
    OR session_id LIKE 'sess0000%';

/* 2. Sample leads (SMPL- references, @example.com addresses) */
DELETE FROM leads
 WHERE reference LIKE 'SMPL-%'
   AND email LIKE '%@example.com';

/* 3. Sample connected calls */
DELETE FROM call_records
 WHERE external_call_id LIKE 'sample-call-%';

/* 4. Sample revenue */
DELETE FROM revenue_records
 WHERE source = 'SAMPLE-PREVIEW';

/* 5. Rebuild the rollup for the last 30 days from whatever real data is left.
      Rollup rows are a cache, never a source of truth, so clearing them for the
      window and regenerating is safe. */
DELETE FROM analytics_daily
 WHERE report_date BETWEEN DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND CURDATE();

INSERT INTO analytics_daily
  (report_date, page_views, unique_visitors, service_clicks, call_clicks, leads,
   connected_calls, revenue)
SELECT d.report_date,
       (SELECT COUNT(*) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'page_view'),
       (SELECT COUNT(DISTINCT e.visitor_id) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'page_view'),
       (SELECT COUNT(*) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'service_click'),
       (SELECT COUNT(*) FROM analytics_events e WHERE DATE(e.created_at) = d.report_date AND e.event_type = 'call_click'),
       (SELECT COUNT(*) FROM leads l WHERE DATE(l.created_at) = d.report_date AND l.deleted_at IS NULL),
       (SELECT COUNT(*) FROM call_records c WHERE DATE(c.started_at) = d.report_date AND c.connected = 1),
       (SELECT COALESCE(SUM(r.amount), 0) FROM revenue_records r
         WHERE r.status IN ('approved','paid') AND r.period_start = d.report_date)
  FROM (SELECT DISTINCT DATE(created_at) AS report_date FROM analytics_events
         WHERE created_at BETWEEN DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND CURDATE() + INTERVAL 1 DAY) d
ON DUPLICATE KEY UPDATE
       page_views      = VALUES(page_views),
       unique_visitors = VALUES(unique_visitors),
       service_clicks  = VALUES(service_clicks),
       call_clicks     = VALUES(call_clicks),
       leads           = VALUES(leads),
       connected_calls = VALUES(connected_calls),
       revenue         = VALUES(revenue);

/* 6. Confirm nothing tagged is left behind */
SELECT 'sample data removed' AS status,
       (SELECT COUNT(*) FROM analytics_events WHERE visitor_id LIKE 'demo0000%') AS sample_events_left,
       (SELECT COUNT(*) FROM leads WHERE reference LIKE 'SMPL-%')              AS sample_leads_left,
       (SELECT COUNT(*) FROM call_records WHERE external_call_id LIKE 'sample-call-%') AS sample_calls_left,
       (SELECT COUNT(*) FROM revenue_records WHERE source = 'SAMPLE-PREVIEW')  AS sample_revenue_left;
