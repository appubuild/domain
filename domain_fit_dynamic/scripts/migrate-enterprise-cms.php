<?php
declare(strict_types=1);

/** Idempotent schema upgrade for the enterprise editor, relational post categories, ads and Gemini wordbank. */
require_once __DIR__ . '/../includes/functions.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

try {
    $pdo = db();
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $columnExists = static function (string $table, string $column) use ($pdo): bool {
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column LIMIT 1');
        $statement->execute(['table' => $table, 'column' => $column]);
        return (bool) $statement->fetchColumn();
    };
    $indexExists = static function (string $table, string $index) use ($pdo): bool {
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = :table AND index_name = :name LIMIT 1');
        $statement->execute(['table' => $table, 'name' => $index]);
        return (bool) $statement->fetchColumn();
    };
    $constraintExists = static function (string $constraint) use ($pdo): bool {
        $statement = $pdo->prepare('SELECT 1 FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name = :name LIMIT 1');
        $statement->execute(['name' => $constraint]);
        return (bool) $statement->fetchColumn();
    };

    $pdo->exec("CREATE TABLE IF NOT EXISTS categories (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(120) NOT NULL,
        slug VARCHAR(140) NOT NULL,
        created_by BIGINT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_categories_name (name),
        UNIQUE KEY uq_categories_slug (slug),
        CONSTRAINT fk_content_category_creator FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("CREATE TABLE IF NOT EXISTS blog_post_categories (
        post_id BIGINT UNSIGNED NOT NULL,
        category_id BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (post_id, category_id),
        KEY idx_post_categories_category (category_id, post_id),
        CONSTRAINT fk_post_categories_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
        CONSTRAINT fk_post_categories_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $adColumns = [
        'size_preset' => "VARCHAR(32) NOT NULL DEFAULT 'responsive'",
        'show_desktop' => 'TINYINT(1) NOT NULL DEFAULT 1',
        'show_tablet' => 'TINYINT(1) NOT NULL DEFAULT 1',
        'show_mobile' => 'TINYINT(1) NOT NULL DEFAULT 1',
        'custom_markup' => 'MEDIUMTEXT NULL',
    ];
    foreach ($adColumns as $column => $definition) {
        if (!$columnExists('ad_slots', $column)) {
            $pdo->exec('ALTER TABLE ad_slots ADD COLUMN `' . $column . '` ' . $definition);
        }
    }

    $wordbankColumns = [
        'category_id' => 'BIGINT UNSIGNED NULL',
        'partner_length' => 'TINYINT UNSIGNED NULL',
        'verification_status' => "ENUM('unverified','reviewed') NOT NULL DEFAULT 'unverified'",
        'source' => "ENUM('seed','manual','gemini') NOT NULL DEFAULT 'seed'",
    ];
    $addedWordbankColumns = [];
    foreach ($wordbankColumns as $column => $definition) {
        if (!$columnExists('wordbank_terms', $column)) {
            $pdo->exec('ALTER TABLE wordbank_terms ADD COLUMN `' . $column . '` ' . $definition);
            $addedWordbankColumns[] = $column;
        }
    }
    if (!$indexExists('wordbank_terms', 'idx_word_category_length')) {
        $pdo->exec('ALTER TABLE wordbank_terms ADD KEY idx_word_category_length (category_id, partner_length, is_active)');
    }
    if (!$constraintExists('fk_word_category') && !$constraintExists('fk_wordbank_term_category')) {
        $pdo->exec('ALTER TABLE wordbank_terms ADD CONSTRAINT fk_word_category FOREIGN KEY (category_id) REFERENCES wordbank_categories(id) ON DELETE SET NULL');
    }

    $existingCategories = $pdo->query("SELECT DISTINCT TRIM(category) AS name FROM blog_posts WHERE TRIM(category) <> '' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    $findCategory = $pdo->prepare('SELECT id FROM categories WHERE name = :name LIMIT 1');
    $findSlug = $pdo->prepare('SELECT name FROM categories WHERE slug = :slug LIMIT 1');
    $insertCategory = $pdo->prepare('INSERT INTO categories (name, slug) VALUES (:name, :slug)');
    foreach ($existingCategories as $rawName) {
        $name = trim(substr((string) $rawName, 0, 120));
        if ($name === '') continue;
        $findCategory->execute(['name' => $name]);
        if ($findCategory->fetchColumn()) continue;
        $slug = slugify($name);
        if ($slug === '') $slug = 'category-' . substr(hash('sha256', $name), 0, 12);
        $slug = substr($slug, 0, 140);
        $findSlug->execute(['slug' => $slug]);
        $slugOwner = $findSlug->fetchColumn();
        if ($slugOwner !== false && (string) $slugOwner !== $name) {
            $slug = substr($slug, 0, 120) . '-' . substr(hash('sha256', $name), 0, 12);
        }
        try {
            $insertCategory->execute(['name' => $name, 'slug' => $slug]);
        } catch (PDOException $error) {
            // A case-insensitive duplicate may have been found through a differently cased legacy value.
            if ((string) $error->getCode() !== '23000') throw $error;
        }
    }

    $pdo->beginTransaction();
    $backfill = $pdo->query("SELECT p.id, TRIM(p.category) AS category_name, c.id AS category_id
        FROM blog_posts p JOIN categories c ON c.name = TRIM(p.category)
        WHERE TRIM(p.category) <> ''");
    $link = $pdo->prepare('INSERT IGNORE INTO blog_post_categories (post_id, category_id) VALUES (:post, :category)');
    foreach ($backfill as $row) {
        $link->execute(['post' => (int) $row['id'], 'category' => (int) $row['category_id']]);
    }
    $metadataUpdates = [];
    if (in_array('partner_length', $addedWordbankColumns, true)) $metadataUpdates[] = "partner_length = CASE WHEN CHAR_LENGTH(word) BETWEEN 2 AND 6 THEN CHAR_LENGTH(word) ELSE NULL END";
    if (in_array('verification_status', $addedWordbankColumns, true)) $metadataUpdates[] = "verification_status = CASE WHEN english_reviewed = 1 THEN 'reviewed' ELSE 'unverified' END";
    if ($metadataUpdates) $pdo->exec('UPDATE wordbank_terms SET ' . implode(', ', $metadataUpdates));
    $pdo->commit();

    $pdo->exec("INSERT IGNORE INTO ad_slots (placement,label,publisher_id,ad_unit_id,ad_format,is_enabled) VALUES
        ('article_sidebar','Sidebar rectangle','','','rectangle',0),
        ('page_footer','Page footer banner','','','auto',0)");

    echo "Enterprise CMS migration completed successfully.\n";
    echo 'Relational categories backfilled: ' . count($existingCategories) . " legacy category names found.\n";
    echo "Gemini suggestions will remain unverified; existing English-review flags were retained.\n";
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    error_log('Enterprise CMS migration failed: ' . $error->getMessage());
    fwrite(STDERR, "Migration failed. Check the private PHP log and database permissions.\n");
    exit(1);
}
