-- ============================================================================
--  Safe Home Network — one phone number per service
-- ============================================================================
--  Before:  service  ──< service_phone_groups >──  phone_groups ──< phone_numbers
--           A service inherited a whole *group* of lines, so the call panel
--           showed "Primary line / Alternate line" and priority 1 vs 2.
--
--  After:   services.phone_number_id  →  phone_numbers.id
--           Exactly one line per service. A number belongs to at most one
--           service (enforced by a unique index). No groups, no priorities.
--
--  The old tables are kept (nothing is dropped) so existing data and any
--  integration that still reads them keeps working, but the site and the admin
--  console no longer use them.
--
--  Safe to run more than once, and safe to run straight from the phpMyAdmin
--  SQL tab: no stored procedures, no DELIMITER directive, no #1060 errors.
-- ============================================================================

/* 1. The column ------------------------------------------------------------ */
SET @shn_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND COLUMN_NAME = 'phone_number_id') = 0,
  'ALTER TABLE `services` ADD COLUMN `phone_number_id` INT UNSIGNED NULL AFTER `niche_id`',
  'DO 0'
);
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

/* 2. Backfill from the old group mapping ----------------------------------- */
/* Each old group gave its lines to one or more services. We keep the lowest
   priority number of each group and give it to the *first* service of that
   group, so the unique index below can never be violated. */
UPDATE `services` s
  JOIN (
        SELECT MIN(x.`service_id`) AS `service_id`, x.`group_id` AS `group_id`
          FROM `service_phone_groups` x
         GROUP BY x.`group_id`
       ) pick ON pick.`service_id` = s.`id`
  JOIN `phone_numbers` pn ON pn.`group_id` = pick.`group_id` AND pn.`deleted_at` IS NULL
   SET s.`phone_number_id` = pn.`id`
 WHERE s.`phone_number_id` IS NULL
   AND pn.`id` = (
         SELECT p2.`id`
           FROM `phone_numbers` p2
          WHERE p2.`group_id` = pick.`group_id` AND p2.`deleted_at` IS NULL
          ORDER BY p2.`priority` ASC, p2.`id` ASC
          LIMIT 1
       );

/* 3. The unique index that makes "one number, one service" real ------------- */
SET @shn_sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'services' AND INDEX_NAME = 'uniq_services_phone') = 0,
  'ALTER TABLE `services` ADD UNIQUE KEY `uniq_services_phone` (`phone_number_id`)',
  'DO 0'
);
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

/* 4. Numbers no longer belong to a "group" -------------------------------- */
SET @shn_sql = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'phone_numbers'
      AND CONSTRAINT_NAME = 'fk_numbers_group') > 0,
  'ALTER TABLE `phone_numbers` DROP FOREIGN KEY `fk_numbers_group`',
  'DO 0'
);
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

SET @shn_sql = IF(
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'phone_numbers' AND COLUMN_NAME = 'group_id') = 'NO',
  'ALTER TABLE `phone_numbers` MODIFY `group_id` VARCHAR(64) NULL',
  'DO 0'
);
PREPARE shn_stmt FROM @shn_sql; EXECUTE shn_stmt; DEALLOCATE PREPARE shn_stmt;

/* 5. Report ---------------------------------------------------------------- */
SELECT 'single number per service applied' AS result,
       (SELECT COUNT(*) FROM `services` WHERE `phone_number_id` IS NOT NULL) AS services_with_a_line,
       (SELECT COUNT(*) FROM `services` WHERE `deleted_at` IS NULL) AS services_total;
