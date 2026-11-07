-- ============================================================================
--  Safe Home Network — Blog CMS, Pages & Publishing upgrade
--  IDEMPOTENT / phpMyAdmin edition (generated — do not edit by hand)
-- ----------------------------------------------------------------------------
--  Generated from 2026-11-blog-cms-upgrade.sql by
--    node scripts/generate-migration-idempotent.mjs
--
--  Use this file when:
--    · your host's phpMyAdmin rejects the DELIMITER directive in the original
--      migration ("syntax error near DELIMITER"), or
--    · the migration was interrupted and you saw
--         #1054 Unknown column 'seo_title' in 'INSERT INTO'
--      while importing blog-content-import.sql.
--
--  It contains no procedures and no DELIMITER lines — just plain statements.
--  Every ALTER is guarded by an information_schema check, so the file is safe to
--  run as many times as you like and will not raise #1060 Duplicate column.
--
--  Run:  phpMyAdmin → select the database → SQL tab → paste this file → Go
--    or: mysql -u user -p dbname < 2026-11-blog-cms-upgrade-idempotent.sql
--
--  When it finishes you should see the verification row
--  "blog cms migration applied | 1 | 1 | 2".
-- ============================================================================

SET NAMES utf8mb4;

/* ---------------------------------------------------------------------------
   1. blog_posts — editor fields
   --------------------------------------------------------------------------- */

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'seo_summary') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `seo_summary` VARCHAR(500) NULL AFTER `seo_description`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'focus_keyword') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `focus_keyword` VARCHAR(160) NULL AFTER `seo_summary`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'secondary_keywords') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `secondary_keywords` VARCHAR(500) NULL AFTER `focus_keyword`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'canonical_url') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `canonical_url` VARCHAR(500) NULL AFTER `secondary_keywords`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'noindex') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `noindex` TINYINT(1) NOT NULL DEFAULT 0 AFTER `canonical_url`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'social_image') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `social_image` VARCHAR(255) NULL AFTER `noindex`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'scheduled_at') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `scheduled_at` DATETIME NULL DEFAULT NULL AFTER `published_at`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'updated_by') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `updated_by` INT UNSIGNED NULL AFTER `updated_at`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'view_count') = 0, 'ALTER TABLE `blog_posts` ADD COLUMN `view_count` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `social_image`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND INDEX_NAME = 'idx_blog_posts_scheduled') = 0, 'ALTER TABLE `blog_posts` ADD KEY `idx_blog_posts_scheduled` (`status`, `scheduled_at`)', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND INDEX_NAME = 'idx_blog_posts_focus') = 0, 'ALTER TABLE `blog_posts` ADD KEY `idx_blog_posts_focus` (`focus_keyword`)', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

/* ---------------------------------------------------------------------------
   2. blog_categories — SEO + ordering
   --------------------------------------------------------------------------- */

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_categories' AND COLUMN_NAME = 'seo_title') = 0, 'ALTER TABLE `blog_categories` ADD COLUMN `seo_title` VARCHAR(200) NULL AFTER `description`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_categories' AND COLUMN_NAME = 'seo_description') = 0, 'ALTER TABLE `blog_categories` ADD COLUMN `seo_description` VARCHAR(320) NULL AFTER `seo_title`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_categories' AND COLUMN_NAME = 'sort_order') = 0, 'ALTER TABLE `blog_categories` ADD COLUMN `sort_order` SMALLINT NOT NULL DEFAULT 0 AFTER `seo_description`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_categories' AND COLUMN_NAME = 'noindex') = 0, 'ALTER TABLE `blog_categories` ADD COLUMN `noindex` TINYINT(1) NOT NULL DEFAULT 0 AFTER `sort_order`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

