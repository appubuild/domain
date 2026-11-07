<?php
/**
 * Security primitives: tokens, password hashing, HTML sanitising and the
 * script allow-list used for the tracking / verification snippets.
 */

declare(strict_types=1);

namespace Shn\Helpers;

use DOMDocument;
use DOMElement;
use DOMNode;

final class Security
{
    /** Allowed tags for rich-text fields (blog body, pages, descriptions). */
    private const ALLOWED_TAGS = [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4',
        'blockquote', 'a', 'img', 'figure', 'figcaption', 'hr', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'code', 'pre', 'span', 'sup', 'sub',
    ];

    /** Attributes allowed per tag; `*` applies to every allowed tag. */
    private const ALLOWED_ATTRIBUTES = [
        '*' => ['class', 'id'],
        'a' => ['href', 'title', 'target', 'rel'],
        'img' => ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
        'th' => ['colspan', 'rowspan', 'scope'],
        'td' => ['colspan', 'rowspan'],
        'ol' => ['start'],
    ];

    /** Hosts a tracking / verification snippet may reference. */
    private const DEFAULT_SCRIPT_HOSTS = [
        'googletagmanager.com',
        'google-analytics.com',
        'analytics.google.com',
        'google.com',
        'gstatic.com',
        'clarity.ms',
        'facebook.net',
        'connect.facebook.net',
    ];

    /** Tokens that must never appear in an admin-supplied snippet. */
    private const DANGEROUS_PATTERNS = [
        'document.cookie',
        'document.write',
        'localstorage',
        'sessionstorage',
        'eval(',
        'new function',
        'atob(',
        'xmlhttprequest',
        'fetch(',
        'import(',
        'websocket',
        'onerror=',
        'onload=',
        'onclick=',
        'javascript:',
        '<iframe',
        '<object',
        '<embed',
        '<form',
    ];

    /** Inline snippet bodies are only accepted when they use one of these APIs. */
    private const APPROVED_INLINE_APIS = [
        'gtag(',
        'datalayer',
        'ga(',
        'fbq(',
        'clarity(',
        'googletagmanager',
        '_linkedin_partner_id',
        'snaptr(',
        'ttq.',
    ];

