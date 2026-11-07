-- ============================================================================
--  Safe Home Network — Blog CMS, Pages & Publishing upgrade
--  Migration for an EXISTING database (safe to run more than once).
-- ----------------------------------------------------------------------------
--  Adds the fields the new blog editor / page builder / scheduler need:
--    blog_posts      SEO + scheduling + authorship fields
--    blog_categories SEO fields
--    pages           SEO + scheduling + grouping fields
--    blog_post_metadata   per-post editorial extras (search intent, CTA …)
--    publishing_log       audit trail for the scheduled-publish cron
--    media                kind + alt/size metadata for SVG and raster assets
--
--  Nothing is dropped and no existing row is rewritten except the two
--  backfills at the end (scheduled_at is copied from published_at once).
--
--  Run:  phpMyAdmin → select database → Import → this file
--    or: mysql -u user -p dbname < 2026-11-blog-cms-upgrade.sql
-- ============================================================================

SET NAMES utf8mb4;

/* ---------------------------------------------------------------------------
   Helper procedures: add a column / index only when it is missing, so the file
   is idempotent on MySQL 8 (which has no ADD COLUMN IF NOT EXISTS).
   --------------------------------------------------------------------------- */

DROP PROCEDURE IF EXISTS shn_add_column;
DROP PROCEDURE IF EXISTS shn_add_index;

DELIMITER $$

CREATE PROCEDURE shn_add_column(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @shn_sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', ddl);
    PREPARE shn_stmt FROM @shn_sql;
    EXECUTE shn_stmt;
    DEALLOCATE PREPARE shn_stmt;
  END IF;
END$$

CREATE PROCEDURE shn_add_index(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx
  ) THEN
    SET @shn_sql = CONCAT('ALTER TABLE `', tbl, '` ADD ', ddl);
    PREPARE shn_stmt FROM @shn_sql;
    EXECUTE shn_stmt;
    DEALLOCATE PREPARE shn_stmt;
  END IF;
END$$

DELIMITER ;

/* ---------------------------------------------------------------------------
   1. blog_posts — editor fields
   --------------------------------------------------------------------------- */

CALL shn_add_column('blog_posts', 'seo_summary',       'VARCHAR(500) NULL AFTER `seo_description`');
CALL shn_add_column('blog_posts', 'focus_keyword',     'VARCHAR(160) NULL AFTER `seo_summary`');
CALL shn_add_column('blog_posts', 'secondary_keywords','VARCHAR(500) NULL AFTER `focus_keyword`');
CALL shn_add_column('blog_posts', 'canonical_url',     'VARCHAR(500) NULL AFTER `secondary_keywords`');
CALL shn_add_column('blog_posts', 'noindex',           'TINYINT(1) NOT NULL DEFAULT 0 AFTER `canonical_url`');
CALL shn_add_column('blog_posts', 'social_image',      'VARCHAR(255) NULL AFTER `noindex`');
CALL shn_add_column('blog_posts', 'scheduled_at',      'DATETIME NULL DEFAULT NULL AFTER `published_at`');
CALL shn_add_column('blog_posts', 'updated_by',        'INT UNSIGNED NULL AFTER `updated_at`');
CALL shn_add_column('blog_posts', 'view_count',        'INT UNSIGNED NOT NULL DEFAULT 0 AFTER `social_image`');

CALL shn_add_index('blog_posts', 'idx_blog_posts_scheduled', 'KEY `idx_blog_posts_scheduled` (`status`, `scheduled_at`)');
CALL shn_add_index('blog_posts', 'idx_blog_posts_focus',     'KEY `idx_blog_posts_focus` (`focus_keyword`)');

/* ---------------------------------------------------------------------------
   2. blog_categories — SEO + ordering
   --------------------------------------------------------------------------- */

CALL shn_add_column('blog_categories', 'seo_title',       'VARCHAR(200) NULL AFTER `description`');
CALL shn_add_column('blog_categories', 'seo_description', 'VARCHAR(320) NULL AFTER `seo_title`');
CALL shn_add_column('blog_categories', 'sort_order',      'SMALLINT NOT NULL DEFAULT 0 AFTER `seo_description`');
CALL shn_add_column('blog_categories', 'noindex',         'TINYINT(1) NOT NULL DEFAULT 0 AFTER `sort_order`');

/* ---------------------------------------------------------------------------
   3. pages — page builder fields
   --------------------------------------------------------------------------- */

CALL shn_add_column('pages', 'focus_keyword',      'VARCHAR(160) NULL AFTER `seo_description`');
CALL shn_add_column('pages', 'secondary_keywords', 'VARCHAR(500) NULL AFTER `focus_keyword`');
CALL shn_add_column('pages', 'canonical_url',      'VARCHAR(500) NULL AFTER `secondary_keywords`');
CALL shn_add_column('pages', 'noindex',            'TINYINT(1) NOT NULL DEFAULT 0 AFTER `canonical_url`');
CALL shn_add_column('pages', 'og_image',           'VARCHAR(255) NULL AFTER `noindex`');
CALL shn_add_column('pages', 'page_group',         'VARCHAR(80) NULL AFTER `og_image`');
CALL shn_add_column('pages', 'sort_order',         'SMALLINT NOT NULL DEFAULT 0 AFTER `page_group`');
CALL shn_add_column('pages', 'scheduled_at',       'DATETIME NULL DEFAULT NULL AFTER `published_at`');

CALL shn_add_index('pages', 'idx_pages_scheduled', 'KEY `idx_pages_scheduled` (`status`, `scheduled_at`)');
CALL shn_add_index('pages', 'idx_pages_group',     'KEY `idx_pages_group` (`page_group`, `sort_order`)');

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

CALL shn_add_column('media', 'kind',        'VARCHAR(20) NOT NULL DEFAULT ''image'' AFTER `mime_type`');
CALL shn_add_column('media', 'description', 'VARCHAR(300) NULL AFTER `alt_text`');
CALL shn_add_index('media', 'idx_media_kind', 'KEY `idx_media_kind` (`kind`)');

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

DROP PROCEDURE IF EXISTS shn_add_column;
DROP PROCEDURE IF EXISTS shn_add_index;

SELECT 'blog cms migration applied' AS status,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'blog_posts' AND COLUMN_NAME = 'scheduled_at') AS posts_have_scheduled_at,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pages' AND COLUMN_NAME = 'scheduled_at') AS pages_have_scheduled_at,
       (SELECT COUNT(*) FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('blog_post_metadata','publishing_log')) AS new_tables;
