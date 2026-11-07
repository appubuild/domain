-- ============================================================================
--  Safe Home Network — SAMPLE ANALYTICS DATA  (preview / demo only)
-- ----------------------------------------------------------------------------
--  WHAT THIS FILE DOES
--    Inserts ~30 days of realistic-looking traffic, call clicks, leads,
--    connected calls and revenue so the admin panel can be previewed with
--    populated charts instead of empty states.
--
--    The numbers are INVENTED. They are not measurements. Every row is tagged
--    so it can be found and removed in one command:
--        analytics_events  -> visitor_id / session_id start with 'demo0000' / 'sess0000'
--        leads             -> reference starts with 'SMPL-', email @example.com
--        call_records      -> external_call_id starts with 'sample-call-'
--        revenue_records   -> source = 'SAMPLE-PREVIEW'
--
--  REMOVE IT BEFORE LAUNCH
--    Run api/database/sample-analytics-remove.sql (same folder) when the
--    preview is over. It deletes exactly the tagged rows and rebuilds the
--    daily rollup, so the panel goes back to real data only.
--
--  REQUIREMENTS
--    * MySQL 8+ / MariaDB 10.3+ (phpMyAdmin import is fine)
--    * `services` and `phone_numbers` must already be seeded (schema.sql +
--      seed.sql), because sample events reference them by foreign key.
--    * Import through phpMyAdmin -> your database -> Import -> this file.
--
--  NOTE ON EXISTING DATA
--    Real events are left untouched; sample rows are added on top of them.
--    Dashboard totals therefore include the sample rows until you run the
--    removal script.
-- ============================================================================

SET NAMES utf8mb4;

/* ---------------------------------------------------------------------------
   0. Helper tables (temporary — dropped automatically when the session ends)
   --------------------------------------------------------------------------- */

DROP TEMPORARY TABLE IF EXISTS tmp_n;
CREATE TEMPORARY TABLE tmp_n (n INT UNSIGNED NOT NULL PRIMARY KEY);
INSERT INTO tmp_n (n)
SELECT a.d + b.d * 10 + c.d * 100
  FROM (SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
        UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
        UNION ALL SELECT 8 UNION ALL SELECT 9) a
 CROSS JOIN (SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
        UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
        UNION ALL SELECT 8 UNION ALL SELECT 9) b
 CROSS JOIN (SELECT 0 AS d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
        UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7
        UNION ALL SELECT 8 UNION ALL SELECT 9) c
 WHERE a.d + b.d * 10 + c.d * 100 < 400;

/* One row per day: off = days ago (29 = oldest, 0 = today).
   views / visitors / sclicks / cclicks / leads are the targets for that day. */