    public static function token(int $bytes = 32): string
    {
        return bin2hex(random_bytes($bytes));
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** Stable, non-reversible visitor fingerprint (never stores a raw IP). */
    public static function fingerprintIp(string $ip): string
    {
        return hash_hmac('sha256', $ip, Config::string('app.key', 'shn-local-key'));
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => Config::int('security.bcrypt_cost', 12)]);
    }

    public static function verifyPassword(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_BCRYPT, ['cost' => Config::int('security.bcrypt_cost', 12)]);
    }

    public static function safeEquals(string $known, string $given): bool
    {
        return hash_equals($known, $given);
    }

    /** Strips every tag; used for meta titles, alt text and search excerpts. */
    public static function plainText(?string $html, int $limit = 0): string
    {
        $text = trim(html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $text = preg_replace('/\s+/u', ' ', $text) ?? '';
        if ($limit > 0 && mb_strlen($text) > $limit) {
            $text = rtrim(mb_substr($text, 0, $limit - 1)) . '…';
        }
        return $text;
    }

    /** Escapes text for safe interpolation into HTML attributes / bodies. */
    public static function escape(?string $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /**
     * Allow-list based rich-text sanitiser.
     * Since the public site renders stored HTML, everything else is dropped.
     */
    public static function sanitizeHtml(?string $html): string
    {
        $html = trim((string) $html);
        if ($html === '') {
            return '';
        }

        $document = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML(
            '<?xml encoding="UTF-8"?><div id="shn-root">' . $html . '</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NONET,
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $root = $document->getElementById('shn-root');
        if (!$root instanceof DOMElement) {
            return self::escape(self::plainText($html));
        }

        self::cleanNode($root);

        $output = '';
        foreach ($root->childNodes as $child) {
            $output .= $document->saveHTML($child);
        }

        return trim($output);
    }

    private static function cleanNode(DOMNode $node): void
    {
        if (!$node->hasChildNodes()) {
            return;
        }

        // Iterate over a snapshot: removing nodes while walking invalidates live lists.
        $children = iterator_to_array($node->childNodes);
        foreach ($children as $child) {
            if ($child instanceof DOMElement) {
                $tag = strtolower($child->tagName);

                if (!in_array($tag, self::ALLOWED_TAGS, true)) {
                    // Keep the inner text of unknown wrappers, drop the wrapper.
                    $text = $child->textContent;
                    $replacement = $node->ownerDocument->createTextNode((string) $text);
                    $node->replaceChild($replacement, $child);
                    continue;
                }

                $allowed = array_merge(
                    self::ALLOWED_ATTRIBUTES['*'],
                    self::ALLOWED_ATTRIBUTES[$tag] ?? [],
                );

                foreach (iterator_to_array($child->attributes) as $attribute) {
                    $name = strtolower($attribute->name);
                    if (!in_array($name, $allowed, true)) {
                        $child->removeAttribute($attribute->name);
                        continue;
                    }
                    if (in_array($name, ['href', 'src'], true) && !self::isSafeUrl($attribute->value)) {
                        $child->removeAttribute($attribute->name);
                    }
                }

                if ($tag === 'a' && $child->getAttribute('target') === '_blank') {
                    $child->setAttribute('rel', 'noopener noreferrer');
                }

                self::cleanNode($child);
                continue;
            }

            if ($child->nodeType === XML_COMMENT_NODE) {
                $node->removeChild($child);
            }
        }
    }

    public static function isSafeUrl(string $url): bool
    {
        $url = trim($url);
        if ($url === '') {
            return false;
        }
        if (str_starts_with($url, '/') && !str_starts_with($url, '//')) {
            return true;
        }
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        return in_array($scheme, ['http', 'https', 'mailto', 'tel'], true);
    }

    /**
     * Validates an admin-supplied tracking / verification snippet.
     *
     * @return array{ok:bool,reason:string,clean:string}
     */
    public static function validateSnippet(string $snippet, string $slot = 'header'): array
    {
        $snippet = trim($snippet);
        if ($snippet === '') {
            return ['ok' => true, 'reason' => '', 'clean' => ''];
        }

        if (mb_strlen($snippet) > 8000) {
            return ['ok' => false, 'reason' => 'Snippet is longer than 8,000 characters.', 'clean' => ''];
        }

        $lower = mb_strtolower($snippet);
        foreach (self::DANGEROUS_PATTERNS as $pattern) {
            if (str_contains($lower, $pattern)) {
                return [
                    'ok' => false,
                    'reason' => 'Snippet contains a disallowed construct: "' . $pattern . '".',
                    'clean' => '',
                ];
            }
        }

        // Every <script src> must point at an approved host.
        if (preg_match_all('/<script\b[^>]*\bsrc\s*=\s*["\']([^"\']+)["\']/i', $snippet, $matches)) {
            $hosts = array_map('strtolower', Config::array('security.script_hosts')) ?: self::DEFAULT_SCRIPT_HOSTS;
            foreach ($matches[1] as $source) {
                $host = strtolower((string) parse_url($source, PHP_URL_HOST));
                $scheme = strtolower((string) parse_url($source, PHP_URL_SCHEME));
                if ($scheme !== 'https' || $host === '' || !self::hostAllowed($host, $hosts)) {
                    return [
                        'ok' => false,
                        'reason' => 'Script source is not on the approved list: ' . $source,
                        'clean' => '',
                    ];
                }
            }
        }

        // Inline script bodies must use a recognised analytics API only.
        if (preg_match_all('/<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)<\/script>/is', $snippet, $inline)) {
            foreach ($inline[1] as $body) {
                $bodyLower = mb_strtolower($body);
                $approved = false;
                foreach (self::APPROVED_INLINE_APIS as $api) {
                    if (str_contains($bodyLower, $api)) {
                        $approved = true;
                        break;
                    }
                }
                if (!$approved) {
                    return [
                        'ok' => false,
                        'reason' => 'Inline scripts must be a recognised analytics/tag-manager snippet.',
                        'clean' => '',
                    ];
                }
            }
        }

        // Only script/meta/link/noscript tags are permitted in a snippet.
        if (preg_match_all('/<\s*([a-zA-Z][a-zA-Z0-9]*)/', $snippet, $tags)) {
            $permitted = ['script', 'meta', 'link', 'noscript', 'style'];
            foreach ($tags[1] as $tag) {
                if (!in_array(strtolower($tag), $permitted, true)) {
                    return [
                        'ok' => false,
                        'reason' => 'Snippets may only contain script, meta, link, style and noscript tags (found <' . $tag . '>).',
                        'clean' => '',
                    ];
                }
            }
        }

        if (preg_match('/<meta\b[^>]*name\s*=\s*["\']google-site-verification["\']/i', $snippet) && $slot !== 'header') {
            return ['ok' => false, 'reason' => 'Google verification tags belong in the header slot.', 'clean' => ''];
        }

        return ['ok' => true, 'reason' => '', 'clean' => $snippet];
    }

    /** @param array<int,string> $allowed */
    private static function hostAllowed(string $host, array $allowed): bool
    {
        foreach ($allowed as $candidate) {
            $candidate = strtolower(trim($candidate));
            if ($candidate === '') {
                continue;
            }
            if ($host === $candidate || str_ends_with($host, '.' . $candidate)) {
                return true;
            }
        }
        return false;
    }

    /** Validates a GA4/GTM measurement id. */
    public static function isValidMeasurementId(string $value): bool
    {
        return (bool) preg_match('/^(G-[A-Z0-9]{4,12}|GTM-[A-Z0-9]{4,10}|UA-\d{4,10}-\d{1,4}|AW-\d{6,12})$/i', $value);
    }

    /** Last-resort guard for uploads. */
    public static function isSafeFilename(string $name): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/', $name)
            && !str_contains($name, '..');
    }
}
