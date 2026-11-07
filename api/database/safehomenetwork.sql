-- ============================================================================
--  SAFE HOME NETWORK — MySQL schema (Phase 2 API)
-- ----------------------------------------------------------------------------
--  Target : MySQL 8.0+ / MariaDB 10.4+  (cPanel / Hostinger compatible)
--  Engine : InnoDB · utf8mb4 · utf8mb4_unicode_ci
--  File   : api/database/safehomenetwork.sql  (schema + seed, import-ready)
--
--  Import through phpMyAdmin:
--    1. Create/select a database (e.g. shn_api).
--    2. Import this file. It drops nothing — it creates and seeds.
--
--  Conventions
--    · every table has created_at / updated_at
--    · public-facing content tables use deleted_at (soft delete)
--    · money is DECIMAL(10,2) and only ever comes from verified sources
--    · no internal operator/team names are stored in public-facing columns
-- ============================================================================

-- Uncomment when importing with "no database selected" (needs CREATE rights):
-- CREATE DATABASE IF NOT EXISTS shn_api CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE shn_api;

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------------------------------------------------------
-- 1. Directory taxonomy
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS `service_phone_groups`;
DROP TABLE IF EXISTS `phone_numbers`;
DROP TABLE IF EXISTS `phone_groups`;
DROP TABLE IF EXISTS `services`;
DROP TABLE IF EXISTS `niches`;
DROP TABLE IF EXISTS `service_categories`;