DROP TEMPORARY TABLE IF EXISTS tmp_day;
CREATE TEMPORARY TABLE tmp_day (
  off      INT UNSIGNED NOT NULL PRIMARY KEY,
  d        DATE         NOT NULL,
  views    INT UNSIGNED NOT NULL,
  visitors INT UNSIGNED NOT NULL,
  sclicks  INT UNSIGNED NOT NULL,
  cclicks  INT UNSIGNED NOT NULL,
  leads    INT UNSIGNED NOT NULL
);
INSERT INTO tmp_day (off, d, views, visitors, sclicks, cclicks, leads) VALUES
 (29, DATE_SUB(CURDATE(), INTERVAL 29 DAY),  34, 22,  8,  2, 0),
 (28, DATE_SUB(CURDATE(), INTERVAL 28 DAY),  41, 26, 10,  3, 0),
 (27, DATE_SUB(CURDATE(), INTERVAL 27 DAY),  38, 25,  9,  2, 1),
 (26, DATE_SUB(CURDATE(), INTERVAL 26 DAY),  46, 28, 12,  3, 0),
 (25, DATE_SUB(CURDATE(), INTERVAL 25 DAY),  52, 31, 13,  4, 0),
 (24, DATE_SUB(CURDATE(), INTERVAL 24 DAY),  44, 27, 10,  3, 1),
 (23, DATE_SUB(CURDATE(), INTERVAL 23 DAY),  58, 34, 15,  4, 0),
 (22, DATE_SUB(CURDATE(), INTERVAL 22 DAY),  63, 37, 16,  5, 0),
 (21, DATE_SUB(CURDATE(), INTERVAL 21 DAY),  61, 35, 15,  4, 1),
 (20, DATE_SUB(CURDATE(), INTERVAL 20 DAY),  70, 40, 18,  5, 0),
 (19, DATE_SUB(CURDATE(), INTERVAL 19 DAY),  76, 43, 19,  6, 0),
 (18, DATE_SUB(CURDATE(), INTERVAL 18 DAY),  68, 39, 17,  5, 1),
 (17, DATE_SUB(CURDATE(), INTERVAL 17 DAY),  82, 46, 21,  6, 0),
 (16, DATE_SUB(CURDATE(), INTERVAL 16 DAY),  88, 49, 22,  7, 0),
 (15, DATE_SUB(CURDATE(), INTERVAL 15 DAY),  91, 51, 23,  7, 1),
 (14, DATE_SUB(CURDATE(), INTERVAL 14 DAY),  84, 47, 21,  6, 0),
 (13, DATE_SUB(CURDATE(), INTERVAL 13 DAY),  97, 54, 25,  8, 0),
 (12, DATE_SUB(CURDATE(), INTERVAL 12 DAY), 104, 57, 26,  8, 1),
 (11, DATE_SUB(CURDATE(), INTERVAL 11 DAY),  99, 55, 25,  7, 0),
 (10, DATE_SUB(CURDATE(), INTERVAL 10 DAY), 112, 61, 28,  9, 0),
 ( 9, DATE_SUB(CURDATE(), INTERVAL  9 DAY), 118, 64, 30,  9, 1),
 ( 8, DATE_SUB(CURDATE(), INTERVAL  8 DAY), 109, 59, 27,  8, 0),
 ( 7, DATE_SUB(CURDATE(), INTERVAL  7 DAY), 126, 68, 32, 10, 0),
 ( 6, DATE_SUB(CURDATE(), INTERVAL  6 DAY), 133, 71, 33, 10, 1),
 ( 5, DATE_SUB(CURDATE(), INTERVAL  5 DAY), 129, 69, 32, 10, 0),
 ( 4, DATE_SUB(CURDATE(), INTERVAL  4 DAY), 141, 75, 35, 11, 0),
 ( 3, DATE_SUB(CURDATE(), INTERVAL  3 DAY), 148, 78, 37, 11, 1),
 ( 2, DATE_SUB(CURDATE(), INTERVAL  2 DAY), 139, 74, 35, 10, 0),
 ( 1, DATE_SUB(CURDATE(), INTERVAL  1 DAY), 156, 82, 39, 12, 1),
 ( 0, CURDATE(),                              92, 51, 23,  7, 0);

/* Path weights: the site's real routes, repeated to weight the traffic. */
DROP TEMPORARY TABLE IF EXISTS tmp_path;
CREATE TEMPORARY TABLE tmp_path (rn INT UNSIGNED NOT NULL PRIMARY KEY, path VARCHAR(255) NOT NULL);
INSERT INTO tmp_path (rn, path) VALUES
 ( 1, '/'),
 ( 2, '/services'),
 ( 3, '/services/roofing'),
 ( 4, '/services/roofing'),
 ( 5, '/services/plumbing'),
 ( 6, '/services/plumbing'),
 ( 7, '/contact'),
 ( 8, '/'),
 ( 9, '/services'),
 (10, '/services/hvac'),
 (11, '/services/hvac'),
 (12, '/about'),
 (13, '/services/electrical'),
 (14, '/services/roof-repair'),
 (15, '/'),
 (16, '/services'),
 (17, '/services/water-damage'),
 (18, '/services/pest-control'),
 (19, '/service-area'),
 (20, '/'),
 (21, '/services'),
 (22, '/services/locksmith'),
 (23, '/services/window-installation'),
 (24, '/how-it-works');

/* Traffic-source weights (must match the values AnalyticsModel::SOURCES uses). */
DROP TEMPORARY TABLE IF EXISTS tmp_src;
CREATE TEMPORARY TABLE tmp_src (rn INT UNSIGNED NOT NULL PRIMARY KEY, source VARCHAR(60) NOT NULL);
INSERT INTO tmp_src (rn, source) VALUES
 ( 1, 'Organic search'), ( 2, 'Organic search'), ( 3, 'Organic search'), ( 4, 'Organic search'),
 ( 5, 'Organic search'), ( 6, 'Organic search'), ( 7, 'Organic search'), ( 8, 'Organic search'),
 ( 9, 'Direct'),         (10, 'Direct'),         (11, 'Direct'),         (12, 'Direct'),
 (13, 'Direct'),
 (14, 'Social'),         (15, 'Social'),         (16, 'Social'),
 (17, 'Referral'),       (18, 'Referral'),
 (19, 'Paid search'),    (20, 'Paid search');

