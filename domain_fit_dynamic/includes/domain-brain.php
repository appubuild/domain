<?php
require_once __DIR__ . '/cache.php';

/** A small local-only seed keeps the browser and JSON generator usable if wordbank tables are unavailable. */
function generator_fallback_wordbank(bool $reviewOnly = false): array
{
    $verified = [
        2 => ['ad','ai','am','an','as','at','be','by','do','go','he','if','in','is','it','me','my','no','of','on','or','ox','so','to','up','us','we'],
        3 => ['ace','air','art','ash','ask','bag','bay','bee','box','bus','buy','car','cat','cup','day','dog','dot','eco','fit','fly','fun','gem','get','hub','ice','ink','joy','key','lab','law','map','net','oak','owl','pay','pen','pod','ray','run','sea','sky','sun','tag','tap','top','web','win','zen','zip'],
        4 => ['aura','bank','beam','bird','blue','bold','book','calm','cash','code','core','data','dawn','deep','edge','flow','food','fund','glow','gold','grow','home','hope','iron','leaf','life','link','lock','loop','love','mint','nest','next','nova','open','path','peak','pure','safe','seed','shop','star','team','tech','tree','wave','wise','work'],
        5 => ['amber','apple','atlas','bloom','boost','brand','brave','clear','cloud','craft','dream','earth','flora','focus','forge','fresh','green','honey','light','maple','ocean','orbit','pilot','pixel','prime','river','solar','spark','stone','swift','trust','vital'],
        6 => ['anchor','beacon','bright','circle','create','future','garden','growth','harbor','launch','market','nature','planet','rocket','source','stream','studio','summit','system','valley','vision','wallet','wonder'],
    ];
    $creative = [
        2 => ['io','ai','ox','ex'],
        3 => ['vex','vox','vib','zap','zen','sol','lux','orb','lum','pix'],
        4 => ['livo','zype','kivo','velo','nexo','axon','jolt','vibe','flux','flex'],
        5 => ['novax','zylos','vexel','zeniq','kinet','fluxo','solis','orbis'],
        6 => ['nexora','veltra','zylent','kivora','dynexi','voltra','quante'],
    ];
    $long = [
        'account','advance','advisor','airflow','amplify','archive','artisan','balance','benefit','blossom',
        'booking','branding','builder','business','catalyst','central','channel','clarity','compass','connect',
        'creator','culture','digital','discover','dynamic','elegant','elevate','empower','enhance','explore',
        'feature','finance','fitness','flourish','forward','founder','freedom','frontier','gateway','harmony',
        'harvest','healthy','helpful','imagine','improve','insight','journey','lantern','leading','luminous',
        'mindful','mission','monitor','network','optimize','organic','partner','payment','pioneer','platform',
        'premium','progress','project','quantum','quality','radiant','reliable','resource','revenue','service',
        'sparkle','storage','strategy','success','support','synergy','tailored','thriving','together','toolbox',
        'trusted','venture','vibrant','victory','village','wellness','workflow','blueprint','creative','evergreen',
        'framework','greenfield','northstar','marketplace','lighthouse','wildflower','resilient','technology',
    ];
    $categories = [
        ['key' => 'smart', 'label' => 'General brand', 'description' => 'Default pool for broad brainstorming.'],
        ['key' => 'fintech', 'label' => 'FinTech & Crypto', 'description' => 'Finance, payments and digital assets.'],
        ['key' => 'tech_ai', 'label' => 'AI & Tech', 'description' => 'Software, infrastructure and technology.'],
        ['key' => 'ecommerce', 'label' => 'E-Commerce', 'description' => 'Retail, shopping and online commerce.'],
        ['key' => 'health_bio', 'label' => 'Health & Bio', 'description' => 'Health, care, biology and wellness.'],
        ['key' => 'creative_media', 'label' => 'Creative & Media', 'description' => 'Creative work, design and media.'],
        ['key' => 'saas_action', 'label' => 'SaaS & Productivity', 'description' => 'Work, collaboration and productivity.'],
        ['key' => 'minimal_short', 'label' => 'Minimal / Short', 'description' => 'Short and compact naming ideas.'],
    ];
    $keywords = [
        'smart' => [],
        'fintech' => ['pay','cash','coin','money','bank','fund','wallet','crypto','token','loan','card','save','earn','bill','trade','wealth'],
        'tech_ai' => ['ai','tech','data','cloud','code','dev','host','server','byte','bot','mesh','model','agent','software'],
        'ecommerce' => ['shop','cart','retail','store','sell','market','order','checkout','merchant','catalog','commerce','delivery'],
        'health_bio' => ['health','bio','medical','medicine','clinic','care','wellness','gene','cell','therapy','fitness','vitality'],
        'creative_media' => ['creative','media','design','art','film','music','story','photo','video','studio','canvas','motion'],
        'saas_action' => ['work','task','flow','team','lead','run','grow','dash','lift','sync','track','form','desk','meet','productivity'],
        'minimal_short' => ['mini','short','tiny','micro','nano','compact'],
    ];
    $preferred = [
        'smart' => [],
        'fintech' => ['cash','bank','pay','fund','mint','wallet','vault','token'],
        'tech_ai' => ['ai','tech','data','code','cloud','byte','mesh'],
        'ecommerce' => ['shop','cart','sell','store','market','brand','ship'],
        'health_bio' => ['care','health','wellness','vital','life','pulse'],
        'creative_media' => ['art','design','media','pixel','studio','story'],
        'saas_action' => ['work','team','task','flow','sync','dash','tool'],
        'minimal_short' => ['go','up','on','to','ox','ai'],
    ];
    if ($reviewOnly) {
        // No individual review metadata exists for the static fallback terms.
        $verified = [];
        $long = [];
    }
    $labels = [];
    foreach ($categories as $category) {
        $labels[$category['key']] = $category['label'];
    }

    return [
        'verifiedDictionary' => $verified,
        'creativeBrandables' => $creative,
        'longPartnerWords' => $long,
        'categoryKeywords' => $keywords,
        'categoryPreferredWords' => $preferred,
        'englishReviewOnly' => $reviewOnly,
        'categoryLabels' => $labels,
        'categories' => $categories,
        'fallback' => true,
    ];
}

