<?php
declare(strict_types=1);

require_once __DIR__ . '/functions.php';

/** Sanitize publisher-authored, non-executable ad markup. Script tags are intentionally disallowed. */
function sanitize_ad_markup(string $markup, string $publisherId, string $unitId): string
{
    $markup = trim($markup);
    if ($markup === '') return '';
    if (strlen($markup) > 10000) throw new RuntimeException('Custom ad markup must be no larger than 10 KB.');
    if (preg_match('~</?(?:script|style|iframe|object|embed|svg|math|form|video|audio)\b~i', $markup)) {
        throw new RuntimeException('Custom ad markup cannot contain scripts, frames, forms, styles or embedded active content. Use the privileged Site Settings code-injection fields for approved vendor scripts.');
    }
    if (!class_exists(DOMDocument::class)) throw new RuntimeException('The PHP DOM extension is required to sanitize custom ad markup.');

    $allowedTags = ['div','span','a','img','ins','p','strong','em','small','br'];
    $previous = libxml_use_internal_errors(true);
    $dom = new DOMDocument('1.0', 'UTF-8');
    $wrapped = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="ad-markup-root">' . $markup . '</div></body></html>';
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $wrapped, LIBXML_NONET | LIBXML_HTML_NODEFDTD);
    $xpath = new DOMXPath($dom);
    $root = $xpath->query('//*[@id="ad-markup-root"]')->item(0);
    if (!$root instanceof DOMElement) {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        throw new RuntimeException('Custom ad markup could not be parsed safely.');
    }
    $foundAdUnit = false;
    $sanitizeNode = function (DOMNode $parent) use (&$sanitizeNode, &$foundAdUnit, $allowedTags, $publisherId, $unitId): void {
        $children = [];
        foreach ($parent->childNodes as $child) $children[] = $child;
        foreach ($children as $child) {
            if (!$child instanceof DOMElement) {
                if (!$child instanceof DOMText) $parent->removeChild($child);
                continue;
            }
            $tag = strtolower($child->tagName);
            if (!in_array($tag, $allowedTags, true)) {
                $sanitizeNode($child);
                while ($child->firstChild) $parent->insertBefore($child->firstChild, $child);
                $parent->removeChild($child);
                continue;
            }
            $allowedAttributes = match ($tag) {
                'a' => ['href','title','target','rel'],
                'img' => ['src','alt','title','width','height','loading'],
                'ins' => ['class','data-ad-client','data-ad-slot','data-ad-format','data-full-width-responsive'],
                default => ['class','title','role','aria-label'],
            };
            $attributeNames = [];
            foreach ($child->attributes as $attribute) $attributeNames[] = $attribute->name;
            foreach ($attributeNames as $name) {
                $lowerName = strtolower($name);
                $value = trim((string) $child->getAttribute($name));
                $valid = in_array($lowerName, $allowedAttributes, true);
                if ($lowerName === 'class') $valid = $valid && preg_match('/^[A-Za-z0-9 _-]{1,120}$/', $value) === 1;
                if ($lowerName === 'target') $valid = $valid && in_array($value, ['_blank','_self'], true);
                if ($lowerName === 'loading') $valid = $valid && in_array($value, ['lazy','eager'], true);
                if (in_array($lowerName, ['width','height'], true)) $valid = $valid && preg_match('/^[0-9]{1,4}$/', $value) === 1;
                if ($lowerName === 'role') $valid = $valid && in_array($value, ['img','presentation','group'], true);
                if ($lowerName === 'aria-label' || $lowerName === 'title' || $lowerName === 'alt') $valid = $valid && strlen($value) <= 200;
                if (in_array($lowerName, ['href','src'], true)) {
                    $local = str_starts_with($value, '/') && !str_starts_with($value, '//');
                    $remote = preg_match('~^https://~i', $value) === 1;
                    $valid = $valid && ($local || $remote);
                }
                if ($lowerName === 'rel') $valid = $valid && preg_match('/^[A-Za-z0-9 _-]{1,100}$/', $value) === 1;
                if ($lowerName === 'data-ad-client') $valid = $valid && hash_equals($publisherId, $value);
                if ($lowerName === 'data-ad-slot') $valid = $valid && hash_equals($unitId, $value);
                if ($lowerName === 'data-ad-format') $valid = $valid && in_array($value, ['auto','rectangle','horizontal','vertical'], true);
                if ($lowerName === 'data-full-width-responsive') $valid = $valid && in_array($value, ['true','false'], true);
                if (!$valid || str_starts_with($lowerName, 'on')) {
                    $child->removeAttribute($name);
                    continue;
                }
            }
            if ($tag === 'a' && $child->getAttribute('target') === '_blank') $child->setAttribute('rel', 'noopener noreferrer');
            if ($tag === 'img' && $child->getAttribute('src') === '') {
                $parent->removeChild($child);
                continue;
            }
            if ($tag === 'ins') {
                $classes = preg_split('/\s+/', trim($child->getAttribute('class'))) ?: [];
                $validAdUnit = in_array('adsbygoogle', $classes, true)
                    && $child->getAttribute('data-ad-client') === $publisherId
                    && $child->getAttribute('data-ad-slot') === $unitId;
                if (!$validAdUnit) {
                    $parent->removeChild($child);
                    continue;
                }
                $child->setAttribute('style', 'display:block');
                $foundAdUnit = true;
            }
            $sanitizeNode($child);
        }
    };
    $sanitizeNode($root);
    $result = '';
    foreach ($root->childNodes as $child) $result .= $dom->saveHTML($child);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    if (trim($result) === '') throw new RuntimeException('Custom ad markup has no permitted content.');
    if (preg_match('/<ins\b/i', $markup) && !$foundAdUnit) throw new RuntimeException('An AdSense <ins> unit must use this placement’s exact configured publisher and ad-unit IDs.');
    return $result;
}