/* Device weights: mobile-first traffic, as on the real site. */
DROP TEMPORARY TABLE IF EXISTS tmp_dev;
CREATE TEMPORARY TABLE tmp_dev (rn INT UNSIGNED NOT NULL PRIMARY KEY, device_type VARCHAR(10) NOT NULL);
INSERT INTO tmp_dev (rn, device_type) VALUES
 ( 1, 'mobile'), ( 2, 'mobile'), ( 3, 'mobile'), ( 4, 'mobile'), ( 5, 'mobile'),
 ( 6, 'mobile'), ( 7, 'mobile'), ( 8, 'mobile'), ( 9, 'mobile'), (10, 'mobile'),
 (11, 'mobile'), (12, 'mobile'), (13, 'mobile'), (14, 'mobile'),
 (15, 'desktop'), (16, 'desktop'), (17, 'desktop'), (18, 'desktop'),
 (19, 'tablet'),
 (20, 'unknown');

/* First names for the sample leads. */
DROP TEMPORARY TABLE IF EXISTS tmp_name;
CREATE TEMPORARY TABLE tmp_name (rn INT UNSIGNED NOT NULL PRIMARY KEY, full_name VARCHAR(160) NOT NULL);
INSERT INTO tmp_name (rn, full_name) VALUES
 ( 1, 'Dana Whitfield'),  ( 2, 'Marcus Bell'),   ( 3, 'Priya Nair'),
 ( 4, 'Tom Alvarez'),     ( 5, 'Rachel Kim'),    ( 6, 'Derrick Shaw'),
 ( 7, 'Ana Lopez'),       ( 8, 'Kevin Brennan'), ( 9, 'Sofia Rossi'),
 (10, 'Jamal Carter'),    (11, 'Emily Tran'),    (12, 'Robert Hale');

/* Ranked copies of the real published services / numbers, so the sample
   events always point at rows that exist (foreign keys stay valid). */
DROP TEMPORARY TABLE IF EXISTS tmp_svc;
CREATE TEMPORARY TABLE tmp_svc (
  rn INT UNSIGNED NOT NULL PRIMARY KEY,
  id INT UNSIGNED NOT NULL,
  slug VARCHAR(160) NOT NULL,
  name VARCHAR(160) NOT NULL
);
INSERT INTO tmp_svc (rn, id, slug, name)
SELECT (SELECT COUNT(*) FROM services s2 WHERE s2.status = 'published' AND s2.id <= s.id),
       s.id, s.slug, s.name
  FROM services s
 WHERE s.status = 'published';

DROP TEMPORARY TABLE IF EXISTS tmp_num;
CREATE TEMPORARY TABLE tmp_num (rn INT UNSIGNED NOT NULL PRIMARY KEY, id INT UNSIGNED NOT NULL);
INSERT INTO tmp_num (rn, id)
SELECT (SELECT COUNT(*) FROM phone_numbers p2 WHERE p2.deleted_at IS NULL AND p2.id <= p.id), p.id
  FROM phone_numbers p
 WHERE p.deleted_at IS NULL;

SET @path_n := (SELECT COUNT(*) FROM tmp_path);
SET @src_n  := (SELECT COUNT(*) FROM tmp_src);
SET @dev_n  := (SELECT COUNT(*) FROM tmp_dev);
SET @name_n := (SELECT COUNT(*) FROM tmp_name);
SET @svc_n  := (SELECT COUNT(*) FROM tmp_svc);
SET @num_n  := (SELECT COUNT(*) FROM tmp_num);

/* ---------------------------------------------------------------------------
   1. Page views
   --------------------------------------------------------------------------- */

INSERT INTO analytics_events
  (event_type, visitor_id, session_id, path, referrer, source,
   utm_source, utm_medium, utm_campaign, device_type, created_at)
