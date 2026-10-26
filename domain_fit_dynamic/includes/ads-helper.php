<?php
require_once __DIR__ . '/functions.php';

/** Return markup only for an enabled slot with a structurally valid AdSense ID. No click tracking is added. */
function render_ad_slot(PDO $pdo, string $placement): string
{
    static $loaderPrinted = false;
    if (!setting($pdo, 'ads_enabled', false)) {
        return '';
    }
    try {
        $query = $pdo->prepare('SELECT placement, publisher_id, ad_unit_id, ad_format, label FROM ad_slots WHERE placement = :placement AND is_enabled = 1 LIMIT 1');
        $query->execute(['placement' => $placement]);
        $slot = $query->fetch();
    } catch (Throwable $error) {
        return '';
    }
    if (!$slot) {
        return '';
    }
    $publisherId = trim((string) $slot['publisher_id']);
    $unitId = trim((string) $slot['ad_unit_id']);
    if (!preg_match('/^ca-pub-[0-9]{16}$/', $publisherId) || !preg_match('/^[0-9]{10,20}$/', $unitId)) {
        return '';
    }
    $format = in_array($slot['ad_format'], ['auto','rectangle','horizontal','vertical'], true) ? $slot['ad_format'] : 'auto';
    $loader = '';
    if (!$loaderPrinted) {
        $loaderPrinted = true;
        $loader = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' . e($publisherId) . '" crossorigin="anonymous"></script>';
    }
    $label = trim((string) $slot['label']);
    return $loader . '<aside class="ad-container" aria-label="Advertisement">'
        . ($label !== '' ? '<span class="ad-label">' . e($label) . '</span>' : '')
        . '<ins class="adsbygoogle" style="display:block" data-ad-client="' . e($publisherId) . '" data-ad-slot="' . e($unitId) . '" data-ad-format="' . e($format) . '" data-full-width-responsive="true"></ins>'
        . '<script>(window.adsbygoogle=window.adsbygoogle||[]).push({});</script></aside>';
}