/** Render only an enabled, web-side slot with real, structurally valid account IDs. */
function render_ad_slot(PDO $pdo, string $placement): string
{
    if (!setting($pdo, 'ads_enabled', false)) return '';
    try {
        $query = $pdo->prepare('SELECT placement,publisher_id,ad_unit_id,ad_format,label,size_preset,show_desktop,show_tablet,show_mobile,custom_markup FROM ad_slots WHERE placement=:placement AND is_enabled=1 LIMIT 1');
        $query->execute(['placement' => $placement]);
        $slot = $query->fetch();
    } catch (Throwable $error) {
        return '';
    }
    if (!$slot || (!(bool) $slot['show_desktop'] && !(bool) $slot['show_tablet'] && !(bool) $slot['show_mobile'])) return '';
    $publisherId = trim((string) $slot['publisher_id']);
    $unitId = trim((string) $slot['ad_unit_id']);
    if (!preg_match('/^ca-pub-[0-9]{16}$/', $publisherId) || !preg_match('/^[0-9]{10,20}$/', $unitId)) return '';
    $format = in_array($slot['ad_format'], ['auto','rectangle','horizontal','vertical'], true) ? $slot['ad_format'] : 'auto';
    $preset = in_array($slot['size_preset'], ['responsive','leaderboard','mobile_banner','medium_rectangle','billboard','skyscraper'], true) ? $slot['size_preset'] : 'responsive';
    $markup = '';
    try {
        $customMarkup = trim((string) ($slot['custom_markup'] ?? ''));
        if ($customMarkup !== '') {
            $markup = sanitize_ad_markup($customMarkup, $publisherId, $unitId);
        } else {
            $markup = '<ins class="adsbygoogle" style="display:block" data-ad-client="' . e($publisherId) . '" data-ad-slot="' . e($unitId) . '" data-ad-format="' . e($format) . '" data-full-width-responsive="true"></ins>';
        }
    } catch (Throwable $error) {
        error_log('Ad markup suppressed for ' . $placement . ': ' . $error->getMessage());
        return '';
    }
    $hasAdSenseUnit = preg_match('/<ins\b[^>]*class="[^"]*\badsbygoogle\b/i', $markup) === 1;
    $visibility = [];
    if ((bool) $slot['show_desktop']) $visibility[] = 'ad-visible--desktop';
    if ((bool) $slot['show_tablet']) $visibility[] = 'ad-visible--tablet';
    if ((bool) $slot['show_mobile']) $visibility[] = 'ad-visible--mobile';
    $label = trim((string) $slot['label']);
    $output = '<aside class="ad-container ad-size--' . e($preset) . ' ' . e(implode(' ', $visibility)) . '" aria-label="Advertisement" data-ad-container data-ad-publisher="' . e($publisherId) . '">';
    if ($label !== '') $output .= '<span class="ad-label">' . e($label) . '</span>';
    $output .= $markup;
    if ($hasAdSenseUnit) {
        $output .= '<script>(function(){var wrap=document.currentScript.closest("[data-ad-container]"),ad=wrap&&wrap.querySelector(".adsbygoogle");if(!ad)return;var push=function(){if(ad.dataset.cmsAdRequested||!ad.isConnected)return;var style=window.getComputedStyle(ad);if(style.display==="none"||ad.getBoundingClientRect().width<1)return;ad.dataset.cmsAdRequested="1";var loader=document.querySelector("script[data-domainfits-ads-loader],script[src^=\"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js\"]");if(!loader){loader=document.createElement("script");loader.async=true;loader.dataset.domainfitsAdsLoader="1";loader.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client="+encodeURIComponent(wrap.dataset.adPublisher||"");loader.crossOrigin="anonymous";document.head.appendChild(loader);}(window.adsbygoogle=window.adsbygoogle||[]).push({});};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",push,{once:true});else push();window.addEventListener("resize",push,{passive:true});})();</script>';
    }
    return $output . '</aside>';
}