SELECT 'page_view',
       CONCAT('demo0000-0000-4000-8000-', LPAD(t.off * 1000 + MOD(n.n, t.visitors) + 1, 12, '0')),
       CONCAT('sess0000-0000-4000-8000-', LPAD(t.off * 1000 + MOD(n.n, t.visitors) + 1, 12, '0')),
       p.path,
       CASE s.source
         WHEN 'Organic search' THEN 'https://www.google.com/'
         WHEN 'Social'         THEN 'https://www.facebook.com/'
         WHEN 'Referral'       THEN 'https://www.bbb.org/'
         WHEN 'Paid search'    THEN 'https://www.google.com/'
         ELSE NULL
       END,
       s.source,
       CASE s.source WHEN 'Paid search' THEN 'google' WHEN 'Social' THEN 'facebook' ELSE NULL END,
       CASE s.source WHEN 'Paid search' THEN 'cpc'    WHEN 'Social' THEN 'social'   ELSE NULL END,
       CASE s.source WHEN 'Paid search' THEN 'search-brand' WHEN 'Social' THEN 'social-traffic' ELSE NULL END,
       d.device_type,
       TIMESTAMP(t.d) + INTERVAL (CASE
           WHEN t.off = 0 THEN MOD(n.n * 13, GREATEST(HOUR(CURTIME()) * 60 + MINUTE(CURTIME()), 60))
           ELSE MOD(n.n * 37 + t.off * 11, 1320)
         END) MINUTE
  FROM tmp_day t
  JOIN tmp_n    n ON n.n < t.views
  JOIN tmp_path p ON p.rn = MOD(n.n + t.off * 5, @path_n) + 1
  JOIN tmp_src  s ON s.rn = MOD(n.n * 3 + t.off, @src_n) + 1
  JOIN tmp_dev  d ON d.rn = MOD(n.n * 7 + t.off, @dev_n) + 1;

/* ---------------------------------------------------------------------------
   2. Service clicks (visitor tapped a service card)
   --------------------------------------------------------------------------- */

INSERT INTO analytics_events
  (event_type, visitor_id, session_id, path, source, service_id, device_type, created_at)
SELECT 'service_click',
       CONCAT('demo0000-0000-4000-8000-', LPAD(t.off * 1000 + MOD(n.n, t.visitors) + 1, 12, '0')),
       CONCAT('sess0000-0000-4000-8000-', LPAD(t.off * 1000 + MOD(n.n, t.visitors) + 1, 12, '0')),
       CONCAT('/services/', v.slug),
       s.source,
       v.id,
       d.device_type,
       TIMESTAMP(t.d) + INTERVAL (CASE
           WHEN t.off = 0 THEN MOD(n.n * 13, GREATEST(HOUR(CURTIME()) * 60 + MINUTE(CURTIME()), 60))
           ELSE MOD(n.n * 37 + t.off * 11, 1320)
         END) MINUTE
  FROM tmp_day t
  JOIN tmp_n   n ON n.n < t.sclicks
  JOIN tmp_svc v ON v.rn = MOD(n.n * 3 + t.off, @svc_n) + 1
  JOIN tmp_src s ON s.rn = MOD(n.n + t.off, @src_n) + 1
  JOIN tmp_dev d ON d.rn = MOD(n.n * 7 + t.off, @dev_n) + 1;

/* ---------------------------------------------------------------------------
   3. Call clicks ("Call Now" taps) — these are clicks, not conversations
   --------------------------------------------------------------------------- */

INSERT INTO analytics_events
  (event_type, visitor_id, session_id, path, source, service_id, phone_number_id,
   device_type, created_at)
SELECT 'call_click',
       CONCAT('demo0000-0000-4000-8000-', LPAD(t.off * 1000 + MOD(n.n, t.visitors) + 1, 12, '0')),
       CONCAT('sess0000-0000-4000-8000-', LPAD(t.off * 1000 + MOD(n.n, t.visitors) + 1, 12, '0')),
       CONCAT('/services/', v.slug),
       s.source,
       v.id,
       p.id,
       d.device_type,
       TIMESTAMP(t.d) + INTERVAL (CASE
           WHEN t.off = 0 THEN MOD(n.n * 13, GREATEST(HOUR(CURTIME()) * 60 + MINUTE(CURTIME()), 60))
           ELSE MOD(n.n * 37 + t.off * 11, 1320)
         END) MINUTE
  FROM tmp_day t
  JOIN tmp_n   n ON n.n < t.cclicks
  JOIN tmp_svc v ON v.rn = MOD(n.n * 5 + t.off, @svc_n) + 1
  JOIN tmp_num p ON p.rn = MOD(n.n + t.off * 3, @num_n) + 1
  JOIN tmp_src s ON s.rn = MOD(n.n * 3 + t.off, @src_n) + 1
  JOIN tmp_dev d ON d.rn = MOD(n.n * 7 + t.off, @dev_n) + 1;

