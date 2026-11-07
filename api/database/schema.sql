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
