<?php
require_once __DIR__ . '/cache.php';

function get_generator_wordbank(PDO $pdo, bool $forceRefresh = false): array
{
    if (!$forceRefresh) {
        $cached = cache_get('generator_wordbank_v1');
        if (is_array($cached)) {
            return $cached;
        }
    }

    $verified = [];
    $creative = [];
    $long = [];
    $reviewOnly = (bool) setting($pdo, 'generator_review_only', false);
    $terms = $pdo->query('SELECT word, term_type, english_reviewed FROM wordbank_terms WHERE is_active = 1 ORDER BY word')->fetchAll();
    foreach ($terms as $term) {
        $word = strtolower((string) $term['word']);
        $length = strlen($word);
        if ($length < 2 || $length > 48) {
            continue;
        }
        if ($term['term_type'] === 'curated') {
            if ($reviewOnly && !(bool) $term['english_reviewed']) continue;
            $verified[$length][] = $word;
        } elseif ($term['term_type'] === 'brandable') {
            $creative[$length][] = $word;
        } else {
            if (!$reviewOnly || (bool) $term['english_reviewed']) $long[] = $word;
        }
    }

    $categories = $pdo->query('SELECT category_key,label,description,detection_keywords_json,preferred_words_json FROM wordbank_categories WHERE is_active = 1 ORDER BY display_order, label')->fetchAll();
    $labels = ['smart' => 'General brand'];
    $keywords = [];
    $preferred = [];
    foreach ($categories as $category) {
        $key = (string) $category['category_key'];
        $labels[$key] = (string) $category['label'];
        $keywords[$key] = json_decode((string) $category['detection_keywords_json'], true) ?: [];
        $preferred[$key] = json_decode((string) $category['preferred_words_json'], true) ?: [];
    }
    if (!isset($labels['smart'])) {
        $labels = ['smart' => 'General brand'] + $labels;
        $keywords['smart'] = [];
        $preferred['smart'] = [];
    }
    $bank = [
        'verifiedDictionary' => $verified,
        'creativeBrandables' => $creative,
        'longPartnerWords' => array_values(array_unique($long)),
        'categoryKeywords' => $keywords,
        'categoryPreferredWords' => $preferred,
        'englishReviewOnly' => $reviewOnly,
        'categoryLabels' => $labels,
        'categories' => array_map(static fn(array $item): array => [
            'key' => $item['category_key'],
            'label' => $item['label'],
            'description' => $item['description'],
        ], $categories),
    ];
    cache_set('generator_wordbank_v1', $bank, 600);
    return $bank;
}