/* ---------------------------------------------------------------------------
   4. Leads (visible in Leads & Support — references are prefixed SMPL-)
   --------------------------------------------------------------------------- */

INSERT INTO leads
  (reference, type, name, email, phone, service, subject, message,
   status, priority, source, consent, user_agent, created_at, updated_at)
SELECT CONCAT('SMPL-', LPAD(t.off * 100 + n.n + 1, 4, '0')),
       CASE WHEN MOD(n.n + t.off, 6) = 0 THEN 'support' ELSE 'lead' END,
       nm.full_name,
       CONCAT('sample', LPAD(t.off * 100 + n.n + 1, 4, '0'), '@example.com'),
       CONCAT('(512) 555-', LPAD(MOD(n.n * 137 + t.off * 29, 10000), 4, '0')),
       v.name,
       CASE WHEN MOD(n.n + t.off, 6) = 0 THEN CONCAT('Question about ', v.name) ELSE NULL END,
       CONCAT('Sample preview lead — looking for help with ', v.name,
              ' in ', st.code, '. This row was created by sample-analytics.sql and can be deleted with sample-analytics-remove.sql.'),
       CASE MOD(n.n + t.off, 4) WHEN 0 THEN 'new' WHEN 1 THEN 'contacted'
                                 WHEN 2 THEN 'qualified' ELSE 'closed' END,
       CASE MOD(n.n + t.off, 3) WHEN 0 THEN 'normal' WHEN 1 THEN 'high' ELSE 'low' END,
       s.source,
       1,
       'Sample preview data',
       TIMESTAMP(t.d) + INTERVAL (CASE
           WHEN t.off = 0 THEN MOD(n.n * 13, GREATEST(HOUR(CURTIME()) * 60 + MINUTE(CURTIME()), 60))
           ELSE MOD(n.n * 37 + t.off * 11, 1320)
         END) MINUTE,
       TIMESTAMP(t.d) + INTERVAL (CASE
           WHEN t.off = 0 THEN MOD(n.n * 13, GREATEST(HOUR(CURTIME()) * 60 + MINUTE(CURTIME()), 60))
           ELSE MOD(n.n * 37 + t.off * 11, 1320)
         END) MINUTE
  FROM tmp_day t
  JOIN tmp_n    n  ON n.n < t.leads
  JOIN tmp_svc  v  ON v.rn = MOD(n.n * 3 + t.off, @svc_n) + 1
  JOIN tmp_name nm ON nm.rn = MOD(n.n * 5 + t.off, @name_n) + 1
  JOIN tmp_src  s  ON s.rn = MOD(n.n + t.off, @src_n) + 1
  JOIN (SELECT 0 AS o, 'TX' AS code
        UNION ALL SELECT 1, 'FL' UNION ALL SELECT 2, 'OH' UNION ALL SELECT 3, 'PA'
        UNION ALL SELECT 4, 'NC' UNION ALL SELECT 5, 'GA' UNION ALL SELECT 6, 'MI'
        UNION ALL SELECT 7, 'TN' UNION ALL SELECT 8, 'IN' UNION ALL SELECT 9, 'MO') st
    ON st.o = MOD(n.n + t.off, 10);

/* ---------------------------------------------------------------------------
   5. Connected calls — what a call-tracking network would report.
      Roughly one in three call clicks ends in a connected conversation.
   --------------------------------------------------------------------------- */

INSERT INTO call_records
  (external_call_id, phone_number_id, service_id, network, campaign, caller_state,
   started_at, duration_seconds, connected, revenue, verified, created_at)
