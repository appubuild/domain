-- ============================================================================
--  Safe Home Network — CMS schema pre-flight check
-- ----------------------------------------------------------------------------
--  Run this BEFORE importing blog-content-import.sql.
--
--  Every row it returns is something the import needs and the database does not
--  have yet. An empty result set means you are ready to import.
--
--  If you get rows back, run the migration first:
--    api/database/migrations/2026-11-blog-cms-upgrade-idempotent.sql
--  (works in every phpMyAdmin; the original migration needs DELIMITER support).
--
--  Run:  phpMyAdmin → select the database → SQL tab → paste → Go
-- ============================================================================

SET NAMES utf8mb4;

SELECT required.table_name,
       required.column_name,
       'MISSING — run 2026-11-blog-cms-upgrade-idempotent.sql' AS action
  FROM (
        /* blog_categories — written by the import */
        SELECT 'blog_categories' AS table_name, 'slug' AS column_name
        UNION ALL SELECT 'blog_categories', 'name'
        UNION ALL SELECT 'blog_categories', 'description'
        UNION ALL SELECT 'blog_categories', 'seo_title'
        UNION ALL SELECT 'blog_categories', 'seo_description'
        UNION ALL SELECT 'blog_categories', 'sort_order'
        UNION ALL SELECT 'blog_categories', 'noindex'

        /* blog_posts — written by the import */
        UNION ALL SELECT 'blog_posts', 'slug'
        UNION ALL SELECT 'blog_posts', 'title'
        UNION ALL SELECT 'blog_posts', 'category_id'
        UNION ALL SELECT 'blog_posts', 'status'
        UNION ALL SELECT 'blog_posts', 'excerpt'
        UNION ALL SELECT 'blog_posts', 'body'
        UNION ALL SELECT 'blog_posts', 'featured_image'
        UNION ALL SELECT 'blog_posts', 'featured_image_alt'
        UNION ALL SELECT 'blog_posts', 'seo_title'
        UNION ALL SELECT 'blog_posts', 'seo_description'
        UNION ALL SELECT 'blog_posts', 'seo_summary'
        UNION ALL SELECT 'blog_posts', 'focus_keyword'
        UNION ALL SELECT 'blog_posts', 'secondary_keywords'
        UNION ALL SELECT 'blog_posts', 'canonical_url'
        UNION ALL SELECT 'blog_posts', 'noindex'
        UNION ALL SELECT 'blog_posts', 'social_image'
        UNION ALL SELECT 'blog_posts', 'author_name'
        UNION ALL SELECT 'blog_posts', 'published_at'
        UNION ALL SELECT 'blog_posts', 'scheduled_at'

        /* blog_tags / blog_post_tags — written by the import */
        UNION ALL SELECT 'blog_tags', 'slug'
        UNION ALL SELECT 'blog_tags', 'name'
        UNION ALL SELECT 'blog_post_tags', 'post_id'
        UNION ALL SELECT 'blog_post_tags', 'tag_id'

        /* blog_post_metadata — written by the import */
        UNION ALL SELECT 'blog_post_metadata', 'post_id'
        UNION ALL SELECT 'blog_post_metadata', 'meta_key'
        UNION ALL SELECT 'blog_post_metadata', 'meta_value'

        /* media — written by the import */
        UNION ALL SELECT 'media', 'filename'
        UNION ALL SELECT 'media', 'original_name'
        UNION ALL SELECT 'media', 'mime_type'
        UNION ALL SELECT 'media', 'kind'
        UNION ALL SELECT 'media', 'size_bytes'
        UNION ALL SELECT 'media', 'path'
        UNION ALL SELECT 'media', 'alt_text'
        UNION ALL SELECT 'media', 'description'
        UNION ALL SELECT 'media', 'created_at'
       ) AS required
  LEFT JOIN information_schema.COLUMNS AS c
         ON c.TABLE_SCHEMA = DATABASE()
        AND c.TABLE_NAME = required.table_name
        AND c.COLUMN_NAME = required.column_name
 WHERE c.COLUMN_NAME IS NULL
 ORDER BY required.table_name, required.column_name;

/* Tables the scheduler and the admin publishing screen need. */
SELECT required.table_name,
       'MISSING TABLE — run 2026-11-blog-cms-upgrade-idempotent.sql' AS action
  FROM (
        SELECT 'publishing_log' AS table_name
        UNION ALL SELECT 'blog_post_metadata'
       ) AS required
  LEFT JOIN information_schema.TABLES AS t
         ON t.TABLE_SCHEMA = DATABASE()
        AND t.TABLE_NAME = required.table_name
 WHERE t.TABLE_NAME IS NULL;
