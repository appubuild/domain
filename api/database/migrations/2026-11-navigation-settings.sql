-- ============================================================================
--  Safe Home Network — navigation settings (header menu + footer columns)
-- ============================================================================
--  The header menu, the two footer link columns and their labels are rendered
--  from three public settings rows, so the owner can add, rename, reorder or
--  remove a link from Admin → Settings without a code change.
--
--  This migration only *creates* the rows. Existing rows are never overwritten,
--  so a site whose links were already edited keeps them.
--
--  Safe to run more than once, and safe to paste straight into phpMyAdmin:
--  no stored procedures, no DELIMITER, no duplicate-key errors.
-- ============================================================================

INSERT IGNORE INTO `settings`
  (`setting_key`, `setting_group`, `setting_value`, `setting_type`, `is_public`, `updated_by`)
VALUES
  ('nav_links', 'navigation',
   '[{"label":"Home","to":"/"},{"label":"Services","to":"/services"},{"label":"How It Works","to":"/how-it-works"},{"label":"Blog","to":"/blog"},{"label":"About Us","to":"/about"},{"label":"Contact","to":"/contact"}]',
   'json', 1, NULL),
  ('footer_company_links', 'navigation',
   '[{"label":"About Us","to":"/about"},{"label":"How It Works","to":"/how-it-works"},{"label":"Service Area","to":"/service-area"},{"label":"All Services","to":"/services"},{"label":"Contact","to":"/contact"}]',
   'json', 1, NULL),
  ('footer_legal_links', 'navigation',
   '[{"label":"Privacy Policy","to":"/privacy-policy"},{"label":"Terms & Conditions","to":"/terms-and-conditions"},{"label":"Disclaimer","to":"/disclaimer"},{"label":"Do Not Sell or Share My Personal Information","to":"/do-not-sell-or-share"},{"label":"Accessibility Statement","to":"/accessibility"}]',
   'json', 1, NULL),
  ('footer_company_title', 'navigation', 'Company', 'string', 1, NULL),
  ('footer_services_title', 'navigation', 'Services', 'string', 1, NULL),
  ('footer_legal_title', 'navigation', 'Legal', 'string', 1, NULL);

SELECT
  'navigation settings ready' AS status,
  (SELECT COUNT(*) FROM `settings`
    WHERE `setting_key` IN ('nav_links','footer_company_links','footer_legal_links',
                            'footer_company_title','footer_services_title','footer_legal_title')) AS rows_present;
