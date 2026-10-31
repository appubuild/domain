-- DomainFits extension registry (existing installations only).
-- Import this file in phpMyAdmin against the CMS database; no settings/content rows are changed.
CREATE TABLE IF NOT EXISTS cms_extensions (
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  version VARCHAR(40) NOT NULL,
  status ENUM('inactive','active') NOT NULL DEFAULT 'inactive',
  options_json JSON NOT NULL,
  installed_by BIGINT UNSIGNED NULL,
  installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (slug),
  KEY idx_cms_extensions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