CREATE TABLE `service_categories` (
  `id`          VARCHAR(32)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `description` TEXT         NULL,
  `sort_order`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `niches` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`        VARCHAR(120) NOT NULL,
  `name`        VARCHAR(160) NOT NULL,
  `description` TEXT         NULL,
  `tone`        VARCHAR(20)  NOT NULL DEFAULT 'brand',
  `status`      ENUM('active','paused') NOT NULL DEFAULT 'active',
  `sort_order`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_niches_slug` (`slug`),
  KEY `idx_niches_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `services` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`               VARCHAR(120) NOT NULL,
  `name`               VARCHAR(160) NOT NULL,
  `short_name`         VARCHAR(80)  NULL,
  `category_id`        VARCHAR(32)  NULL,
  `niche_id`           INT UNSIGNED NULL,
  `icon`               VARCHAR(60)  NOT NULL DEFAULT 'Wrench',
  `image`              VARCHAR(255) NULL,
  `featured`           TINYINT(1)   NOT NULL DEFAULT 0,
  `status`             ENUM('published','draft') NOT NULL DEFAULT 'draft',
  `sort_order`         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `hero_headline`      VARCHAR(200) NULL,
  `hero_subheadline`   VARCHAR(400) NULL,
  `short_description`  VARCHAR(400) NULL,
  `intro`              JSON         NULL,
  `common_needs`       JSON         NULL,
  `options`            JSON         NULL,
  `process_note`       TEXT         NULL,
  `faqs`               JSON         NULL,
  `related`            JSON         NULL,
  `search_terms`       JSON         NULL,
  `meta_title`         VARCHAR(200) NULL,
  `meta_description`   VARCHAR(320) NULL,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`         DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_services_slug` (`slug`),
  KEY `idx_services_status` (`status`),
  KEY `idx_services_category` (`category_id`),
  KEY `idx_services_niche` (`niche_id`),
  KEY `idx_services_sort` (`sort_order`),
  CONSTRAINT `fk_services_category` FOREIGN KEY (`category_id`) REFERENCES `service_categories` (`id`) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT `fk_services_niche` FOREIGN KEY (`niche_id`) REFERENCES `niches` (`id`) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A directory group owns tracking numbers. Groups are stable; numbers come and go.
CREATE TABLE `phone_groups` (
  `id`          VARCHAR(64)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `label`       VARCHAR(160) NULL,   -- heading used in the public call panel
  `blurb`       VARCHAR(320) NULL,   -- one-line description for the picker
  `icon`        VARCHAR(60)  NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `phone_numbers` (
  `id`                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id`          VARCHAR(64)  NOT NULL,           -- stable id used by the frontend ('roofing-1')
  `group_id`             VARCHAR(64)  NOT NULL,
  `number`               VARCHAR(24)  NOT NULL,           -- display format 800-779-3921
  `label`                VARCHAR(160) NULL,
  `priority`             TINYINT UNSIGNED NOT NULL DEFAULT 1,  -- 1 = Call Now, 2+ = Call Alternate
  `status`               ENUM('active','pending-verification','inactive') NOT NULL DEFAULT 'pending-verification',
  `network`              VARCHAR(120) NULL,
  `campaign`             VARCHAR(160) NULL,
  `campaign_nationwide`  TINYINT(1)   NOT NULL DEFAULT 0,
  `campaign_states`      JSON         NULL,
  `campaign_zip_codes`   JSON         NULL,
  `notes`                TEXT         NULL,               -- internal only, never returned publicly
  `verified_at`          DATETIME     NULL DEFAULT NULL,
  `created_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`           DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_numbers_external` (`external_id`),
  UNIQUE KEY `uniq_numbers_number` (`number`),
  KEY `idx_numbers_group` (`group_id`, `priority`),
  KEY `idx_numbers_status` (`status`),
  CONSTRAINT `fk_numbers_group` FOREIGN KEY (`group_id`) REFERENCES `phone_groups` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A service can draw from more than one group; position keeps them ordered.
CREATE TABLE `service_phone_groups` (
  `service_id` INT UNSIGNED NOT NULL,
  `group_id`   VARCHAR(64)  NOT NULL,
  `position`   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`service_id`, `group_id`),
  KEY `idx_spg_group` (`group_id`),
  CONSTRAINT `fk_spg_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_spg_group` FOREIGN KEY (`group_id`) REFERENCES `phone_groups` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. CMS — pages, blog, homepage, FAQs
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS `blog_post_tags`;
DROP TABLE IF EXISTS `blog_tags`;
DROP TABLE IF EXISTS `blog_posts`;
DROP TABLE IF EXISTS `blog_categories`;
DROP TABLE IF EXISTS `pages`;
DROP TABLE IF EXISTS `blog_post_metadata`;
DROP TABLE IF EXISTS `publishing_log`;

CREATE TABLE `blog_post_metadata` (
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

CREATE TABLE `publishing_log` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `entity_type`   ENUM('post','page') NOT NULL,
  `entity_id`     INT UNSIGNED NOT NULL,
  `action`        ENUM('scheduled','published','unpublished','failed','skipped') NOT NULL,
  `scheduled_for` DATETIME NULL DEFAULT NULL,
  `executed_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor`         VARCHAR(60)  NOT NULL DEFAULT 'cron',
  `message`       VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_publishing_entity` (`entity_type`, `entity_id`),
  KEY `idx_publishing_action` (`action`, `executed_at`),
  KEY `idx_publishing_executed` (`executed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `homepage_sections`;
DROP TABLE IF EXISTS `faqs`;
DROP TABLE IF EXISTS `faq_groups`;

CREATE TABLE `pages` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`            VARCHAR(180) NOT NULL,
  `title`           VARCHAR(200) NOT NULL,
  `template`        ENUM('standard','legal','landing') NOT NULL DEFAULT 'standard',
  `status`          ENUM('published','draft','scheduled') NOT NULL DEFAULT 'draft',
  `excerpt`         VARCHAR(400) NULL,
  `body`            LONGTEXT     NULL,
  `seo_title`       VARCHAR(200) NULL,
  `seo_description` VARCHAR(320) NULL,
  `focus_keyword`   VARCHAR(160) NULL,
  `secondary_keywords` VARCHAR(500) NULL,
  `canonical_url`   VARCHAR(500) NULL,
  `noindex`         TINYINT(1)   NOT NULL DEFAULT 0,
  `og_image`        VARCHAR(255) NULL,
  `page_group`      VARCHAR(80)  NULL,     -- grouping in the admin page list
  `sort_order`      SMALLINT     NOT NULL DEFAULT 0,
  `published_at`    DATETIME     NULL DEFAULT NULL,
  `scheduled_at`    DATETIME     NULL DEFAULT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME     NULL DEFAULT NULL,
  `updated_by`      INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pages_slug` (`slug`),
  KEY `idx_pages_status` (`status`),
  KEY `idx_pages_scheduled` (`status`, `scheduled_at`),
  KEY `idx_pages_group` (`page_group`, `sort_order`),
  KEY `idx_pages_updated_by` (`updated_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `blog_categories` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`            VARCHAR(120) NOT NULL,
  `name`            VARCHAR(160) NOT NULL,
  `description`     VARCHAR(400) NULL,
  `seo_title`       VARCHAR(200) NULL,
  `seo_description` VARCHAR(320) NULL,
  `sort_order`      SMALLINT NOT NULL DEFAULT 0,
  `noindex`         TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_blog_categories_slug` (`slug`),
  KEY `idx_blog_categories_order` (`sort_order`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `blog_tags` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`       VARCHAR(120) NOT NULL,
  `name`       VARCHAR(160) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_blog_tags_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `blog_posts` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`               VARCHAR(180) NOT NULL,
  `title`              VARCHAR(220) NOT NULL,
  `category_id`        INT UNSIGNED NULL,
  `status`             ENUM('published','draft','scheduled') NOT NULL DEFAULT 'draft',
  `excerpt`            VARCHAR(500) NULL,
  `body`               LONGTEXT     NULL,
  `featured_image`     VARCHAR(255) NULL,
  `featured_image_alt` VARCHAR(200) NULL,
  `seo_title`          VARCHAR(200) NULL,
  `seo_description`    VARCHAR(320) NULL,
  `seo_summary`        VARCHAR(500) NULL,
  `focus_keyword`      VARCHAR(160) NULL,
  `secondary_keywords` VARCHAR(500) NULL,
  `canonical_url`      VARCHAR(500) NULL,
  `noindex`            TINYINT(1)   NOT NULL DEFAULT 0,
  `social_image`       VARCHAR(255) NULL,
  `view_count`         INT UNSIGNED NOT NULL DEFAULT 0,
  `author_name`        VARCHAR(120) NOT NULL DEFAULT 'Editorial team',
  `published_at`       DATETIME     NULL DEFAULT NULL,
  `scheduled_at`       DATETIME     NULL DEFAULT NULL,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`         INT UNSIGNED NULL,
  `deleted_at`         DATETIME     NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_blog_posts_slug` (`slug`),
  KEY `idx_blog_posts_status` (`status`),
  KEY `idx_blog_posts_category` (`category_id`),
  KEY `idx_blog_posts_published` (`published_at`),
  KEY `idx_blog_posts_scheduled` (`status`, `scheduled_at`),
  KEY `idx_blog_posts_focus` (`focus_keyword`),
  CONSTRAINT `fk_blog_posts_category` FOREIGN KEY (`category_id`) REFERENCES `blog_categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `blog_post_tags` (
  `post_id` INT UNSIGNED NOT NULL,
  `tag_id`  INT UNSIGNED NOT NULL,
  PRIMARY KEY (`post_id`, `tag_id`),
  KEY `idx_bpt_tag` (`tag_id`),
  CONSTRAINT `fk_bpt_post` FOREIGN KEY (`post_id`) REFERENCES `blog_posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bpt_tag` FOREIGN KEY (`tag_id`) REFERENCES `blog_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `homepage_sections` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `section_key` VARCHAR(80)  NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `heading`     VARCHAR(220) NULL,
  `subheading`  VARCHAR(400) NULL,
  `body`        TEXT         NULL,
  `visible`     TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_homepage_key` (`section_key`),
  KEY `idx_homepage_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `faq_groups` (
  `id`      VARCHAR(40)  NOT NULL,   -- 'home' | 'how-it-works' | …
  `name`    VARCHAR(120) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `faqs` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `group_id`   VARCHAR(40) NOT NULL,
  `question`   VARCHAR(300) NOT NULL,
  `answer`     TEXT NOT NULL,
  `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `visible`    TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_faqs_group` (`group_id`, `sort_order`),
  CONSTRAINT `fk_faqs_group` FOREIGN KEY (`group_id`) REFERENCES `faq_groups` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Admin identity, sessions and abuse protection
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS `admin_sessions`;
DROP TABLE IF EXISTS `password_resets`;
DROP TABLE IF EXISTS `rate_limits`;
DROP TABLE IF EXISTS `activity_log`;
DROP TABLE IF EXISTS `admins`;

CREATE TABLE `admins` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(160) NOT NULL,
  `email`          VARCHAR(190) NOT NULL,
  `password_hash`  VARCHAR(255) NOT NULL,
  `role`           ENUM('owner','admin','editor','viewer') NOT NULL DEFAULT 'admin',
  `status`         ENUM('active','suspended') NOT NULL DEFAULT 'active',
  `last_login_at`  DATETIME NULL DEFAULT NULL,
  `last_login_ip`  VARCHAR(64) NULL,
  `failed_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until`   DATETIME NULL DEFAULT NULL,
  `password_changed_at` DATETIME NULL DEFAULT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_admins_email` (`email`),
  KEY `idx_admins_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_sessions` (
  `id`           CHAR(64) NOT NULL,             -- sha256 of the cookie token
  `admin_id`     INT UNSIGNED NOT NULL,
  `csrf_token`   CHAR(64) NOT NULL,
  `ip_hash`      CHAR(64) NULL,
  `user_agent`   VARCHAR(255) NULL,
  `expires_at`   DATETIME NOT NULL,
  `last_used_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sessions_admin` (`admin_id`),
  KEY `idx_sessions_expiry` (`expires_at`),
  CONSTRAINT `fk_sessions_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `password_resets` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`   INT UNSIGNED NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at`    DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_resets_admin` (`admin_id`),
  KEY `idx_resets_token` (`token_hash`),
  CONSTRAINT `fk_resets_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rate_limits` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bucket`       VARCHAR(160) NOT NULL,   -- sha256(action + ip + identifier)
  `action`       VARCHAR(60)  NOT NULL,
  `attempts`     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `window_start` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at`   DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_rate_bucket` (`bucket`),
  KEY `idx_rate_expiry` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `activity_log` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`    INT UNSIGNED NULL,
  `action`      VARCHAR(80)  NOT NULL,
  `entity_type` VARCHAR(60)  NULL,
  `entity_id`   VARCHAR(60)  NULL,
  `summary`     VARCHAR(300) NULL,
  `ip_hash`     CHAR(64)     NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_activity_admin` (`admin_id`),
  KEY `idx_activity_created` (`created_at`),
  CONSTRAINT `fk_activity_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Leads / support inbox
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS `leads`;

CREATE TABLE `leads` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `reference`      VARCHAR(24) NOT NULL,
  `type`           ENUM('lead','support') NOT NULL DEFAULT 'lead',
  `name`           VARCHAR(160) NOT NULL,
  `email`          VARCHAR(190) NOT NULL,
  `phone`          VARCHAR(32)  NULL,
  `service`        VARCHAR(160) NULL,
  `subject`        VARCHAR(200) NULL,
  `message`        TEXT NOT NULL,
  `status`         ENUM('new','contacted','qualified','closed') NOT NULL DEFAULT 'new',
  `priority`       ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  `source`         VARCHAR(60)  NOT NULL DEFAULT 'Direct',
  `utm_source`     VARCHAR(120) NULL,
  `utm_medium`     VARCHAR(120) NULL,
  `utm_campaign`   VARCHAR(160) NULL,
  `assigned_to`    INT UNSIGNED NULL,
  `consent`        TINYINT(1) NOT NULL DEFAULT 0,
  `ip_hash`        CHAR(64) NULL,
  `user_agent`     VARCHAR(255) NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_leads_reference` (`reference`),
  KEY `idx_leads_status` (`status`),
  KEY `idx_leads_created` (`created_at`),
  KEY `idx_leads_assigned` (`assigned_to`),
  CONSTRAINT `fk_leads_admin` FOREIGN KEY (`assigned_to`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. Settings, SEO, media
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS `settings`;
DROP TABLE IF EXISTS `seo_settings`;
DROP TABLE IF EXISTS `media`;

CREATE TABLE `settings` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key`   VARCHAR(80) NOT NULL,
  `setting_group` VARCHAR(40) NOT NULL DEFAULT 'general',
  `setting_value` LONGTEXT NULL,
  `setting_type`  ENUM('string','text','bool','int','json','script') NOT NULL DEFAULT 'string',
  `is_public`     TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`    INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_settings_key` (`setting_key`),
  KEY `idx_settings_group` (`setting_group`),
  CONSTRAINT `fk_settings_admin` FOREIGN KEY (`updated_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `seo_settings` (
  `id`                  TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `default_title`       VARCHAR(200) NOT NULL,
  `title_template`      VARCHAR(200) NOT NULL DEFAULT '%s | Safe Home Network',
  `default_description` VARCHAR(320) NOT NULL,
  `keywords`            JSON NULL,
  `robots`              VARCHAR(40) NOT NULL DEFAULT 'index,follow',
  `sitemap_enabled`     TINYINT(1) NOT NULL DEFAULT 1,
  `canonical_base`      VARCHAR(190) NOT NULL,
  `og_image`            VARCHAR(255) NULL,
  `google_verification` VARCHAR(190) NULL,
  `analytics_id`        VARCHAR(60) NULL,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`          INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_seo_admin` FOREIGN KEY (`updated_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `media` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `filename`      VARCHAR(190) NOT NULL,
  `original_name` VARCHAR(190) NOT NULL,
  `mime_type`     VARCHAR(120) NOT NULL,
  `kind`          VARCHAR(20) NOT NULL DEFAULT 'image',
  `size_bytes`    INT UNSIGNED NOT NULL DEFAULT 0,
  `width`         SMALLINT UNSIGNED NULL,
  `height`        SMALLINT UNSIGNED NULL,
  `path`          VARCHAR(255) NOT NULL,
  `alt_text`      VARCHAR(200) NULL,
  `description`   VARCHAR(300) NULL,
  `uploaded_by`   INT UNSIGNED NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_media_created` (`created_at`),
  CONSTRAINT `fk_media_admin` FOREIGN KEY (`uploaded_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Analytics, calls and revenue
--    · events are first-party and anonymised (no raw IP, no PII)
--    · calls / revenue only exist when a verified network record is imported
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS `analytics_events`;
DROP TABLE IF EXISTS `analytics_daily`;
DROP TABLE IF EXISTS `call_records`;
DROP TABLE IF EXISTS `revenue_records`;

CREATE TABLE `analytics_events` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_type`     ENUM('page_view','service_click','call_click','lead_submit') NOT NULL,
  `visitor_id`     CHAR(36) NULL,          -- first-party cookie uuid
  `session_id`     CHAR(36) NULL,
  `path`           VARCHAR(255) NULL,
  `referrer`       VARCHAR(500) NULL,
  `source`         VARCHAR(60) NULL,       -- Organic search | Direct | Social | Referral | Paid search
  `utm_source`     VARCHAR(120) NULL,
  `utm_medium`     VARCHAR(120) NULL,
  `utm_campaign`   VARCHAR(160) NULL,
  `utm_term`       VARCHAR(160) NULL,
  `utm_content`    VARCHAR(160) NULL,
  `service_id`     INT UNSIGNED NULL,
  `phone_number_id` INT UNSIGNED NULL,
  `device_type`    ENUM('mobile','tablet','desktop','unknown') NOT NULL DEFAULT 'unknown',
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_events_type_created` (`event_type`, `created_at`),
  KEY `idx_events_visitor` (`visitor_id`),
  KEY `idx_events_service` (`service_id`),
  KEY `idx_events_number` (`phone_number_id`),
  KEY `idx_events_source` (`source`),
  CONSTRAINT `fk_events_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_events_number` FOREIGN KEY (`phone_number_id`) REFERENCES `phone_numbers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `analytics_daily` (
  `report_date`      DATE NOT NULL,
  `page_views`       INT UNSIGNED NOT NULL DEFAULT 0,
  `unique_visitors`  INT UNSIGNED NOT NULL DEFAULT 0,
  `service_clicks`   INT UNSIGNED NOT NULL DEFAULT 0,
  `call_clicks`      INT UNSIGNED NOT NULL DEFAULT 0,
  `leads`            INT UNSIGNED NOT NULL DEFAULT 0,
  `connected_calls`  INT UNSIGNED NOT NULL DEFAULT 0,
  `revenue`          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `call_records` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_call_id` VARCHAR(120) NOT NULL,   -- id from the tracking network
  `phone_number_id`  INT UNSIGNED NULL,
  `service_id`       INT UNSIGNED NULL,
  `network`          VARCHAR(120) NULL,
  `campaign`         VARCHAR(160) NULL,
  `caller_state`     CHAR(2) NULL,
  `started_at`       DATETIME NOT NULL,
  `duration_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  `connected`        TINYINT(1) NOT NULL DEFAULT 0,
  `recording_url`    VARCHAR(500) NULL,
  `revenue`          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `verified`         TINYINT(1) NOT NULL DEFAULT 0,
  `raw_payload`      JSON NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_call_external` (`external_call_id`),
  KEY `idx_calls_started` (`started_at`),
  KEY `idx_calls_number` (`phone_number_id`),
  KEY `idx_calls_service` (`service_id`),
  CONSTRAINT `fk_calls_number` FOREIGN KEY (`phone_number_id`) REFERENCES `phone_numbers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_calls_service` FOREIGN KEY (`service_id`) REFERENCES `services` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `revenue_records` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source`         VARCHAR(120) NOT NULL,
  `call_record_id` BIGINT UNSIGNED NULL,
  `amount`         DECIMAL(10,2) NOT NULL,
  `currency`       CHAR(3) NOT NULL DEFAULT 'USD',
  `status`         ENUM('pending','approved','paid','void') NOT NULL DEFAULT 'pending',
  `period_start`   DATE NULL,
  `period_end`     DATE NULL,
  `notes`          VARCHAR(300) NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_revenue_period` (`period_start`, `period_end`),
  KEY `idx_revenue_status` (`status`),
  CONSTRAINT `fk_revenue_call` FOREIGN KEY (`call_record_id`) REFERENCES `call_records` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================================
--  SEED DATA
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Administrator (demo credential from Phase 1: info@safehomenetwork.com / Sa123456)
-- CHANGE THIS PASSWORD IMMEDIATELY AFTER INSTALLATION (see docs/INSTALL.md).
INSERT INTO `admins` (`id`, `name`, `email`, `password_hash`, `role`, `status`) VALUES
  (1, 'Safe Home Network Owner', 'info@safehomenetwork.com', '$2y$12$O.mAyi0e.szDnNHbiL.sZ.Q4k66zoaUBJUNwBtn0.LJ9MSo/5IMoC', 'owner', 'active');

-- Service categories (exactly the five used by the website)
INSERT INTO `service_categories` (`id`, `name`, `description`, `sort_order`) VALUES ('exterior', 'Roofing & Exterior', 'The parts of your home that take the weather — roofs, windows, doors, siding and hardscape.', 1);
INSERT INTO `service_categories` (`id`, `name`, `description`, `sort_order`) VALUES ('systems', 'Home Systems', 'Plumbing, heating, cooling and electrical work that keeps the house running.', 2);
INSERT INTO `service_categories` (`id`, `name`, `description`, `sort_order`) VALUES ('remodeling', 'Remodeling', 'Kitchen, bathroom and bedroom projects that change how a space actually lives.', 3);
INSERT INTO `service_categories` (`id`, `name`, `description`, `sort_order`) VALUES ('restoration', 'Restoration', 'Response and recovery when water gets somewhere it should not be.', 4);
INSERT INTO `service_categories` (`id`, `name`, `description`, `sort_order`) VALUES ('specialty', 'Specialty Services', 'Pest control and locksmith work that calls for a dedicated specialist.', 5);

-- Niches (admin grouping; no public URL impact)
INSERT INTO `niches` (`id`, `slug`, `name`, `description`, `tone`, `status`, `sort_order`) VALUES (1, 'property-exterior', 'Property & Exterior', 'Roofing, windows, doors and hardscape — weather-facing work.', 'brand', 'active', 1);
INSERT INTO `niches` (`id`, `slug`, `name`, `description`, `tone`, `status`, `sort_order`) VALUES (2, 'home-systems', 'Home Systems', 'Plumbing, heating, cooling and electrical trades.', 'success', 'active', 2);
INSERT INTO `niches` (`id`, `slug`, `name`, `description`, `tone`, `status`, `sort_order`) VALUES (3, 'remodeling', 'Remodeling', 'Kitchen, bathroom and bedroom renovation demand.', 'violet', 'active', 3);
INSERT INTO `niches` (`id`, `slug`, `name`, `description`, `tone`, `status`, `sort_order`) VALUES (4, 'restoration-emergency', 'Restoration & Emergency', 'Water damage and storm response — highest time sensitivity.', 'rose', 'active', 4);
INSERT INTO `niches` (`id`, `slug`, `name`, `description`, `tone`, `status`, `sort_order`) VALUES (5, 'specialty-trades', 'Specialty Trades', 'Pest control, locksmith and other single-trade niches.', 'amber', 'active', 5);
INSERT INTO `niches` (`id`, `slug`, `name`, `description`, `tone`, `status`, `sort_order`) VALUES (6, 'appliance-garage', 'Appliance & Garage', 'Appliance repair, garage doors, gutters and tree work.', 'slate', 'paused', 6);

-- Phone directory groups (10)
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('appliance', 'Appliance', 'Appliance', 'Appliance repair and installation', 'wrench');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('electrical', 'Electrical', 'Electrical', 'Panels, outlets, lighting and EV chargers', 'zap');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('hvac', 'HVAC', 'HVAC', 'Heating, cooling, ducts and tune-ups', 'wind');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('plumbing', 'Plumbing', 'Plumbing', 'Leaks, clogs, water heaters and repipes', 'droplets');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('garage-door', 'Garage Door', 'Garage Door', 'Openers, springs, panels and repair', 'door-open');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('gutters', 'Gutters', 'Gutters', 'Cleaning, guards, repair and replacement', 'waves');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('bathroom-kitchen-remodeling', 'Bathroom & Kitchen Remodeling', 'Bath & Kitchen', 'Remodeling, cabinets, tile and fixtures', 'bath');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('roofing', 'Roofing', 'Roofing', 'Roof replacement, leaks and storm damage', 'home');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('tree-service', 'Tree Service', 'Tree Service', 'Removal, trimming and storm cleanup', 'layers');
INSERT INTO `phone_groups` (`id`, `name`, `label`, `blurb`, `icon`) VALUES ('window', 'Window', 'Window', 'Replacement, glass and installation', 'app-window');

-- Tracking numbers (20, owner-confirmed 2026-11-07, nationwide)
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('appliance-1', 'appliance', '800-692-7205', 'Appliance — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('appliance-2', 'appliance', '888-560-3029', 'Appliance — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('electrical-1', 'electrical', '800-692-4680', 'Electrical — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('electrical-2', 'electrical', '888-925-0361', 'Electrical — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('hvac-1', 'hvac', '800-816-9035', 'HVAC — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('hvac-2', 'hvac', '888-391-0143', 'HVAC — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('plumbing-1', 'plumbing', '800-736-1462', 'Plumbing — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('plumbing-2', 'plumbing', '888-861-2884', 'Plumbing — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('garage-door-1', 'garage-door', '800-738-5598', 'Garage Door — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('garage-door-2', 'garage-door', '888-714-0941', 'Garage Door — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('gutters-1', 'gutters', '800-741-8602', 'Gutters — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('gutters-2', 'gutters', '888-729-0842', 'Gutters — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('remodeling-1', 'bathroom-kitchen-remodeling', '800-692-6718', 'Bathroom & Kitchen Remodeling — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('remodeling-2', 'bathroom-kitchen-remodeling', '888-884-4234', 'Bathroom & Kitchen Remodeling — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('roofing-1', 'roofing', '800-779-3921', 'Roofing — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('roofing-2', 'roofing', '888-863-0629', 'Roofing — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('tree-service-1', 'tree-service', '800-763-9887', 'Tree Service — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('tree-service-2', 'tree-service', '888-835-0252', 'Tree Service — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('window-1', 'window', '800-779-8592', 'Window — primary line', 1, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');
INSERT INTO `phone_numbers` (`external_id`, `group_id`, `number`, `label`, `priority`, `status`, `network`, `campaign`, `campaign_nationwide`, `campaign_states`, `campaign_zip_codes`, `notes`, `verified_at`) VALUES ('window-2', 'window', '888-353-0358', 'Window — alternate line', 2, 'active', 'Owner-confirmed direct line', 'Nationwide (confirmed 2026-11-07)', 1, NULL, NULL, 'Owner confirmed this line as live and correct on 2026-11-07.', '2026-11-07 09:00:00');

-- Services (15) with their full page content and metadata
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('roofing', 'Roofing', NULL, 'exterior', 1, 'home', '/images/service-roofing.jpg', 1, 'published', 1, 'Roofing Options for a Full Replacement or New Install', 'Understand what a roof replacement involves, compare materials, and see whether roofing providers are listed in your area.', 'Full roof replacement, tear-offs and new installations, with materials and questions explained before you commit.', '["A roof is the one part of your home that works every single day, in every season, usually without a second thought — until a stain appears on the ceiling or a shingle shows up in the driveway. A full replacement is a large, structural purchase, and it is normal to feel unsure about how to compare one quote to another.","This page is here to make that comparison less of a guess. You will find the situations that typically lead to a roofing project, the main material categories and how they differ, and the questions worth asking before signing anything. When you are ready, the roofing service line is one tap away."]', '[{"title":"Storm and hail damage","description":"Missing shingles, dented flashing or granules collecting in the gutters usually mean the roof needs an inspection before the next heavy rain."},{"title":"Age-related wear","description":"Most asphalt roofs are rated for roughly 20 to 30 years. Curling edges, bald patches and visible attic daylight are signs the covering is near the end of its service life."},{"title":"Leaks that keep coming back","description":"Water travels along decking, so a small ceiling stain is rarely the whole story. Repeat patching often costs more than a planned replacement."},{"title":"Buying or selling a home","description":"Roof age and condition come up in nearly every home inspection. A written assessment gives both sides of a transaction something concrete to work from."},{"title":"Ventilation and skylight changes","description":"New penetrations, ridge vents and attic ventilation are best planned together with the roofing layer rather than added years later."}]', '[{"title":"Architectural asphalt shingles","description":"The most common choice for US homes. Layered shingles look more dimensional than flat three-tab, come in a wide color range, and are comparatively straightforward to install and repair."},{"title":"Metal roofing","description":"Standing-seam or panel systems that shed snow and rain well and typically carry long service-life ratings. Higher upfront material cost and fewer qualified installers in some areas."},{"title":"Tile and slate","description":"Heavy, long-lasting options that suit certain architectural styles. They usually require structural review because of the weight, plus specialized labor."},{"title":"Low-slope and flat systems","description":"For porches, additions and modern flat rooflines, contractors use membrane systems such as TPO, EPDM or modified bitumen instead of shingles."}]', 'Roofing requests are shared with independent roofing contractors who have told us they cover your area. We do not perform roof work, inspect roofs or set pricing — the contractor confirms scope, materials, permits and warranty terms with you directly.', '[{"question":"How long does a roof replacement usually take?","answer":"Most single-family asphalt roof replacements take one to three days once materials are on site and weather cooperates. Larger homes, steep pitches, tile or slate, and structural repairs extend that timeline. Your contractor should give you a written schedule that accounts for tear-off, decking repair and inspection."},{"question":"Should I repair my roof or replace it?","answer":"Repair tends to make sense when damage is isolated and the roof still has meaningful service life left. Replacement is usually the better conversation when the covering is near the end of its rated life, damage covers a large area, or leaks keep returning in different spots. An on-site inspection is the only way to get a real answer."},{"question":"Does a new roof require a permit?","answer":"In most US jurisdictions, yes — especially for a full tear-off or any structural change. Permit requirements are set locally, so ask the contractor who will pull the permit and confirm it will be inspected before final payment."},{"question":"Will homeowners insurance cover roof damage?","answer":"Coverage depends on the cause of damage, your policy and its deductible. Sudden storm or hail damage is commonly covered; wear and tear from age generally is not. Your insurer — not a roofing company — makes that determination, so file a claim and read the adjuster report before committing to work."}]', '["roof-repair","window-installation","water-damage"]', '["roof replacement","shingles","roofer","metal roof","tear-off"]', 'Roofing Services & Roof Replacement Options', 'Explore roof replacement materials, common roofing needs and the questions to ask a contractor. Call the roofing service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('roof-repair', 'Roof Repair', NULL, 'exterior', 1, 'wrench', '/images/service-roof-repair.jpg', 0, 'published', 2, 'Targeted Roof Repairs for Leaks, Flashing and Storm Damage', 'Fix the specific problem instead of the whole roof — when the roof still has life left in it.', 'Leak tracing, shingle replacement, flashing and storm-damage repairs handled by independent roofing contractors.', '["Not every roof problem needs a new roof. A cracked vent boot, a failed chimney flashing or a handful of wind-lifted shingles can often be corrected in a single visit for a fraction of replacement cost — provided the rest of the covering is still sound.","The catch is diagnosis. Water rarely enters where the stain appears, so a repair that only addresses the visible area tends to fail again after the next storm. Below is what roofing repairs usually cover and how to think about repair versus replacement before you spend anything."]', '[{"title":"Active leaks and ceiling stains","description":"Drips during rain, brown rings on ceilings, or damp attic insulation. Fast attention limits damage to decking, insulation and interior finishes."},{"title":"Flashing failures","description":"Chimneys, skylights, valleys and sidewalls are where most leaks start. Flashing and sealant age faster than the shingles around them."},{"title":"Wind-lifted or missing shingles","description":"A small missing section exposes the underlayment and lets the next storm lift the neighboring courses."},{"title":"Gutter and ice dam damage","description":"Backed-up gutters push water under the bottom courses and rot the fascia. Clearing and repairing now prevents interior damage later."},{"title":"Vent and penetration issues","description":"Plumbing vents, exhaust fans and satellite mounts are common points of failure that need proper re-sealing rather than caulk over caulk."}]', '[{"title":"Shingle and section replacement","description":"Lifting and replacing damaged courses with matching material. Best when the roof is otherwise in good condition and the shingle line is still available."},{"title":"Flashing and sealant repair","description":"Rebuilding metal flashing around penetrations and sidewalls. A proper repair replaces failed metal rather than covering it."},{"title":"Leak detection and moisture checks","description":"Some contractors use moisture meters, hose testing or attic inspection to trace the actual entry point before quoting a repair."},{"title":"Emergency tarping","description":"After a storm, a temporary tarp can stop active water intrusion while you wait for an adjuster or a scheduled repair."}]', 'Roof repair requests go to independent roofing contractors who list repair coverage in your area. We do not diagnose leaks or quote repairs — the contractor inspects the roof and tells you whether a repair or replacement is the honest recommendation.', '[{"question":"How much does a roof repair cost?","answer":"Repair pricing depends on access, pitch, the number of problem areas and whether damaged decking has to be replaced. Contractors typically charge a minimum service call plus materials. Ask for the diagnostic fee and what it includes before authorizing work, and get it in writing."},{"question":"Can a roof be repaired in winter?","answer":"Many repairs can be done in cold weather, though adhesive-backed shingles need warmer conditions to seal properly. Some contractors prefer temporary sealing in winter and permanent repair in spring. Ask how the season affects your specific repair."},{"question":"Will a repair void my roof warranty?","answer":"Improper or unauthorized repairs can affect manufacturer warranty coverage. Check the original roofing warranty terms and ask the contractor whether their work is compatible with it, especially on a roof that is still under a material warranty."},{"question":"How quickly should a leak be addressed?","answer":"Treat an active leak as urgent. Water damages insulation, drywall and framing, and sustained moisture can lead to mold growth within days. If water is already inside the house, arrange for it to be contained while the roof repair is scheduled."}]', '["roofing","water-damage","door-installation"]', '["leak repair","shingle repair","flashing","storm damage","roof leak"]', 'Roof Repair: Leaks, Flashing & Storm Damage', 'Learn what roof repairs cover, how leaks are traced and when repair beats replacement. Call the roof repair service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('plumbing', 'Plumbing', NULL, 'systems', 2, 'droplets', '/images/service-plumbing.jpg', 1, 'published', 3, 'Plumbing Help for Leaks, Clogs and Water Heaters', 'From a dripping fixture to a repipe, understand the job before a plumber is standing in your kitchen.', 'Leaks, clogged drains, water heaters, fixture replacements and repipes handled by independent plumbers.', '["Plumbing problems have a way of arriving at the worst possible moment — the night before guests arrive, or the morning a home inspection is scheduled. Some are genuinely minor, like a worn faucet cartridge. Others, like a slab leak or a failing main shutoff valve, get expensive quickly if ignored.","This page walks through the plumbing situations homeowners ask about most, the options a plumber is likely to present, and the details worth confirming before work starts. Once you know roughly what you are dealing with, you can check whether plumbing providers are listed in your area."]', '[{"title":"Leaks and dripping fixtures","description":"Faucets, supply lines, toilets and under-sink fittings. Small leaks waste water and quietly damage cabinets and subfloor."},{"title":"Slow or blocked drains","description":"A single slow sink is usually local; multiple slow drains can point to a main line problem that needs a camera inspection."},{"title":"Water heater replacement","description":"Tank or tankless, gas or electric. Age, recovery rate, venting and available space all shape which units fit your home."},{"title":"Low water pressure","description":"Corroded galvanized pipe, a failing pressure regulator, or a partially closed valve can all be the cause. Diagnosis matters more than guesswork."},{"title":"Fixture and bathroom upgrades","description":"Replacing a toilet, vanity faucet or shower valve often pairs well with a remodeling project, so the wall is opened only once."}]', '[{"title":"Repair and replace components","description":"Cartridges, supply hoses, shutoff valves and toilet internals are inexpensive parts with a short labor window — usually the first thing a plumber quotes."},{"title":"Drain cleaning and camera inspection","description":"Cabling clears most clogs. A camera scope shows whether the line is root-invaded, bellied or cracked, which changes the recommendation entirely."},{"title":"Water heater service","description":"Flush and anode service extends tank life; replacement involves capacity sizing, venting and code clearances. Tankless units add venting and gas-supply considerations."},{"title":"Repiping and main line work","description":"Older galvanized or failing polybutylene systems are sometimes replaced with copper or PEX. Main line repairs may require permits and inspection."}]', 'Plumbing requests are shared with independent licensed plumbers who cover your area. Safe Home Network does not perform plumbing work or quote repairs; the plumber diagnoses the issue and presents options and pricing directly to you.', '[{"question":"How do I know if I need an emergency plumber?","answer":"Active flooding, sewage backing up, no water at all, or the smell of gas alongside a water heater problem are all reasons to act immediately. Shut off the water at the main valve if it is safe to do so, and call a plumber or your utility. Slow drains and dripping faucets can usually wait for a scheduled visit."},{"question":"Should I repair or replace my water heater?","answer":"As a rough guide, a tank unit past ten to twelve years old with a leaking tank is usually a replacement. Units that still hold pressure but need a thermocouple or heating element are often worth repairing. Ask the plumber to test the tank and explain the remaining service life before deciding."},{"question":"Why does my drain keep clogging?","answer":"Repeated clogs in the same fixture usually mean buildup or a mechanical problem further down the line rather than a fresh blockage. A camera inspection is the reliable way to see whether roots, a collapsed section or accumulated grease is responsible."},{"question":"Do plumbers need permits for their work?","answer":"Many installations and most line replacements require a permit and inspection in US jurisdictions. Ask who pulls the permit and confirm the inspection is included in the quote, particularly for water heater replacement and repiping."}]', '["water-damage","bathroom-remodeling","hvac"]', '["plumber","leak","clogged drain","water heater","repipe"]', 'Plumbing Services: Leaks, Drains & Water Heaters', 'Understand common plumbing needs, repair versus replacement options and the questions to ask before hiring. Call the plumbing service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('hvac', 'HVAC', NULL, 'systems', 2, 'wind', '/images/service-hvac.jpg', 1, 'published', 4, 'Heating and Cooling Help for the Whole System', 'Maintenance, repair and replacement decisions for furnaces, heat pumps, AC systems and ductwork.', 'Furnace and heat pump service, AC repair, ductwork and maintenance plans from independent HVAC contractors.', '["A heating and cooling system is the most expensive equipment in most homes and the one homeowners think about least until it stops working. Modern systems are also more tightly coupled than they look: duct sizing, refrigerant charge, airflow and thermostat settings all affect whether equipment performs the way its rating promises.","Here you will find what falls under HVAC work, the difference between maintaining, repairing and replacing a system, and the questions that separate a careful contractor from a quick swap. Heating and cooling demand is seasonal, so ask about timing when you call."]', '[{"title":"Uneven heating or cooling","description":"Rooms that never match the thermostat often point to airflow or duct problems rather than an undersized unit."},{"title":"System not keeping up","description":"A unit that runs constantly in extreme weather may be low on refrigerant, dirty, or simply past its useful capacity."},{"title":"Short cycling and strange noises","description":"Frequent starts, banging, rattling or screeching usually warrant a service call before a bigger failure follows."},{"title":"Age and efficiency decisions","description":"Systems nearing the end of their rated life raise the maintenance-versus-replacement question, especially with rising energy costs."},{"title":"Ductwork and air quality","description":"Leaky or disconnected ducts waste conditioned air; filtration and humidity control affect comfort and indoor air quality."}]', '[{"title":"Maintenance and tune-ups","description":"Seasonal cleaning, filter changes, electrical checks and refrigerant level verification. The cheapest way to extend equipment life and catch small failures early."},{"title":"Repair of existing equipment","description":"Motors, capacitors, igniters, control boards and refrigerant leaks. Cost-effectiveness depends on age, part availability and how often the unit has failed."},{"title":"Full system replacement","description":"Typically involves matching indoor and outdoor components, confirming refrigerant type and verifying duct capacity. Ask about load calculation rather than a like-for-like size swap."},{"title":"Duct sealing and airflow correction","description":"Sealing leaks, correcting returns and balancing rooms can improve comfort without replacing equipment at all."}]', 'HVAC requests are shared with independent heating and cooling contractors who list coverage in your area. Safe Home Network does not install or repair equipment; the contractor performs the load assessment, recommends equipment and provides pricing directly.', '[{"question":"How often should HVAC equipment be serviced?","answer":"Most manufacturers recommend professional maintenance once a year for each system — cooling in spring, heating in fall. Between visits, changing air filters on the schedule your system calls for is the single most useful thing a homeowner can do."},{"question":"When is it better to replace rather than repair?","answer":"Common decision points are a repair costing a significant share of replacement, equipment past ten to fifteen years old, repeated failures in the same season, or a compressor failure on an aging unit. Ask for the age, expected remaining life and the cost of both paths in writing."},{"question":"Should I replace the furnace and AC at the same time?","answer":"If both are the same age and near end of life, replacing together usually saves labor and avoids mismatched components later. If one is clearly newer, keep it and make sure the new equipment is compatible with the existing coil and refrigerant type."},{"question":"Why does my energy bill spike in extreme weather?","answer":"Equipment works harder and runs longer in extreme temperatures, so some increase is normal. A sharp, sustained jump can also indicate a refrigerant leak, failing blower motor, or duct leakage. A service visit with static pressure and refrigerant checks will tell you which."}]', '["ac-repair","electrical","water-damage"]', '["furnace","heat pump","ductwork","air conditioning","tune-up"]', 'HVAC Services: Heating, Cooling & Ductwork', 'Explore HVAC maintenance, repair and replacement options, plus the questions to ask a contractor. Call the heating and cooling service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('ac-repair', 'AC Repair', NULL, 'systems', 2, 'snowflake', '/images/service-ac-repair.jpg', 0, 'published', 5, 'Air Conditioning Repair Before the Heat Sets In', 'Diagnose warm air, weak airflow and short cycling with a technician who tests instead of guessing.', 'Diagnostics, refrigerant checks, capacitor and compressor repairs, and AC replacement guidance.', '["When an air conditioner stops cooling, the temptation is to blame the biggest component. In practice, a large share of no-cooling calls come down to a failed capacitor, a clogged condensate line, a dirty coil or a tripped breaker — inexpensive fixes that need proper diagnosis rather than parts swapping.","This page covers the symptoms homeowners report most often, what a technician actually tests, and when repair stops making financial sense. Cooling demand is seasonal in many markets, so ask about timing rather than assuming a same-day appointment."]', '[{"title":"Blowing warm air","description":"The indoor unit runs but the air is not cold. Low refrigerant, a failed compressor or a dirty condenser coil are common causes."},{"title":"Weak airflow","description":"Restricted filters, failing blower motors or blocked ducts reduce airflow, and low airflow can freeze the indoor coil."},{"title":"Short cycling","description":"Frequent on-off cycles strain the compressor and often trace back to an oversized unit, thermostat placement or low charge."},{"title":"Water around the indoor unit","description":"A clogged condensate drain or a frozen coil produces overflow that can damage ceilings and flooring."},{"title":"Rising energy bills","description":"A system working harder than it used to is often an early warning of a refrigerant or airflow problem."}]', '[{"title":"Diagnostic service call","description":"A technician checks electrical components, refrigerant pressures, temperature split and airflow before recommending anything. Ask about the diagnostic fee up front."},{"title":"Component repair","description":"Capacitors, contactors, motors and control boards are common, relatively inexpensive repairs. Refrigerant leaks require locating and repairing the leak, not just recharging."},{"title":"Coil cleaning and tune-up","description":"Cleaning condenser and evaporator coils and checking the condensate line restores efficiency and prevents repeat calls."},{"title":"System replacement","description":"When a compressor, coil or refrigerant type is at issue on aging equipment, replacement is often the better long-term decision — and existing refrigerant rules affect what can be serviced."}]', 'AC repair requests are shared with independent HVAC contractors who list cooling coverage in your area. We do not diagnose or repair air conditioning equipment; the contractor confirms the fault, parts availability and pricing with you directly.', '[{"question":"Why is my AC running but not cooling?","answer":"The most common causes are low refrigerant from a leak, a dirty condenser coil, restricted airflow from a clogged filter, or a failing compressor. Because the symptoms overlap, a technician should measure pressures and temperature differential instead of assuming a recharge will fix it."},{"question":"How long should an air conditioner last?","answer":"Most central air conditioners are expected to last roughly twelve to fifteen years with regular maintenance, though climate, usage and installation quality all affect that. Repairs on a system beyond that range should be weighed against replacement, especially if parts are hard to source."},{"question":"Is it worth recharging refrigerant every summer?","answer":"No. Refrigerant is a closed system — if it needs recharging, it is leaking. Adding refrigerant without locating the leak is a short-term patch that also raises cost and environmental impact. Ask for leak detection and a repair option."},{"question":"Should I repair or replace a 15-year-old AC unit?","answer":"Compare the repair cost against replacement, consider the refrigerant type and parts availability, and weigh expected remaining life. A single affordable repair can still be sensible; repeated failures in the same season usually point toward replacement."}]', '["hvac","electrical","roof-repair"]', '["air conditioning","AC not cooling","refrigerant","capacitor","compressor"]', 'AC Repair: Diagnostics, Repairs & Replacement', 'Learn why air conditioners stop cooling, what a technician checks and when to repair or replace. Call the AC repair service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('water-damage', 'Water Damage Restoration', NULL, 'restoration', 4, 'waves', '/images/service-water-damage.jpg', 1, 'published', 6, 'Water Damage Restoration When Every Hour Counts', 'Understand the drying process, what insurance needs, and how restoration differs from a plumbing repair.', 'Emergency water extraction, structural drying, moisture documentation and cleanup coordination.', '["Water damage gets worse on a clock. Within the first day, drywall and insulation absorb moisture; within a couple of days, swelling and microbial growth become realistic concerns. The difference between a small cleanup and a rebuild is often how quickly water is extracted and drying equipment is running.","This page explains what a restoration company actually does, how it differs from the plumber who fixes the source, and what to document for an insurance claim. Restoration demand changes quickly during storms, so call rather than assuming immediate service."]', '[{"title":"Burst pipes and supply line failures","description":"A failed washing machine hose or frozen pipe can release hundreds of gallons before anyone notices."},{"title":"Appliance and water heater leaks","description":"Slow leaks behind appliances saturate cabinets and subfloor long before they are visible."},{"title":"Roof and window intrusion","description":"Storm-driven rain entering through failed flashing or damaged shingles soaks ceilings, insulation and wall cavities."},{"title":"Sewage backups and sump failures","description":"Category 3 water requires protective handling and disposal, and often removal of affected porous materials."},{"title":"Basement and crawlspace moisture","description":"Chronic dampness and condensation need both drying and a plan to stop the water from returning."}]', '[{"title":"Emergency extraction and drying","description":"Standing water is extracted, then air movers and dehumidifiers run until materials reach documented dry standards."},{"title":"Moisture monitoring and documentation","description":"Restoration technicians record readings and photographs throughout the job — documentation insurers typically expect with a claim."},{"title":"Contaminated water cleanup","description":"Sewage and floodwater require containment, protective equipment and removal of materials that cannot be safely dried."},{"title":"Repairs and rebuild","description":"Drywall, flooring, trim and paint restoration. Some companies handle both drying and rebuild; others stop at drying, so confirm scope in writing."}]', 'Water damage requests are shared with independent restoration companies that list coverage in your area. Safe Home Network does not perform extraction or drying. Because these situations are urgent, call your insurer or a restoration company directly if water is actively entering your home.', '[{"question":"How quickly does water damage become a mold problem?","answer":"Mold can begin developing on wet porous materials within roughly 24 to 48 hours in warm, humid conditions. That is why extraction and drying equipment should be started the same day when possible, rather than waiting for a scheduled appointment."},{"question":"Does homeowners insurance cover water damage restoration?","answer":"Policies commonly cover sudden accidental discharge, like a burst pipe, and often exclude long-term seepage, neglected maintenance and flooding. Flood coverage is usually separate. Read your policy and speak with your insurer before authorizing large amounts of work."},{"question":"Can I dry the area myself with fans?","answer":"Household fans move air but do not remove moisture from the air the way dehumidifiers do, and they cannot dry inside wall cavities. For anything beyond a small surface spill, professional drying with moisture readings is the safer choice."},{"question":"Will my floors and drywall need to be removed?","answer":"It depends on the material, the water category and how long it was wet. Some hardwood can be dried in place with specialty equipment; saturated carpet padding, laminate and certain drywall sections usually need removal. The restorer documents the readings that justify either approach."}]', '["plumbing","roof-repair","pest-control"]', '["flood","water extraction","mold","burst pipe","drying"]', 'Water Damage Restoration: Drying & Cleanup', 'Understand emergency water extraction, structural drying and insurance documentation. Contact our team to review water damage restoration options.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('pest-control', 'Pest Control', NULL, 'specialty', 5, 'bug', '/images/service-pest-control.jpg', 1, 'published', 7, 'Pest Control That Solves the Problem, Not Just the Sighting', 'Identify what you are dealing with, understand treatment options, and know what ongoing service includes.', 'Inspection, treatment and prevention for ants, roaches, rodents, termites, spiders and stinging insects.', '["Seeing one pest does not always mean an infestation, and seeing none does not mean the problem is gone. Effective pest control starts with identification and inspection: different species need different treatments, and the same treatment applied to the wrong pest wastes money and time.","This page covers the pests homeowners ask about most, how treatment plans differ from one-time visits, and the questions to ask before signing a recurring service agreement. Then you can check whether pest control providers are listed in your area."]', '[{"title":"Ants and roaches in the kitchen","description":"Trails along counters and cabinets usually mean a colony nearby. Baiting and exclusion work better than surface spraying alone."},{"title":"Rodents in the attic or garage","description":"Droppings, gnaw marks and scratching at night. Rodents need both removal and sealing of entry points, or they return."},{"title":"Termites and wood-destroying insects","description":"Mud tubes, frass and hollow-sounding wood. Termite work often requires a specialized inspection and, in many states, a licensed applicator."},{"title":"Spiders, wasps and hornets","description":"Nests around eaves, porches and outbuildings. Stinging insect removal is best handled with protective equipment."},{"title":"Seasonal perimeter prevention","description":"Recurring perimeter treatment aimed at keeping pests from establishing inside during seasonal activity peaks."}]', '[{"title":"One-time inspection and treatment","description":"A targeted visit for an identified problem, often with a follow-up window. Suitable when activity is localized and the source is clear."},{"title":"Recurring maintenance plans","description":"Scheduled perimeter and interior treatments with a service warranty. Compare contract length, cancellation terms and what a callback visit covers."},{"title":"Baiting and exclusion","description":"Bait stations for rodents and certain insects, combined with sealing entry points. Exclusion is what prevents repeat problems."},{"title":"Specialty and wildlife removal","description":"Termites, bed bugs, and wildlife such as squirrels or raccoons usually require specialists and sometimes separate licensing."}]', 'Pest control requests are shared with independent pest management providers who list coverage in your area. Safe Home Network does not apply treatments. The provider inspects, identifies the pest and explains the treatment plan and any warranty directly to you.', '[{"question":"Are the chemicals used in pest control safe for pets and children?","answer":"Licensed applicators use products according to label directions, which include re-entry intervals and handling requirements. Ask the provider which products will be used, what the re-entry time is, and how to protect pets and children during and after treatment."},{"question":"Do I need a recurring plan or a one-time visit?","answer":"A one-time treatment can resolve a defined, localized issue. Recurring plans make more sense for pests with seasonal pressure or a history of reinfestation. Read the contract terms carefully — length, cancellation, and what counts as a covered callback vary widely."},{"question":"How long does it take to get rid of roaches or bed bugs?","answer":"Roaches typically require multiple visits and sanitation cooperation to break the breeding cycle. Bed bugs generally need specialized treatment protocols and often two treatments. Any provider promising elimination in a single visit without inspection deserves scrutiny."},{"question":"What should I do before the technician arrives?","answer":"Clear access to baseboards and cabinets, secure pets, and remove or cover food and dishes in treated areas as instructed. Ask the provider for a preparation list — following it improves results and reduces the need for return visits."}]', '["water-damage","roof-repair","locksmith"]', '["exterminator","termites","rodents","roaches","ants","wasp nest"]', 'Pest Control: Inspection, Treatment & Prevention', 'Compare one-time treatments and recurring pest plans, learn what to ask a provider and contact our team to review pest control options.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('electrical', 'Electrical', NULL, 'systems', 2, 'zap', '/images/service-electrical.jpg', 1, 'published', 8, 'Electrical Work That Starts With Safety', 'Panel upgrades, outlet and lighting work, EV chargers and troubleshooting from licensed electricians.', 'Panel upgrades, circuit additions, lighting, outlet repair and EV charger installation by licensed electricians.', '["Electrical work is the one home service category where the wrong shortcut is genuinely dangerous. Flickering lights, warm outlets and breakers that trip repeatedly are not quirks to live with — they are signals that a circuit is overloaded, a connection is loose, or the panel is at its limit.","This page covers the electrical jobs homeowners most often need, what a licensed electrician inspects before quoting, and why panel capacity so often determines the answer. When you are ready, check whether licensed electricians are listed in your area."]', '[{"title":"Breakers that keep tripping","description":"An overloaded circuit, a failing breaker or a fault in the wiring. Repeated tripping is a symptom that needs diagnosis, not a bigger breaker."},{"title":"Outlets and switches that fail","description":"Warm plates, scorch marks, buzzing or dead outlets suggest loose connections or worn devices that should be replaced promptly."},{"title":"Panel upgrades","description":"Older panels may lack capacity or use discontinued components. Additions, EV chargers and heat pumps often require an upgrade first."},{"title":"Lighting and ceiling fans","description":"New fixtures, recessed lighting and fan installation — including confirming whether a box is rated for fan support."},{"title":"EV charger and appliance circuits","description":"Level 2 chargers, ranges, dryers and hot tubs need dedicated circuits, correct wire sizing and often a permit."}]', '[{"title":"Troubleshooting and repair","description":"Tracing faults, replacing devices and correcting connections. Ask what the diagnostic fee covers and whether it applies to the repair."},{"title":"Panel replacement or upgrade","description":"Increasing service capacity, replacing outdated panels and adding dedicated circuits. Usually permitted and inspected."},{"title":"Circuit and outlet additions","description":"New dedicated circuits for kitchens, workshops, garages or outdoor equipment, with GFCI protection where required."},{"title":"Lighting and smart device installation","description":"Recessed lighting, under-cabinet lighting, dimmers and smart switches — some of which need a neutral wire or compatible dimming."}]', 'Electrical requests are shared with independent licensed electricians who list coverage in your area. Safe Home Network does not perform electrical work. Licensing requirements are set by state and local authorities — ask the electrician for their license number and confirm permits where required.', '[{"question":"Do I need a licensed electrician for small jobs?","answer":"Many jurisdictions require a licensed electrician for anything beyond replacing a fixture or a switch, and permits for new circuits, panel work and service changes. Requirements vary by state and city, so confirm locally and ask for the license number before work begins."},{"question":"Why do my lights flicker?","answer":"A single fixture flickering can be a bulb or dimmer compatibility issue. Lights across the house dimming when an appliance starts often points to a loose service connection or an overloaded panel — which should be checked by an electrician rather than ignored."},{"question":"How do I know if my electrical panel needs upgrading?","answer":"Common indicators include a panel with no spare spaces, fuses instead of breakers, a known problematic panel brand, rust or scorching, or plans to add major loads like an EV charger or heat pump. An electrician performs a load calculation to confirm what your service can support."},{"question":"How long does an EV charger installation take?","answer":"A straightforward Level 2 installation with capacity available in the panel can take a few hours. Jobs requiring a panel upgrade, a long conduit run or a trench to a detached garage take considerably longer and usually need a permit and inspection."}]', '["hvac","kitchen-remodeling","locksmith"]', '["electrician","panel upgrade","breaker","outlet","EV charger"]', 'Electrical Services: Panels, Circuits & Lighting', 'Learn when to call a licensed electrician, what panel upgrades involve and how safety issues are diagnosed. Call the electrical service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('kitchen-remodeling', 'Kitchen Remodeling', NULL, 'remodeling', 3, 'chef-hat', '/images/service-kitchen-remodeling.jpg', 1, 'published', 9, 'Kitchen Remodeling, Planned Before It Is Priced', 'Layout, cabinets, countertops and sequencing — the decisions that determine budget and timeline.', 'Full kitchen renovations, cabinet and countertop replacement, layout changes and finish selections.', '["A kitchen remodel is less a shopping list than a sequence of decisions, and the order matters. Moving a sink changes plumbing; moving a range changes gas and electrical; removing a wall may change structure and permits. The earliest choices set the budget, and late changes are what turn a comfortable project into a stressful one.","This page covers what a kitchen renovation typically includes, the trade-offs between refacing, partial updates and full remodels, and the questions to settle before signing a contract. When you are ready, the kitchen remodeling service line is one tap away."]', '[{"title":"Outdated layout that fights daily use","description":"Poor work triangle, blocked traffic paths and insufficient storage — the problems worth fixing before finishes."},{"title":"Cabinets at end of life","description":"Sagging boxes, broken hinges and worn doors. Refacing, painting and full replacement each solve different budgets and different problems."},{"title":"Countertops and backsplash","description":"Natural stone, quartz, laminate and solid surface have very different cost, maintenance and fabrication timelines."},{"title":"Appliance and lighting upgrades","description":"New appliance sizes, ventilation and task lighting often need electrical and ductwork changes that must be planned early."},{"title":"Preparing to sell","description":"Buyers weigh functional kitchens heavily. Sometimes targeted updates deliver more than a full renovation."}]', '[{"title":"Refresh and reface","description":"New doors and drawer fronts, countertops, hardware and paint over existing cabinet boxes. Lower cost and faster, provided the boxes are square and sound."},{"title":"Pull-and-replace in the same layout","description":"New cabinets and finishes without moving plumbing, gas or electrical. A middle path that keeps costs predictable."},{"title":"Full renovation with layout changes","description":"Relocating plumbing, appliances and walls. Requires design work, permits and longer timelines, and typically the largest budget."},{"title":"Additions and open-plan conversions","description":"Removing a wall or extending the footprint. Requires structural review and a realistic plan for temporary kitchen arrangements."}]', 'Kitchen remodeling requests are shared with independent remodelers whose coverage includes your area. Safe Home Network does not design, build or price kitchens — the remodeler provides drawings, scope, schedule and pricing directly to you.', '[{"question":"How long does a kitchen remodel take?","answer":"A reface or pull-and-replace may take a few weeks. A full renovation with layout and structural changes commonly takes several months, and cabinet and countertop lead times are often the pacing item. Ask for a written schedule with lead times and a clear statement of who is responsible for each phase."},{"question":"Do I need a permit for a kitchen remodel?","answer":"Cosmetic work usually does not require one; plumbing, electrical, gas and structural changes typically do. Permit requirements are local. Confirm in writing which party pulls permits and that inspections are included in the contract price."},{"question":"What should be decided before getting quotes?","answer":"Set a realistic budget, decide whether the layout changes, choose a rough appliance package, and establish who is responsible for design. Quotes are far more comparable when the scope is written down before contractors walk in."},{"question":"Can I live at home during the remodel?","answer":"Many homeowners do, but plan for a temporary setup: a microwave and kettle station, dishwashing in a bathroom or laundry sink, and dust containment. Ask the contractor how they will protect adjacent rooms and control dust daily."}]', '["bathroom-remodeling","electrical","plumbing"]', '["kitchen renovation","cabinets","countertops","backsplash","remodel"]', 'Kitchen Remodeling: Layout, Cabinets & Finishes', 'Plan a kitchen remodel from layout through finishes, understand reface versus full renovation and what to decide before quotes. Call the kitchen service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('bathroom-remodeling', 'Bathroom Remodeling', NULL, 'remodeling', 3, 'bath', '/images/service-bathroom-remodeling.jpg', 1, 'published', 10, 'Bathroom Remodeling Where Waterproofing Comes First', 'Showers, vanities, tile and accessibility updates — with the details that prevent costly water damage later.', 'Shower and tub replacement, tile, vanities and accessibility updates built around proper waterproofing.', '["Bathrooms are small rooms with a lot of plumbing, a lot of moisture and very little tolerance for shortcuts. The visible work — tile, glass, finishes — is what sells a bathroom, but the hidden work is what determines whether it still looks right in ten years. Waterproofing behind tile and correct slope at the shower pan are not optional details.","This page explains what a bathroom renovation includes, how a partial update differs from a full remodel, and which questions separate an experienced contractor from a fast one. Then you can check whether bathroom remodelers are listed in your area."]', '[{"title":"Worn tubs, showers and surrounds","description":"Cracked fiberglass, failing caulk lines and stained grout are the most common triggers for an update."},{"title":"Water damage around fixtures","description":"Soft subfloor, loose tile and moisture behind walls. Fixing the source and the substrate matters more than the new finish."},{"title":"Accessibility and aging in place","description":"Curbless showers, grab bars, comfort-height toilets and wider doorways make a bathroom safer without looking institutional."},{"title":"Storage and layout improvements","description":"Double vanities, linen storage and better lighting transform a small space more than expensive tile does."},{"title":"Preparing a home for sale","description":"Updated bathrooms influence buyer perception strongly, particularly when fixtures and grout look clean and current."}]', '[{"title":"Cosmetic refresh","description":"Paint, fixtures, mirrors, lighting and regrouting without moving plumbing. Quickest and least disruptive, provided the substrate is healthy."},{"title":"Tub-to-shower conversion","description":"Removing a tub and building a tiled shower with new waterproofing, drain and often a curbless entry for accessibility."},{"title":"Full bathroom remodel","description":"New layout, plumbing relocations, tile and cabinetry. Requires permits and a clear temporary-bathroom plan during construction."},{"title":"Accessibility modification","description":"Grab bars, benches, handheld showers and widened entries. Some jurisdictions and programs offer assistance for these improvements."}]', 'Bathroom remodeling requests are shared with independent remodelers who list coverage in your area. We do not perform or price bathroom work. Ask the remodeler how they waterproof wet areas, what the inspection schedule is, and who handles permits.', '[{"question":"How long does a bathroom remodel take?","answer":"A cosmetic refresh can be finished in days. A full remodel with tile and relocated plumbing commonly takes three to six weeks, largely depending on tile work, inspection timing and material lead times. Ask for a schedule that lists inspections rather than only the finish date."},{"question":"Why is waterproofing so important behind shower tile?","answer":"Grout and thinset are not waterproof. A bonded waterproofing membrane or a proper cement board and vapor barrier system keeps moisture out of framing and adjacent rooms. Skipping this is the most common cause of hidden rot behind a newly remodeled shower."},{"question":"Can I keep my existing layout to save money?","answer":"Yes — keeping plumbing in place is one of the most effective ways to control cost. Moving a drain or relocating a toilet requires opening floors and often reworking venting, which adds both labor and inspection steps."},{"question":"Is a walk-in shower or a tub better for resale?","answer":"It depends on your market and the rest of the home. A home with only one bathroom usually benefits from keeping a tub for families with young children, while a spare or primary bathroom often gains appeal with a large walk-in shower. Ask a local remodeler what buyers in your area respond to."}]', '["kitchen-remodeling","plumbing","water-damage"]', '["bathroom renovation","walk-in shower","tile","vanity","tub replacement"]', 'Bathroom Remodeling: Showers, Tile & Vanities', 'Compare a bathroom refresh with a full remodel, learn why waterproofing matters and what to ask a contractor. Call the bathroom service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('bedroom-remodeling', 'Bedroom Remodeling', NULL, 'remodeling', 3, 'bed', '/images/service-bedroom-remodeling.jpg', 0, 'published', 11, 'Bedroom Remodeling for Better Sleep and Better Storage', 'Closets, lighting, insulation and finishes that make a bedroom genuinely comfortable.', 'Primary suite updates, closet systems, lighting, insulation and finish work for bedrooms and guest rooms.', '["Bedroom projects are quieter than kitchens and bathrooms, but they change how a home feels every single day. Noise, drafts, poor closet storage and a single overhead light are the complaints we hear most — and each has a specific, practical fix that does not require rebuilding the room.","This page covers what a bedroom renovation typically includes, from insulation and window updates to closet systems and lighting layers, plus how to plan a primary suite project around the rest of the house. Then contact our team to review bedroom remodeling options."]', '[{"title":"Insufficient closet storage","description":"Reach-in closets that never fit everything. Custom systems and wall reconfiguration recover usable space."},{"title":"Drafts, noise and temperature swings","description":"Air sealing, insulation upgrades and better windows address comfort more effectively than a bigger HVAC unit."},{"title":"Outdated lighting","description":"A single central fixture is rarely enough. Layered ambient, task and reading light transforms a room."},{"title":"Converting an attic or basement","description":"Adding a bedroom requires egress, code-compliant ceiling height and proper moisture control."},{"title":"Primary suite expansion","description":"Adding a bathroom or walk-in closet, which often means structural and plumbing work planned together."}]', '[{"title":"Closet and storage systems","description":"Modular or custom built-ins in existing footprints. Fast, low-disruption, and often the highest-impact change per dollar."},{"title":"Comfort and envelope upgrades","description":"Air sealing, insulation, window replacement and door weatherstripping to reduce drafts and outside noise."},{"title":"Finish renovation","description":"Flooring, trim, paint, lighting and built-ins that modernize the room without changing its footprint."},{"title":"Suite additions and conversions","description":"Adding space, converting an attic, or combining rooms. Requires structural review, permits and egress compliance."}]', 'Bedroom remodeling requests are shared with independent contractors who list coverage in your area. Safe Home Network does not perform design or construction work; the contractor confirms feasibility, permits and pricing with you directly.', '[{"question":"Does a bedroom legally need a closet or window?","answer":"Requirements vary by jurisdiction. Many areas require two means of egress for a room to be counted as a bedroom, and some require a closet. Local building departments and appraisers apply the definitions, so confirm before listing a room as a bedroom."},{"question":"How can I make a bedroom quieter?","answer":"Air sealing around outlets and trim, insulation in exterior and interior walls, solid-core doors and upgraded windows all reduce noise. For severe traffic noise, a contractor may recommend laminated glass or a secondary interior window."},{"question":"Is a closet system worth it compared with a full renovation?","answer":"Often yes. A well-designed closet system delivers daily benefits at a fraction of renovation cost and can usually be installed in a day or two. If the room also has comfort and lighting problems, plan those as separate phases."},{"question":"Can I add a bedroom in a basement?","answer":"Sometimes, if ceiling height, egress windows and moisture control meet code. Egress is the most common blocker. A contractor familiar with your local code should assess the space before you commit to a plan."}]', '["bathroom-remodeling","window-installation","door-installation"]', '["bedroom renovation","closet system","primary suite","attic conversion"]', 'Bedroom Remodeling: Closets, Comfort & Finishes', 'Explore bedroom renovation options including closet systems, insulation, lighting and suite additions. Contact our team to review bedroom remodeling options.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('window-installation', 'Window Installation', NULL, 'exterior', 1, 'app-window', '/images/service-window-installation.jpg', 1, 'published', 12, 'Window Replacement That Actually Reduces Drafts', 'Glass packages, frame materials and installation method — and how each one affects comfort and cost.', 'Full-frame and insert window replacement, glass upgrades and installation detailing for US homes.', '["Windows are sold on numbers — U-factor, solar heat gain, condensation resistance — but what homeowners notice is whether the room is still cold near the glass in January and whether the street is still audible at night. Both outcomes depend as much on installation quality and air sealing as on the glass itself.","This page explains the difference between insert and full-frame replacement, how frame materials compare, and which installation details to insist on. Then the window service line is one tap away."]', '[{"title":"Drafts and cold spots near glass","description":"Failing seals, single-pane glass and worn weatherstripping. Sometimes a repair or air sealing solves it for far less than replacement."},{"title":"Foggy double-pane units","description":"Condensation between panes means the seal has failed. The unit can often be replaced without replacing the entire window frame."},{"title":"Street noise and outside heat","description":"Laminated glass and low-solar-gain coatings reduce noise and solar heat, particularly on south and west exposures."},{"title":"Rotted frames and sills","description":"Wood rot around the opening usually calls for full-frame replacement rather than an insert, since the rot must be removed."},{"title":"Energy and comfort upgrades","description":"Older single-pane windows are a common target when homeowners want a more comfortable house and lower heating and cooling loads."}]', '[{"title":"Insert (pocket) replacement","description":"New sashes and frame fitted inside the existing jamb. Faster and less invasive, but not appropriate where the frame or sill has rot."},{"title":"Full-frame replacement","description":"The entire window and frame are removed and the opening is re-flashed and insulated. Better for water management and older homes."},{"title":"Glass unit replacement","description":"For failed sealed units in otherwise sound frames, replacing just the insulated glass can be the most economical fix."},{"title":"Frame material choices","description":"Vinyl, fiberglass, aluminum-clad wood and wood each behave differently with temperature movement, maintenance and repainting."}]', 'Window installation requests are shared with independent window contractors who list coverage in your area. Safe Home Network does not measure, sell or install windows. Confirm glass specifications, installation method and warranty terms in writing with the contractor.', '[{"question":"How much can new windows reduce energy bills?","answer":"Savings vary widely with climate, existing window condition and how leaky the house is. Windows are rarely the single largest efficiency gain — attic insulation and air sealing often deliver more per dollar. Ask for the specific glass ratings rather than a promised percentage."},{"question":"What do U-factor and SHGC mean?","answer":"U-factor measures how quickly heat passes through the window; lower is better for insulation. Solar heat gain coefficient measures how much solar heat enters; lower values reduce cooling load in hot climates, while higher values can help in cold climates. Your climate zone determines the sensible target."},{"question":"Do I need a permit to replace windows?","answer":"Many jurisdictions require a permit when the opening size changes or when full-frame replacement is performed, and some require it for any replacement. Check with your local building department and confirm who is responsible for the permit."},{"question":"How long does window installation take?","answer":"A typical home with ten to fifteen windows takes one to three days with a crew, assuming standard sizes and no rot repair. Custom sizes, full-frame work and stucco or brick openings extend the timeline. Ask how the crew will protect interiors and handle rain delays."}]', '["door-installation","roofing","bedroom-remodeling"]', '["window replacement","double pane","glass","energy efficient windows"]', 'Window Installation & Replacement Options', 'Compare insert and full-frame window replacement, glass ratings and frame materials, and what to confirm before signing. Call the window service line when you are ready.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('door-installation', 'Door Installation', NULL, 'exterior', 1, 'door-open', '/images/service-door-installation.jpg', 1, 'published', 13, 'Door Installation for Security, Efficiency and Curb Appeal', 'Entry, patio and interior doors installed with the flashing and sealing details that stop air and water.', 'Entry doors, patio doors, storm doors and interior doors installed with proper flashing and sealing.', '["A door has to do three jobs at once: keep weather out, keep the house secure, and look right from the curb. Most door problems trace back to installation rather than the door itself — missing head flashing, an uneven rough opening, or a threshold that was never properly shimmed and sealed.","This page covers entry and patio door replacement, the difference between replacing a slab and the full pre-hung unit, and what to check the day the install is finished. Then contact our team to review door installation options."]', '[{"title":"Drafts, daylight and water intrusion","description":"Worn weatherstripping, a sagging frame or missing flashing. Catching it early prevents rot in the surrounding wall."},{"title":"Security upgrades","description":"Hollow-core exterior doors, cheap locksets and unprotected glass are the common weak points in an entry."},{"title":"Patio and sliding door replacement","description":"Failed rollers, fogged glass and leaking tracks. Some units can be repaired; others are better replaced as a complete system."},{"title":"Curb appeal and style updates","description":"Entry door replacement is one of the most visible exterior updates a homeowner can make, often with color and hardware changes."},{"title":"Interior door and trim updates","description":"Hollow flat-panel doors, worn trim and outdated hardware — quick, contained work that finishes a room."}]', '[{"title":"Door slab replacement","description":"Reusing an existing frame when it is square, solid and properly flashed. Least expensive, but only appropriate in the right conditions."},{"title":"Pre-hung unit replacement","description":"A new door and frame installed together as a unit, with the opening re-flashed and insulated. The most reliable approach for exterior doors."},{"title":"Patio and sliding systems","description":"Sliding glass, French and multi-panel doors. Confirm rough-opening dimensions, threshold drainage and screen options."},{"title":"Security-focused upgrades","description":"Solid-core or reinforced entries, multipoint locksets, security glass and reinforced strike plates — specified together."}]', 'Door installation requests are shared with independent door and carpentry contractors who list coverage in your area. Safe Home Network does not install doors. Ask the contractor about flashing method, materials and whether the opening needs repair before the new door goes in.', '[{"question":"How long does it take to replace an exterior door?","answer":"A pre-hung entry door in a sound opening usually takes a few hours. Damage to the rough opening, rot repair, or a change in door size can turn it into a multi-day job. Ask the contractor to inspect the opening before quoting."},{"question":"Do I need a permit for a new exterior door?","answer":"Replacing a door in the same opening generally does not require a permit, but enlarging an opening, adding a new door, or changing a wall can. Rules vary by jurisdiction, so confirm locally — especially for new openings in load-bearing walls."},{"question":"What is flashing and why does it matter?","answer":"Flashing is the layered water-shedding detail at the door head, jambs and sill. It directs water away from the wall assembly. Without proper flashing, water can enter behind siding and cause rot that is invisible until it is expensive."},{"question":"Can I just replace the door and keep the frame?","answer":"If the frame is square, dry, and flashed correctly, a slab or insert replacement is reasonable and less expensive. If the frame is out of square, rotted or leaking, replacing the whole pre-hung unit is the more durable choice."}]', '["window-installation","locksmith","roofing"]', '["front door","patio door","storm door","pre-hung","door replacement"]', 'Door Installation: Entry, Patio & Interior Doors', 'Compare slab and pre-hung door replacement, security upgrades and flashing details, and what to check after install. Contact our team to review door installation options.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('concrete-paving', 'Concrete & Paving', NULL, 'exterior', 1, 'layers', '/images/service-concrete-paving.jpg', 1, 'published', 14, 'Concrete and Paving Work That Holds Up to Weather', 'Driveways, walkways and patios — base preparation, drainage and joints decide how long they last.', 'Driveways, sidewalks, patios and asphalt work, including repairs, sealing and full replacement.', '["Concrete looks simple from the outside, which is exactly why so much of it fails early. Base preparation, subgrade compaction, drainage slope and joint spacing are what determine whether a slab cracks in the first winter or stays flat for thirty years. The finish is the last decision, not the first.","This page covers the flatwork homeowners most often need, how repair compares with replacement, and the questions to ask before the truck arrives. When you are ready, check whether concrete and paving providers are listed in your area."]', '[{"title":"Cracked or settled driveways","description":"Hairline cracks are often cosmetic; vertical displacement and wide cracks usually signal a base or drainage problem underneath."},{"title":"Trip hazards on walkways","description":"Lifted slabs and uneven joints. Grinding or mudjacking may be an option; sometimes replacement is the safer choice."},{"title":"New patio or parking pad","description":"Adding outdoor living space or a widened drive, which requires planning for drainage and local impervious-surface rules."},{"title":"Asphalt maintenance","description":"Crack filling, seal coating, patching and overlays extend asphalt life when the base is still intact."},{"title":"Poor site drainage","description":"Water pooling against foundations and in low spots. Regrading and proper pitch prevent bigger structural problems."}]', '[{"title":"Concrete replacement","description":"Removal, base re-compaction and a new pour with control joints and proper slope. The durable answer when base or subgrade has failed."},{"title":"Repair and slab lifting","description":"Crack repair, epoxy injection, grinding trip hazards, or foam/mudjacking to lift settled slabs without a full tear-out."},{"title":"Asphalt paving and sealing","description":"New asphalt, patching, overlays and seal coating. Seal coating protects the surface but does not fix a failed base."},{"title":"Pavers and decorative finishes","description":"Stamped concrete, exposed aggregate and unit pavers. Some finishes require more maintenance and resealing than plain concrete."}]', 'Concrete and paving requests are shared with independent contractors who list coverage in your area. Safe Home Network does not pour or repair flatwork. The contractor confirms subgrade conditions, thickness, reinforcement, slope and pricing directly with you.', '[{"question":"How long before I can drive on new concrete?","answer":"Concrete typically needs about seven days to reach a reasonable working strength and is usually safe to drive on after that, though full cure takes longer. Cold, wet weather extends the wait. Follow the specific instructions from the contractor rather than a general rule."},{"question":"Why did my driveway crack so quickly?","answer":"Common causes are an inadequately compacted base, missing or too widely spaced control joints, slabs poured too thin for the load, or water pooling under the slab. Cracks that are even and narrow are often expected behavior; wide, offset cracks are not."},{"question":"Is seal coating asphalt every year necessary?","answer":"Usually not. Seal coating every one to three years is a common recommendation for residential driveways, but over-applying can cause the surface to become brittle and crack. New asphalt should typically cure for several months before the first seal."},{"question":"Do I need a permit for a new driveway or patio?","answer":"Many municipalities require permits for new driveways, sidewalk cuts and changes in impervious surface coverage, and some limit how much of a lot can be paved. Confirm local requirements before work starts."}]', '["roofing","door-installation","window-installation"]', '["driveway","patio","sidewalk","asphalt","seal coating","pavers"]', 'Concrete & Paving: Driveways, Patios, Asphalt', 'Understand concrete and asphalt installation, base preparation, repair versus replacement and permit considerations. Contact our team to review concrete and paving options.');
INSERT INTO `services` (`slug`, `name`, `short_name`, `category_id`, `niche_id`, `icon`, `image`, `featured`, `status`, `sort_order`, `hero_headline`, `hero_subheadline`, `short_description`, `intro`, `common_needs`, `options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`) VALUES ('locksmith', 'Locksmith', NULL, 'specialty', 5, 'key-round', '/images/service-locksmith.jpg', 1, 'published', 15, 'Locksmith Help for Lockouts, Rekeys and Lock Upgrades', 'Know what a legitimate locksmith should ask for, and what a fair job looks like before anyone touches your door.', 'Home lockouts, rekeys, lock replacement, smart locks and deadbolt upgrades from local locksmiths.', '["Locksmith work is one of the few home services where the homeowner is often in a hurry and under pressure — locked out in a parking lot at night, or just after moving into a home with unknown keys. That combination attracts both good operators and bad ones, so knowing a few basics makes a real difference.","This page explains the common locksmith jobs, how rekeying compares with replacement, and what to confirm before a technician starts. Then you can check whether locksmith coverage is confirmed for your area."]', '[{"title":"Home lockouts","description":"A locked door, a broken key or a jammed mechanism. Non-destructive entry is the skill to ask about."},{"title":"Moving into a new home","description":"You do not know who holds keys to an unfamiliar house. Rekeying is usually faster and less expensive than replacing hardware."},{"title":"Deadbolt and security upgrades","description":"Standard builder-grade locksets and short screws are common weak points. ANSI-graded deadbolts and reinforced strikes improve them."},{"title":"Broken or worn hardware","description":"Loose cylinders, snapped keys and failing latches. Often a hardware replacement rather than a full locksmith visit."},{"title":"Smart lock installation","description":"Keypad and app-based locks need the right door prep, deadbolt alignment and a realistic plan for battery and connectivity."}]', '[{"title":"Rekeying existing locks","description":"The cylinders are re-pinned to a new key while the existing hardware stays. Cost-effective and fast when hardware is in good condition."},{"title":"Lock replacement","description":"New locksets or deadbolts when hardware is worn, mismatched or not up to the security level you want."},{"title":"Key duplication and master keying","description":"Extra keys, or a single key for multiple doors. Ask about restricted keyways if you want duplication controlled."},{"title":"Smart lock installation and setup","description":"Deadbolt replacement with app or keypad access, including user codes and access history for guests or renters."}]', 'Locksmith requests are shared with independent locksmiths whose coverage is confirmed for your area. Safe Home Network does not dispatch or perform locksmith work. For a lockout, call a local locksmith directly and confirm pricing before work begins.', '[{"question":"How do I avoid a locksmith scam?","answer":"Ask for the company name and a physical local address, confirm a written price before any work starts, ask whether drilling is required, and pay by card rather than cash only. Be cautious with national call centers that route to whoever is available and quote unrealistically low prices."},{"question":"Should I rekey or replace my locks?","answer":"Rekeying changes who can use the lock while keeping the hardware. Replacement makes sense when the hardware is worn, was installed poorly, or when you want a higher security grade. For a new home with sound locks, rekeying is usually the practical choice."},{"question":"Can a locksmith open a door without damaging it?","answer":"In most residential lockouts, yes — a competent locksmith uses non-destructive techniques. Drilling is sometimes necessary for a failed or high-security cylinder. Ask before approving a destructive approach, and ask what the replacement cost will be if drilling is required."},{"question":"Do locksmiths need a license?","answer":"Licensing rules vary by state and some municipalities require registration or a license number on advertising. Ask for the license or registration number where required, and verify it with the issuing authority before authorizing work."}]', '["door-installation","electrical","pest-control"]', '["lockout","rekey","deadbolt","smart lock","key duplication"]', 'Locksmith Services: Lockouts, Rekeys & Locks', 'Learn how rekeying compares with replacement, what to confirm before a locksmith starts and how to avoid scams. Contact our team to review locksmith options.');

-- Service → phone group mapping (preserves the live website mapping)
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'roofing', 1 FROM `services` WHERE `slug` = 'roofing';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'roofing', 1 FROM `services` WHERE `slug` = 'roof-repair';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'plumbing', 1 FROM `services` WHERE `slug` = 'plumbing';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'hvac', 1 FROM `services` WHERE `slug` = 'hvac';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'hvac', 1 FROM `services` WHERE `slug` = 'ac-repair';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'electrical', 1 FROM `services` WHERE `slug` = 'electrical';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'bathroom-kitchen-remodeling', 1 FROM `services` WHERE `slug` = 'kitchen-remodeling';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'bathroom-kitchen-remodeling', 1 FROM `services` WHERE `slug` = 'bathroom-remodeling';
INSERT INTO `service_phone_groups` (`service_id`, `group_id`, `position`) SELECT `id`, 'window', 1 FROM `services` WHERE `slug` = 'window-installation';

-- Pages
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/', 'Home', 'landing', 'published', 'Hero, service picker, trust markers and popular categories.', NULL, 'Safe Home Network — Home Services, One Call Away', 'Pick a service and call the published line for that trade.', '2026-11-06 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/about', 'About', 'standard', 'published', 'How the directory works and what we do not promise.', NULL, 'About Safe Home Network', 'A directory that connects homeowners with published service lines.', '2026-11-03 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/services', 'Services', 'standard', 'published', 'All fifteen service categories with call buttons.', NULL, 'Home Service Categories', 'Browse every trade and call the line assigned to it.', '2026-11-05 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/how-it-works', 'How It Works', 'standard', 'published', 'Three steps: choose a service, tap Call Now, speak with a provider.', NULL, 'How It Works', 'Select a service, tap Call Now and speak with a participating provider.', '2026-11-01 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/contact', 'Contact', 'standard', 'published', 'Contact form and support addresses.', NULL, 'Contact Safe Home Network', 'Reach the Safe Home Network team by email or through the contact form.', '2026-11-02 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/service-area', 'Service Area', 'standard', 'published', 'Why the ZIP check was removed and how call lines are assigned.', NULL, 'Service Area & Call Lines', 'One directory, service lines across the United States.', '2026-11-06 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/privacy-policy', 'Privacy Policy', 'legal', 'published', 'What we collect, what we do not, and how long we keep it.', NULL, 'Privacy Policy', 'How Safe Home Network handles personal information.', '2026-10-30 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/terms-and-conditions', 'Terms & Conditions', 'legal', 'published', 'Terms of use for the directory and referral service.', NULL, 'Terms & Conditions', 'The terms that govern use of this website.', '2026-10-30 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/disclaimer', 'Disclaimer', 'legal', 'published', 'We are not the contractor and do not guarantee outcomes.', NULL, 'Disclaimer', 'Important information about the referral model.', '2026-10-30 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/do-not-sell-or-share', 'Do Not Sell or Share', 'legal', 'published', 'Categories of information handled and opt-out rights.', NULL, 'Do Not Sell or Share My Personal Information', 'Your privacy choices and opt-out rights.', '2026-10-29 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/accessibility', 'Accessibility', 'legal', 'published', 'Conformance target, known limitations and feedback route.', NULL, 'Accessibility Statement', 'Our accessibility commitment and how to report a barrier.', '2026-10-31 09:00:00', 1);
INSERT INTO `pages` (`slug`, `title`, `template`, `status`, `excerpt`, `body`, `seo_title`, `seo_description`, `published_at`, `updated_by`) VALUES ('/sitemap', 'Sitemap', 'landing', 'draft', 'Human-readable sitemap — draft, generated XML ships instead.', NULL, 'Sitemap', 'Every page on Safe Home Network.', NULL, 1);

-- Blog categories, tags and posts
INSERT INTO `blog_categories` (`slug`, `name`, `description`) VALUES ('roofing', 'Roofing', NULL);
INSERT INTO `blog_categories` (`slug`, `name`, `description`) VALUES ('hvac', 'HVAC', NULL);
INSERT INTO `blog_categories` (`slug`, `name`, `description`) VALUES ('restoration', 'Restoration', NULL);
INSERT INTO `blog_categories` (`slug`, `name`, `description`) VALUES ('electrical', 'Electrical', NULL);
INSERT INTO `blog_categories` (`slug`, `name`, `description`) VALUES ('locksmith', 'Locksmith', NULL);
INSERT INTO `blog_categories` (`slug`, `name`, `description`) VALUES ('remodeling', 'Remodeling', NULL);
INSERT INTO `blog_tags` (`slug`, `name`) VALUES ('roofing', 'roofing');
INSERT INTO `blog_tags` (`slug`, `name`) VALUES ('hvac', 'hvac');
INSERT INTO `blog_tags` (`slug`, `name`) VALUES ('restoration', 'restoration');
INSERT INTO `blog_tags` (`slug`, `name`) VALUES ('electrical', 'electrical');
INSERT INTO `blog_tags` (`slug`, `name`) VALUES ('locksmith', 'locksmith');
INSERT INTO `blog_tags` (`slug`, `name`) VALUES ('remodeling', 'remodeling');
INSERT INTO `blog_posts` (`slug`, `title`, `category_id`, `status`, `excerpt`, `body`, `featured_image`, `featured_image_alt`, `seo_title`, `seo_description`, `author_name`, `published_at`) VALUES ('roof-repair-or-replacement', 'How to tell whether your roof needs repair or replacement', (SELECT `id` FROM `blog_categories` WHERE `slug` = 'roofing' LIMIT 1), 'published', 'Age is only one signal. Granule loss, decking condition and leak history usually decide it.', NULL, '/images/services/roofing.jpg', 'How to tell whether your roof needs repair or replacement', 'Roof Repair vs Replacement: What Decides It', 'The signals that separate a repair from a full replacement, and the questions to ask a contractor.', 'Editorial team', '2026-11-01 09:00:00');
INSERT INTO `blog_posts` (`slug`, `title`, `category_id`, `status`, `excerpt`, `body`, `featured_image`, `featured_image_alt`, `seo_title`, `seo_description`, `author_name`, `published_at`) VALUES ('ac-not-cooling-reasons', 'Six reasons an air conditioner stops cooling', (SELECT `id` FROM `blog_categories` WHERE `slug` = 'hvac' LIMIT 1), 'published', 'From a clogged filter to a failing capacitor — what a technician actually tests, in order.', NULL, '/images/services/ac-repair.jpg', 'Six reasons an air conditioner stops cooling', 'Why Your AC Is Not Cooling', 'Common causes of weak cooling and when repair stops making financial sense.', 'Editorial team', '2026-10-27 09:00:00');
INSERT INTO `blog_posts` (`slug`, `title`, `category_id`, `status`, `excerpt`, `body`, `featured_image`, `featured_image_alt`, `seo_title`, `seo_description`, `author_name`, `published_at`) VALUES ('water-damage-first-48-hours', 'The first 48 hours of a water damage claim', (SELECT `id` FROM `blog_categories` WHERE `slug` = 'restoration' LIMIT 1), 'published', 'What to photograph, what to move, and what to leave untouched for the adjuster.', NULL, '/images/services/water-damage.jpg', 'The first 48 hours of a water damage claim', 'Water Damage: The First 48 Hours', 'A practical checklist for documenting water damage before restoration begins.', 'Editorial team', '2026-10-20 09:00:00');
INSERT INTO `blog_posts` (`slug`, `title`, `category_id`, `status`, `excerpt`, `body`, `featured_image`, `featured_image_alt`, `seo_title`, `seo_description`, `author_name`, `published_at`) VALUES ('electrical-panel-upgrade', 'When an electrical panel upgrade is actually necessary', (SELECT `id` FROM `blog_categories` WHERE `slug` = 'electrical' LIMIT 1), 'published', 'Capacity, age and the warning signs that a service panel is at its limit.', NULL, '/images/services/electrical.jpg', 'When an electrical panel upgrade is actually necessary', 'Do You Need an Electrical Panel Upgrade?', 'How an electrician evaluates panel capacity and when an upgrade is justified.', 'Editorial team', '2026-10-14 09:00:00');
INSERT INTO `blog_posts` (`slug`, `title`, `category_id`, `status`, `excerpt`, `body`, `featured_image`, `featured_image_alt`, `seo_title`, `seo_description`, `author_name`, `published_at`) VALUES ('avoid-locksmith-scams', 'How to avoid a locksmith scam', (SELECT `id` FROM `blog_categories` WHERE `slug` = 'locksmith' LIMIT 1), 'draft', 'Quoted price versus arrival price, and the questions that expose a call-center referral.', NULL, '/images/services/locksmith.jpg', 'How to avoid a locksmith scam', 'Avoiding Locksmith Scams', 'What to confirm before a locksmith starts work.', 'Editorial team', NULL);
INSERT INTO `blog_posts` (`slug`, `title`, `category_id`, `status`, `excerpt`, `body`, `featured_image`, `featured_image_alt`, `seo_title`, `seo_description`, `author_name`, `published_at`) VALUES ('kitchen-remodel-budget', 'Where a kitchen remodel budget actually goes', (SELECT `id` FROM `blog_categories` WHERE `slug` = 'remodeling' LIMIT 1), 'scheduled', 'Cabinetry and labour dominate; finishes are where the range widens fastest.', NULL, '/images/services/kitchen-remodeling.jpg', 'Where a kitchen remodel budget actually goes', 'Kitchen Remodel Budget Breakdown', 'The line items that drive a kitchen renovation budget.', 'Editorial team', '2026-11-11 09:00:00');
INSERT INTO `blog_post_tags` (`post_id`, `tag_id`) SELECT p.`id`, t.`id` FROM `blog_posts` p, `blog_tags` t WHERE p.`slug` = 'roof-repair-or-replacement' AND t.`slug` = 'roofing';
INSERT INTO `blog_post_tags` (`post_id`, `tag_id`) SELECT p.`id`, t.`id` FROM `blog_posts` p, `blog_tags` t WHERE p.`slug` = 'ac-not-cooling-reasons' AND t.`slug` = 'hvac';
INSERT INTO `blog_post_tags` (`post_id`, `tag_id`) SELECT p.`id`, t.`id` FROM `blog_posts` p, `blog_tags` t WHERE p.`slug` = 'water-damage-first-48-hours' AND t.`slug` = 'restoration';
INSERT INTO `blog_post_tags` (`post_id`, `tag_id`) SELECT p.`id`, t.`id` FROM `blog_posts` p, `blog_tags` t WHERE p.`slug` = 'electrical-panel-upgrade' AND t.`slug` = 'electrical';
INSERT INTO `blog_post_tags` (`post_id`, `tag_id`) SELECT p.`id`, t.`id` FROM `blog_posts` p, `blog_tags` t WHERE p.`slug` = 'avoid-locksmith-scams' AND t.`slug` = 'locksmith';
INSERT INTO `blog_post_tags` (`post_id`, `tag_id`) SELECT p.`id`, t.`id` FROM `blog_posts` p, `blog_tags` t WHERE p.`slug` = 'kitchen-remodel-budget' AND t.`slug` = 'remodeling';

-- Homepage sections
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('hero', 'Hero', 'Your Home Deserves the Right Help.', 'Explore home service options and call the line assigned to the trade you need.', 1, 1);
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('picker', 'Service picker', 'Pick a service. Call the line.', 'No ZIP code, no forms — choose a trade and the published numbers appear.', 1, 2);
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('trust', 'Trust markers', 'A directory built on published lines', 'Fifteen categories, two lines per trade, no auto-dialling.', 1, 3);
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('popular', 'Popular categories', 'Popular categories', 'The trades homeowners search for most often.', 1, 4);
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('steps', 'How it works', 'Three steps to a real conversation', 'Choose, tap, talk.', 1, 5);
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('benefits', 'Why homeowners use it', 'Why homeowners use Safe Home Network', 'Published lines instead of lead-broker guessing games.', 1, 6);
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('faq', 'FAQ', 'Questions homeowners ask', 'How the call lines work, and what they do not do.', 1, 7);
INSERT INTO `homepage_sections` (`section_key`, `name`, `heading`, `subheading`, `visible`, `sort_order`) VALUES ('cta', 'Closing CTA', 'Ready when you are', 'Pick the trade and call the line.', 0, 8);

-- FAQ groups and questions
INSERT INTO `faq_groups` (`id`, `name`) VALUES ('home', 'Homepage FAQ'), ('how-it-works', 'How It Works FAQ');
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('home', 'Does Safe Home Network perform home repairs?', 'No. We are a connection and referral platform. We do not employ technicians, dispatch crews or perform any of the work listed on this site. The phone lines on this site connect you with independent providers who perform the work and set their own pricing, scheduling and warranty terms.', 1, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('home', 'Is it free to use Safe Home Network?', 'Browsing the site and calling a service line is free for homeowners and carries no obligation. We may receive compensation from participating providers when we connect them with a homeowner, which is how the platform is funded. That compensation does not change the price a provider quotes you.', 2, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('home', 'How do the Call Now buttons work?', 'Choose the service you need and a Call Now button appears for that service. It opens the primary and alternate phone numbers assigned to that trade. Tapping a button starts a normal phone call on your device — we never dial automatically, forward your call or connect you without your action.', 3, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('home', 'Should I call the primary or the alternate number?', 'Start with the primary line. If it is busy or does not answer, the alternate line is the same service category reachable by a second number. Both are published service lines for that trade, and neither is a general switchboard for every category.', 4, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('home', 'Do I need to enter a ZIP code?', 'No. The site no longer asks for a ZIP code. You pick a service and call the line assigned to it, and the provider you reach confirms what is available at your address. We removed the ZIP check rather than publish coverage answers we could not verify.', 5, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('home', 'Are the providers licensed and insured?', 'Providers are independent businesses and are responsible for holding whatever licenses, permits, registrations and insurance their trade and jurisdiction require. Licensing rules vary by state and locality, so ask the provider directly and verify credentials with your state or local licensing authority before work begins.', 6, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('home', 'What happens to the information I share?', 'The website does not collect a ZIP code or location. If you email or message our team, we use your contact details only to respond to your request. We do not sell personal information. See our Privacy Policy and Do Not Sell or Share page for the full details and your choices.', 7, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('how-it-works', 'Do I have to choose a provider through Safe Home Network?', 'No. The platform exists to make discovery easier, not to lock you in. You are always free to compare other providers, request additional quotes, or walk away entirely.', 1, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('how-it-works', 'How are service lines assigned to trades?', 'Each trade has its own published line, stored in one central directory. A roofing call always goes to the roofing line, plumbing to the plumbing line, and so on — a number is never reused across unrelated trades, and no number is invented.', 2, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('how-it-works', 'What if a service has no phone line yet?', 'A few categories do not have a published line yet. Those pages say so plainly and offer our contact form instead of showing a number that might belong to a different trade.', 3, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('how-it-works', 'What information should I have ready before I call?', 'Have a short description of the problem, photos if the issue is visible, the age of the home or equipment if you know it, and a rough budget range. Ask whether the provider charges a service or diagnostic fee before they visit.', 4, 1);
INSERT INTO `faqs` (`group_id`, `question`, `answer`, `sort_order`, `visible`) VALUES ('how-it-works', 'How quickly will a provider respond?', 'Response times are set by each independent provider and vary by season and demand. Emergency categories such as active water intrusion or a roof leak during a storm are usually best handled by calling the provider or your insurer directly.', 5, 1);

-- Website settings (public ones are readable by the frontend)
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('site_name', 'general', 'Safe Home Network', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('site_short_name', 'general', 'SafeHome', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('legal_name', 'general', 'Safe Home Network', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('domain', 'general', 'safehomenetwork.com', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('site_url', 'general', 'https://safehomenetwork.com', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('tagline', 'general', 'Your Home Deserves the Right Help.', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('description', 'general', 'Safe Home Network is a home services connection and referral platform. We help homeowners explore service categories and call the published service line for the trade they need, connecting them with independent local service providers.', 'text', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('model_statement', 'general', 'Safe Home Network is a connection and referral platform, not a contractor. We do not perform home repairs, and we do not employ or dispatch service technicians.', 'text', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('logo_path', 'appearance', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('favicon_path', 'appearance', '/favicon.svg', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('contact_phone', 'contact', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('contact_phone_display', 'contact', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('contact_email', 'contact', 'support@safehomenetwork.com', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('support_hours', 'contact', 'Monday–Friday, 9:00 AM – 6:00 PM Eastern', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('response_time', 'contact', 'We aim to reply to every message within one business day.', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('address_lines', 'contact', '[]', 'json', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('social_facebook', 'social', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('social_instagram', 'social', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('social_linkedin', 'social', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('social_x', 'social', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('social_youtube', 'social', NULL, 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('analytics_id', 'integrations', NULL, 'string', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('google_verification', 'integrations', NULL, 'string', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('header_scripts', 'integrations', NULL, 'script', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('footer_scripts', 'integrations', NULL, 'script', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('maintenance_mode', 'operations', '0', 'bool', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('lead_notifications', 'operations', '1', 'bool', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('call_tracking_enabled', 'operations', '1', 'bool', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('lead_notification_email', 'operations', 'support@safehomenetwork.com', 'string', 0, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('sitemap_enabled', 'seo', '1', 'bool', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('timezone', 'general', 'America/New_York', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('currency', 'general', 'USD', 'string', 1, 1);
INSERT INTO `settings` (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`) VALUES ('api_version', 'general', 'v1', 'string', 0, 1);

-- Global SEO defaults
INSERT INTO `seo_settings` (`id`, `default_title`, `title_template`, `default_description`, `keywords`, `robots`, `sitemap_enabled`, `canonical_base`, `og_image`, `google_verification`, `analytics_id`, `updated_by`) VALUES (1, 'Safe Home Network | Find Home Service Options in Your Area', '%s | Safe Home Network', 'Explore home service categories, call the service line for the trade you need, and connect with independent local providers through Safe Home Network.', '["home services","call a contractor","roofing","plumbing","hvac","electrical"]', 'index,follow', 1, 'https://safehomenetwork.com', '/images/hero-home.jpg', '', '', 1);

SET FOREIGN_KEY_CHECKS = 1;