function generator_wordbank_fallback_cached(bool $reviewOnly): array
{
    $fallback = generator_fallback_wordbank($reviewOnly);
    try {
        cache_set('generator_wordbank_v2', $fallback, 600);
    } catch (Throwable $error) {
        error_log('Generator fallback cache write failed: ' . $error->getMessage());
    }
    return $fallback;
}

function get_generator_wordbank(PDO $pdo, bool $forceRefresh = false): array
{
    if (!$forceRefresh) {
        $cached = cache_get('generator_wordbank_v2');
        if (is_array($cached)
            && isset($cached['verifiedDictionary'], $cached['creativeBrandables'], $cached['categoryLabels'])
            && is_array($cached['verifiedDictionary'])
            && is_array($cached['creativeBrandables'])
            && is_array($cached['categoryLabels'])) {
            return $cached;
        }
    }

    $reviewOnly = (bool) setting($pdo, 'generator_review_only', false);
    try {
        $terms = $pdo->query('SELECT word, term_type, english_reviewed FROM wordbank_terms WHERE is_active = 1 ORDER BY word')->fetchAll();
    } catch (Throwable $error) {
        error_log('Generator wordbank terms unavailable; using local fallback: ' . $error->getMessage());
        return generator_wordbank_fallback_cached($reviewOnly);
    }

    $verified = [];
    $creative = [];
    $long = [];
    foreach ($terms as $term) {
        if (!is_array($term) || !isset($term['word'], $term['term_type'])) {
            continue;
        }
        $word = strtolower(trim((string) $term['word']));
        $length = strlen($word);
        if ($length < 2 || $length > 48 || !preg_match('/^[a-z0-9-]+$/', $word)) {
            continue;
        }
        if ($term['term_type'] === 'curated') {
            if ($reviewOnly && !(bool) ($term['english_reviewed'] ?? false)) {
                continue;
            }
            $verified[$length][] = $word;
        } elseif ($term['term_type'] === 'brandable') {
            $creative[$length][] = $word;
        } elseif ($term['term_type'] === 'long_partner') {
            if (!$reviewOnly || (bool) ($term['english_reviewed'] ?? false)) {
                $long[] = $word;
            }
        }
    }

    if (!$verified && !$creative && !$long) {
        error_log('Generator wordbank returned no usable terms; using local fallback.');
        return generator_wordbank_fallback_cached($reviewOnly);
    }

    $fallback = generator_fallback_wordbank($reviewOnly);
    $usingFallback = false;
    if (!$verified && !$reviewOnly) {
        $verified = $fallback['verifiedDictionary'];
        $usingFallback = true;
    }
    if (!$creative) {
        $creative = $fallback['creativeBrandables'];
        $usingFallback = true;
    }
    if (!$long && !$reviewOnly) {
        $long = $fallback['longPartnerWords'];
        $usingFallback = true;
    }
    try {
        $categories = $pdo->query('SELECT category_key,label,description,detection_keywords_json,preferred_words_json FROM wordbank_categories WHERE is_active = 1 ORDER BY display_order, label')->fetchAll();
    } catch (Throwable $error) {
        error_log('Generator wordbank categories unavailable; using local category defaults: ' . $error->getMessage());
        $categories = [];
    }
    if (!$categories) {
        $categories = $fallback['categories'];
        $usingFallback = true;
    }

    $labels = ['smart' => 'General brand'];
    $keywords = ['smart' => []];
    $preferred = ['smart' => []];
    $normalizedCategories = [];
    foreach ($categories as $category) {
        if (!is_array($category)) {
            continue;
        }
        $key = (string) ($category['category_key'] ?? $category['key'] ?? '');
        $label = (string) ($category['label'] ?? '');
        if ($key === '' || $label === '') {
            continue;
        }
        $labels[$key] = $label;
        $rawKeywords = $category['detection_keywords_json'] ?? null;
        $rawPreferred = $category['preferred_words_json'] ?? null;
        $decodedKeywords = is_string($rawKeywords) ? json_decode($rawKeywords, true) : null;
        $decodedPreferred = is_string($rawPreferred) ? json_decode($rawPreferred, true) : null;
        $keywords[$key] = is_array($decodedKeywords) ? $decodedKeywords : ($fallback['categoryKeywords'][$key] ?? []);
        $preferred[$key] = is_array($decodedPreferred) ? $decodedPreferred : ($fallback['categoryPreferredWords'][$key] ?? []);
        $normalizedCategories[] = [
            'key' => $key,
            'label' => $label,
            'description' => (string) ($category['description'] ?? ''),
        ];
    }

    if (!$normalizedCategories) {
        $usingFallback = true;
    }
    $bank = [
        'verifiedDictionary' => $verified,
        'creativeBrandables' => $creative,
        'longPartnerWords' => array_values(array_unique($long)),
        'categoryKeywords' => $keywords,
        'categoryPreferredWords' => $preferred,
        'englishReviewOnly' => $reviewOnly,
        'categoryLabels' => $labels,
        'categories' => $normalizedCategories ?: $fallback['categories'],
        'fallback' => $usingFallback,
    ];
    try {
        cache_set('generator_wordbank_v2', $bank, 600);
    } catch (Throwable $error) {
        error_log('Generator wordbank cache write failed: ' . $error->getMessage());
    }
    return $bank;
}