SELECT CONCAT('sample-call-', t.off, '-', n.n),
       p.id,
       v.id,
       'Sample Tracking Network',
       'sample-campaign',
       st.code,
       TIMESTAMP(t.d) + INTERVAL (CASE
           WHEN t.off = 0 THEN MOD(n.n * 13, GREATEST(HOUR(CURTIME()) * 60 + MINUTE(CURTIME()), 60))
           ELSE MOD(n.n * 37 + t.off * 11, 1320)
         END) MINUTE,
       40 + MOD(n.n * 53 + t.off * 17, 300),
       1,
       0.00,
       1,
       TIMESTAMP(t.d)
  FROM tmp_day t
  JOIN tmp_n   n ON n.n < t.cclicks AND MOD(n.n, 3) = 0
  JOIN tmp_svc v ON v.rn = MOD(n.n * 5 + t.off, @svc_n) + 1
  JOIN tmp_num p ON p.rn = MOD(n.n + t.off * 3, @num_n) + 1
  JOIN (SELECT 0 AS o, 'TX' AS code
        UNION ALL SELECT 1, 'FL' UNION ALL SELECT 2, 'OH' UNION ALL SELECT 3, 'PA'
        UNION ALL SELECT 4, 'NC' UNION ALL SELECT 5, 'GA' UNION ALL SELECT 6, 'MI'
        UNION ALL SELECT 7, 'TN' UNION ALL SELECT 8, 'IN' UNION ALL SELECT 9, 'MO') st
    ON st.o = MOD(n.n + t.off, 10);

/* ---------------------------------------------------------------------------
   6. Revenue — OPTIONAL. This section invents money; delete the block (or set
      amounts to 0) if you would rather the revenue card stay at $0.00.
   --------------------------------------------------------------------------- */

INSERT INTO revenue_records
  (source, call_record_id, amount, currency, status, period_start, period_end, notes, created_at)
SELECT 'SAMPLE-PREVIEW', NULL, 96.20, 'USD', 'approved',
       DATE_SUB(CURDATE(), INTERVAL 28 DAY), DATE_SUB(CURDATE(), INTERVAL 22 DAY),
       'Sample preview data — delete before launch', NOW()
UNION ALL
SELECT 'SAMPLE-PREVIEW', NULL, 118.50, 'USD', 'approved',
       DATE_SUB(CURDATE(), INTERVAL 21 DAY), DATE_SUB(CURDATE(), INTERVAL 15 DAY),
       'Sample preview data — delete before launch', NOW()
UNION ALL
SELECT 'SAMPLE-PREVIEW', NULL, 104.75, 'USD', 'paid',
       DATE_SUB(CURDATE(), INTERVAL 14 DAY), DATE_SUB(CURDATE(), INTERVAL  8 DAY),
       'Sample preview data — delete before launch', NOW()
UNION ALL
SELECT 'SAMPLE-PREVIEW', NULL, 88.10, 'USD', 'approved',
       DATE_SUB(CURDATE(), INTERVAL  7 DAY), DATE_SUB(CURDATE(), INTERVAL  1 DAY),
       'Sample preview data — delete before launch', NOW();

/* ---------------------------------------------------------------------------
   7. Rebuild the daily rollup for the last 30 days (same logic as
      AdminAnalyticsController::rebuild).
   --------------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------------
   8. Report what was inserted
   --------------------------------------------------------------------------- */

SELECT 'sample analytics ready' AS status,
       (SELECT COUNT(*) FROM analytics_events WHERE visitor_id LIKE 'demo0000%') AS sample_events,
       (SELECT COUNT(*) FROM leads WHERE reference LIKE 'SMPL-%')              AS sample_leads,
       (SELECT COUNT(*) FROM call_records WHERE external_call_id LIKE 'sample-call-%') AS sample_calls,
       (SELECT COUNT(*) FROM revenue_records WHERE source = 'SAMPLE-PREVIEW')  AS sample_revenue_rows;

DROP TEMPORARY TABLE IF EXISTS tmp_n;
DROP TEMPORARY TABLE IF EXISTS tmp_day;
DROP TEMPORARY TABLE IF EXISTS tmp_path;
DROP TEMPORARY TABLE IF EXISTS tmp_src;
DROP TEMPORARY TABLE IF EXISTS tmp_dev;
DROP TEMPORARY TABLE IF EXISTS tmp_name;
DROP TEMPORARY TABLE IF EXISTS tmp_svc;
DROP TEMPORARY TABLE IF EXISTS tmp_num;