/* ---------------------------------------------------------------------------
   3. pages — page builder fields
   --------------------------------------------------------------------------- */

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'focus_keyword') = 0, 'ALTER TABLE `pages` ADD COLUMN `focus_keyword` VARCHAR(160) NULL AFTER `seo_description`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'secondary_keywords') = 0, 'ALTER TABLE `pages` ADD COLUMN `secondary_keywords` VARCHAR(500) NULL AFTER `focus_keyword`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'canonical_url') = 0, 'ALTER TABLE `pages` ADD COLUMN `canonical_url` VARCHAR(500) NULL AFTER `secondary_keywords`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'noindex') = 0, 'ALTER TABLE `pages` ADD COLUMN `noindex` TINYINT(1) NOT NULL DEFAULT 0 AFTER `canonical_url`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'og_image') = 0, 'ALTER TABLE `pages` ADD COLUMN `og_image` VARCHAR(255) NULL AFTER `noindex`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'page_group') = 0, 'ALTER TABLE `pages` ADD COLUMN `page_group` VARCHAR(80) NULL AFTER `og_image`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'sort_order') = 0, 'ALTER TABLE `pages` ADD COLUMN `sort_order` SMALLINT NOT NULL DEFAULT 0 AFTER `page_group`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'scheduled_at') = 0, 'ALTER TABLE `pages` ADD COLUMN `scheduled_at` DATETIME NULL DEFAULT NULL AFTER `published_at`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND INDEX_NAME = 'idx_pages_scheduled') = 0, 'ALTER TABLE `pages` ADD KEY `idx_pages_scheduled` (`status`, `scheduled_at`)', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND INDEX_NAME = 'idx_pages_group') = 0, 'ALTER TABLE `pages` ADD KEY `idx_pages_group` (`page_group`, `sort_order`)', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

/* ---------------------------------------------------------------------------
   4. blog_post_metadata — per-post editorial extras (key/value)
      Used for search intent, target audience, CTA target, internal links and
      any future field that should not need another migration.
   --------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS `blog_post_metadata` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id`    INT UNSIGNED NOT NULL,
  `meta_key`   VARCHAR(80)  NOT NULL,
  `meta_value` TEXT         NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_post_meta` (`post_id`, `meta_key`),
  KEY `idx_post_meta_key` (`meta_key`),
  CONSTRAINT `fk_post_meta_post` FOREIGN KEY (`post_id`) REFERENCES `blog_posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------------------------------------------------------------------------
   5. publishing_log — what the scheduler did and when
   --------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS `publishing_log` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_type`  ENUM('post','page') NOT NULL,
  `entity_id`    INT UNSIGNED NOT NULL,
  `action`       ENUM('scheduled','published','unpublished','failed','skipped') NOT NULL,
  `scheduled_for` DATETIME NULL DEFAULT NULL,
  `executed_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor`        VARCHAR(60)  NOT NULL DEFAULT 'cron',
  `message`      VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_publishing_entity` (`entity_type`, `entity_id`),
  KEY `idx_publishing_action` (`action`, `executed_at`),
  -- Duplicate publishing is prevented by the status guard on the UPDATE that
  -- performs the publish (see api/cron/publish-scheduled.php), not by an index:
  -- a post may legitimately be published again after being unscheduled.
  KEY `idx_publishing_executed` (`executed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

/* ---------------------------------------------------------------------------
   6. media — kind, plus a place to record generated/illustrated assets
   --------------------------------------------------------------------------- */

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media' AND COLUMN_NAME = 'kind') = 0, 'ALTER TABLE `media` ADD COLUMN `kind` VARCHAR(20) NOT NULL DEFAULT ''image'' AFTER `mime_type`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media' AND COLUMN_NAME = 'description') = 0, 'ALTER TABLE `media` ADD COLUMN `description` VARCHAR(300) NULL AFTER `alt_text`', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media' AND INDEX_NAME = 'idx_media_kind') = 0, 'ALTER TABLE `media` ADD KEY `idx_media_kind` (`kind`)', 'DO 0');
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

/* ---------------------------------------------------------------------------
   7. Backfill: existing scheduled rows used published_at as the schedule time.
      Mirror it into scheduled_at so both editor and cron agree, once.
   --------------------------------------------------------------------------- */

UPDATE `blog_posts`
   SET `scheduled_at` = `published_at`
 WHERE `status` = 'scheduled'
   AND `scheduled_at` IS NULL
   AND `published_at` IS NOT NULL;

UPDATE `pages`
   SET `scheduled_at` = `published_at`
 WHERE `status` = 'scheduled'
   AND `scheduled_at` IS NULL
   AND `published_at` IS NOT NULL;

/* ---------------------------------------------------------------------------
   8. Done — verify
   --------------------------------------------------------------------------- */


SELECT 'blog cms migration applied' AS status,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'scheduled_at') AS posts_have_scheduled_at,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'scheduled_at') AS pages_have_scheduled_at,
       (SELECT COUNT(*) FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('blog_post_metadata','publishing_log')) AS new_tables;
