<?php
declare(strict_types=1);

function dfo_default_options(): array
{
    return [
        'minify_html' => false,
        'minify_inline_css' => false,
        'minify_inline_js' => false,
        'minify_local_css' => false,
        'minify_local_js' => false,
        'font_display_swap' => false,
        'lazy_images' => false,
        'image_dimensions' => false,
        'webp_conversion' => false,
        'webp_quality' => 82,
        'image_max_dimension' => 1600,
        'preload_home_hero' => false,
        'defer_local_scripts' => false,
        'gzip_compression' => false,
        'page_cache' => false,
        'page_cache_ttl' => 120,
    ];
}

function dfo_normalize_options(array $input): array
{
    $options = dfo_default_options();
    foreach (array_keys($options) as $key) {
        if (!array_key_exists($key, $input)) continue;
        if (is_bool($options[$key])) {
            $value = filter_var($input[$key], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            $options[$key] = $value ?? false;
        } elseif ($key === 'webp_quality') {
            $options[$key] = max(60, min(92, (int) $input[$key]));
        } elseif ($key === 'image_max_dimension') {
            $options[$key] = max(640, min(2400, (int) $input[$key]));
        } elseif ($key === 'page_cache_ttl') {
            $options[$key] = max(30, min(900, (int) $input[$key]));
        }
    }
    return $options;
}

function dfo_options(): array
{
    $options = $GLOBALS['_dfo_options'] ?? null;
    return is_array($options) ? $options : dfo_default_options();
}

function dfo_is_public_html_request(?array $context = null): bool
{
    $context ??= df_request_context();
    if (($context['is_cli'] ?? false) || ($context['is_admin'] ?? false) || ($context['method'] ?? '') !== 'GET') return false;
    $path = strtolower((string) ($context['path'] ?? '/'));
    if ($path === '/admin' || str_starts_with($path, '/api/') || str_starts_with($path, '/go/') || rtrim($path, '/') === '/optimizer-asset'
        || in_array($path, ['/robots.txt','/sitemap.xml','/ads.txt'], true)
        || preg_match('/\.(?:json|xml|txt|css|js|jpe?g|png|webp|svg|ico|woff2?)$/i', $path)
    ) return false;
    return true;
}

function dfo_is_page_cacheable_request(): bool
{
    $context = df_request_context();
    if (!dfo_is_public_html_request($context) || $context['query'] !== '' || !empty($_COOKIE)
        || !empty($_SERVER['HTTP_AUTHORIZATION'])
    ) return false;
    $path = strtolower((string) $context['path']);
    return $path === '/' || $path === '/blog' || $path === '/blog/'
        || preg_match('~^/blog/[a-z0-9-]+/?$~', $path) === 1
        || preg_match('~^/pages/[a-z0-9-]+/?$~', $path) === 1
        || preg_match('~^/(?:about|privacy-policy|terms-and-conditions|disclaimer)/?$~', $path) === 1;
}

function dfo_cache_directory(string $kind): string
{
    $safeKind = in_array($kind, ['pages','assets'], true) ? $kind : 'pages';
    return df_app_root() . '/storage/cache/speed-optimizer/' . $safeKind;
}

function dfo_cache_path_is_safe(string $path): bool
{
    $appRoot = df_app_root();
    $rootPrefix = rtrim($appRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (!str_starts_with($path, $rootPrefix) || is_link($appRoot)) return false;
    $relative = substr($path, strlen($rootPrefix));
    $allowedRoot = 'storage' . DIRECTORY_SEPARATOR . 'cache' . DIRECTORY_SEPARATOR . 'speed-optimizer';
    if ($relative !== $allowedRoot && !str_starts_with($relative, $allowedRoot . DIRECTORY_SEPARATOR)) return false;
    $current = rtrim($appRoot, DIRECTORY_SEPARATOR);
    foreach (explode(DIRECTORY_SEPARATOR, $relative) as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..') return false;
        $current .= DIRECTORY_SEPARATOR . $segment;
        if (is_link($current)) return false;
    }
    return true;
}

function dfo_ensure_cache_directory(string $directory): bool
{
    if (!dfo_cache_path_is_safe($directory)) return false;
    if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) return false;
    @chmod($directory, 0750);
    return dfo_cache_path_is_safe($directory) && is_writable($directory);
}

function dfo_page_cache_path(): string
{
    $path = (string) (df_request_context()['path'] ?? '/');
    return dfo_cache_directory('pages') . '/' . hash('sha256', $path) . '.html';
}

function dfo_clear_page_cache(): void
{
    $directory = dfo_cache_directory('pages');
    if (!dfo_cache_path_is_safe($directory) || !is_dir($directory)) return;
    foreach (glob($directory . '/*.html') ?: [] as $file) {
        if (is_file($file) && !is_link($file)) @unlink($file);
    }
}

function dfo_clear_optimizer_cache_for_lifecycle(string $slug): void
{
    if ($slug !== 'speed-optimizer') return;
    foreach (['pages','assets'] as $kind) {
        $directory = dfo_cache_directory($kind);
        if (!dfo_cache_path_is_safe($directory) || !is_dir($directory)) continue;
        foreach (glob($directory . '/*') ?: [] as $file) {
            if (is_file($file) && !is_link($file)) @unlink($file);
        }
    }
}

function dfo_write_page_cache(string $html): void
{
    if (!dfo_options()['page_cache'] || !dfo_is_page_cacheable_request() || strlen($html) > 4 * 1024 * 1024) return;
    $status = http_response_code();
    if ($status !== false && $status !== 200) return;
    foreach (headers_list() as $header) {
        if (stripos($header, 'Set-Cookie:') === 0 || stripos($header, 'Location:') === 0) return;
        if (stripos($header, 'Content-Type:') === 0 && stripos($header, 'text/html') === false) return;
        if (stripos($header, 'Cache-Control:') === 0 && preg_match('/(?:^|,)\\s*(?:private|no-store|no-cache)\\b/i', substr($header, strlen('Cache-Control:')))) return;
        if (stripos($header, 'Pragma:') === 0 && stripos($header, 'no-cache') !== false) return;
        if (stripos($header, 'Vary:') === 0 && !in_array(strtolower(trim(substr($header, strlen('Vary:')))), ['', 'accept-encoding'], true)) return;
    }
    $path = dfo_page_cache_path();
    if (!dfo_ensure_cache_directory(dirname($path))) return;
    $temporary = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (@file_put_contents($temporary, $html, LOCK_EX) !== false) {
        @chmod($temporary, 0640);
        if (!@rename($temporary, $path)) @unlink($temporary);
    }
    if (is_file($path)) {
        header('X-DF-Page-Cache: MISS');
        header('Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=30');
        if (dfo_options()['gzip_compression']) header('Vary: Accept-Encoding', false);
    }
}

function dfo_accepts_gzip(): bool
{
    $header = strtolower((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''));
    foreach (explode(',', $header) as $encoding) {
        $parts = array_map('trim', explode(';', $encoding));
        if (($parts[0] ?? '') !== 'gzip') continue;
        $quality = 1.0;
        foreach (array_slice($parts, 1) as $parameter) {
            if (preg_match('/^q=([0-9.]+)$/', $parameter, $match)) $quality = (float) $match[1];
        }
        return $quality > 0;
    }
    return false;
}

function dfo_zlib_output_enabled(): bool
{
    return !in_array(strtolower(trim((string) ini_get('zlib.output_compression'))), ['', '0', 'off', 'false'], true);
}

function dfo_start_gzip_buffer(): void
{
    if (!dfo_options()['gzip_compression'] || !function_exists('ob_gzhandler')
        || dfo_zlib_output_enabled() || ob_get_level() !== 0 || headers_sent()
    ) return;
    ob_start('ob_gzhandler');
}

function dfo_serve_cached_page_if_fresh(): bool
{
    if (!dfo_options()['page_cache'] || !dfo_is_page_cacheable_request()) return false;
    $path = dfo_page_cache_path();
    $ttl = (int) dfo_options()['page_cache_ttl'];
    if (!dfo_cache_path_is_safe(dirname($path)) || !is_file($path) || is_link($path)
        || (time() - (int) @filemtime($path)) > $ttl
    ) return false;
    $size = (int) @filesize($path);
    if ($size < 1 || $size > 4 * 1024 * 1024) return false;
    $html = @file_get_contents($path);
    if (!is_string($html) || strlen($html) !== $size) return false;
    $etag = '"' . hash('sha256', $html) . '"';
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=30');
    header('ETag: ' . $etag);
    header('X-DF-Page-Cache: HIT');
    if (dfo_options()['gzip_compression']) header('Vary: Accept-Encoding');
    if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
        http_response_code(304);
        exit;
    }
    dfo_start_gzip_buffer();
    echo $html;
    exit;
}

function dfo_before_request(PDO $pdo): void
{
    if (!dfo_is_public_html_request()) return;
    if (dfo_serve_cached_page_if_fresh()) return;
    $options = dfo_options();
    $needsBuffer = $options['minify_html'] || $options['minify_inline_css'] || $options['minify_inline_js']
        || $options['lazy_images'] || $options['image_dimensions'] || $options['webp_conversion']
        || $options['defer_local_scripts'] || ($options['page_cache'] && dfo_is_page_cacheable_request())
        || $options['gzip_compression'] || $options['font_display_swap'];
    if (!$needsBuffer) return;
    dfo_start_gzip_buffer();
    df_start_response_buffer();
}

function dfo_filter_asset_url(string $url, string $relativePath, string $diskPath): string
{
    $options = dfo_options();
    if (df_request_context()['is_admin'] ?? false) return $url;
    $kind = '';
    if (($options['minify_local_css'] || $options['font_display_swap']) && str_starts_with($relativePath, 'assets/css/') && str_ends_with(strtolower($relativePath), '.css')) {
        $kind = 'css';
    } elseif ($options['minify_local_js'] && str_starts_with($relativePath, 'assets/js/') && str_ends_with(strtolower($relativePath), '.js')) {
        $kind = 'js';
    }
    if ($kind === '' || !is_file($diskPath) || !is_readable($diskPath)) return $url;
    $sourceHash = @hash_file('sha256', $diskPath);
    if (!is_string($sourceHash)) return $url;
    $version = dfo_asset_version($sourceHash, $kind, $options);
    return app_url('optimizer-asset?kind=' . rawurlencode($kind) . '&file=' . rawurlencode($relativePath) . '&v=' . $version);
}

function dfo_asset_version(string $sourceHash, string $kind, array $options): string
{
    $transform = $kind === 'css'
        ? ['minify_local_css' => (bool) $options['minify_local_css'], 'font_display_swap' => (bool) $options['font_display_swap']]
        : ['minify_local_js' => (bool) $options['minify_local_js']];
    $transform['optimizer'] = 'speed-optimizer-1';
    return hash('sha256', $sourceHash . '|' . $kind . '|' . json_encode($transform));
}

function dfo_serve_asset(mixed $response, PDO $pdo, string $kind, string $relativePath, string $version): mixed
{
    $options = dfo_options();
    $enabled = ($kind === 'css' && ($options['minify_local_css'] || $options['font_display_swap']))
        || ($kind === 'js' && $options['minify_local_js']);
    if (!$enabled || !in_array($kind, ['css','js'], true) || strlen($relativePath) > 240
        || str_contains($relativePath, '..') || str_contains($relativePath, '\\') || str_starts_with($relativePath, '/')
        || !preg_match('~^assets/' . ($kind === 'css' ? 'css' : 'js') . '/[A-Za-z0-9._/-]+\.' . $kind . '$~', $relativePath)
        || preg_match('/^[a-f0-9]{64}$/', $version) !== 1
    ) return $response;
    $appRoot = realpath(df_app_root());
    $sourceCandidate = df_app_root() . '/' . $relativePath;
    $source = realpath($sourceCandidate);
    if ($appRoot === false || $source === false || !is_file($source) || is_link($sourceCandidate) || is_link($source)
        || !str_starts_with($source, $appRoot . DIRECTORY_SEPARATOR) || filesize($source) > 5 * 1024 * 1024
    ) return $response;
    $sourceHash = @hash_file('sha256', $source);
    if (!is_string($sourceHash) || !hash_equals(dfo_asset_version($sourceHash, $kind, $options), $version)) return $response;

    $cachePath = dfo_cache_directory('assets') . '/' . $version . '.' . $kind;
    if (!dfo_cache_path_is_safe(dirname($cachePath))) return $response;
    if (!is_file($cachePath) || is_link($cachePath)) {
        $sourceText = @file_get_contents($source);
        if (!is_string($sourceText)) return $response;
        if ($kind === 'css') {
            $optimized = $options['minify_local_css']
                ? dfo_minify_css($sourceText, (bool) $options['font_display_swap'])
                : dfo_add_font_display_swap($sourceText);
        } else {
            $optimized = dfo_minify_js($sourceText);
        }
        if (!dfo_ensure_cache_directory(dirname($cachePath))) return $response;
        $temporary = $cachePath . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (@file_put_contents($temporary, $optimized, LOCK_EX) === false) return $response;
        @chmod($temporary, 0640);
        if (!@rename($temporary, $cachePath)) @unlink($temporary);
    }
    $body = @file_get_contents($cachePath);
    if (!is_string($body)) return $response;
    $etag = '"' . $version . '"';
    header('Content-Type: ' . ($kind === 'css' ? 'text/css' : 'application/javascript') . '; charset=UTF-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: public, max-age=31536000, immutable');
    header('ETag: ' . $etag);
    if (dfo_options()['gzip_compression']) header('Vary: Accept-Encoding');
    if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
        http_response_code(304);
        return ['body' => '', 'content_type' => $kind === 'css' ? 'text/css' : 'application/javascript', 'status' => 304];
    }
    if (dfo_options()['gzip_compression'] && dfo_accepts_gzip() && function_exists('gzencode')
        && !dfo_zlib_output_enabled()
    ) {
        $compressed = @gzencode($body, 6, FORCE_GZIP);
        if (is_string($compressed)) {
            header('Content-Encoding: gzip');
            $body = $compressed;
        }
    }
    header('Content-Length: ' . strlen($body));
    return ['body' => $body, 'content_type' => $kind === 'css' ? 'text/css' : 'application/javascript', 'status' => 200];
}

function dfo_add_font_display_swap(string $css): string
{
    return preg_replace_callback('~@font-face\s*\{([^{}]*)\}~is', static function (array $match): string {
        if (preg_match('/(?:^|;)\s*font-display\s*:/i', $match[1])) return $match[0];
        return rtrim(substr($match[0], 0, -1)) . ';font-display:swap}';
    }, $css) ?? $css;
}

function dfo_minify_css(string $css, bool $fontDisplaySwap = false): string
{
    if ($fontDisplaySwap) $css = dfo_add_font_display_swap($css);
    $length = strlen($css);
    $output = '';
    $quote = '';
    $escaped = false;
    $pendingSpace = false;
    for ($index = 0; $index < $length; $index++) {
        $character = $css[$index];
        if ($quote !== '') {
            $output .= $character;
            if ($escaped) $escaped = false;
            elseif ($character === '\\') $escaped = true;
            elseif ($character === $quote) $quote = '';
            continue;
        }
        if (($character === '"' || $character === "'") && !$escaped) {
            if ($pendingSpace && $output !== '' && !str_contains('{}:;,>', substr($output, -1))) $output .= ' ';
            $pendingSpace = false;
            $quote = $character;
            $output .= $character;
            continue;
        }
        if ($character === '/' && ($css[$index + 1] ?? '') === '*') {
            $end = strpos($css, '*/', $index + 2);
            if ($end === false) return $css;
            if (($css[$index + 2] ?? '') === '!') {
                $output .= substr($css, $index, $end + 2 - $index);
            }
            $index = $end + 1;
            continue;
        }
        if (ctype_space($character)) {
            $pendingSpace = true;
            continue;
        }
        if ($pendingSpace && $output !== '') {
            $previous = substr($output, -1);
            $punctuation = '{}:;,>';
            if (!str_contains($punctuation, $previous) && !str_contains($punctuation, $character)) $output .= ' ';
        }
        $pendingSpace = false;
        $output .= $character;
    }
    $output = trim($output);
    return preg_replace('/;\s*}/', '}', $output) ?? $output;
}

function dfo_minify_js(string $javascript): string
{
    // Template literals are kept byte-for-byte; the conservative lexer below targets ordinary scripts.
    if (str_contains($javascript, '`')) return $javascript;
    $length = strlen($javascript);
    $output = '';
    $quote = '';
    $escaped = false;
    $pendingSpace = false;
    $canStartRegex = true;
    $safeToMinify = true;
    $keywordsAllowRegex = ['return','throw','case','delete','void','typeof','new','in','of','yield','await','else','do','instanceof'];
    for ($index = 0; $index < $length; $index++) {
        $character = $javascript[$index];
        if ($quote !== '') {
            $output .= $character;
            if ($escaped) $escaped = false;
            elseif ($character === '\\') $escaped = true;
            elseif ($character === $quote) { $quote = ''; $canStartRegex = false; }
            continue;
        }
        if ($character === '"' || $character === "'") {
            if ($pendingSpace && $output !== '' && preg_match('/[A-Za-z0-9_$]$/', $output)) $output .= ' ';
            $pendingSpace = false;
            $quote = $character;
            $output .= $character;
            continue;
        }
        if ($character === '/' && ($javascript[$index + 1] ?? '') === '/') {
            $pendingSpace = true;
            while ($index + 1 < $length && $javascript[$index + 1] !== "\n" && $javascript[$index + 1] !== "\r") $index++;
            continue;
        }
        if ($character === '/' && ($javascript[$index + 1] ?? '') === '*') {
            $end = strpos($javascript, '*/', $index + 2);
            if ($end === false) { $output .= substr($javascript, $index); break; }
            $comment = substr($javascript, $index, $end + 2 - $index);
            if (($javascript[$index + 2] ?? '') === '!') $output .= $comment;
            else $pendingSpace = true;
            $index = $end + 1;
            continue;
        }
        if ($character === '/' && $canStartRegex && ($javascript[$index + 1] ?? '') !== '/' && ($javascript[$index + 1] ?? '') !== '*') {
            if ($pendingSpace && $output !== '' && preg_match('/[A-Za-z0-9_$]$/', $output)) $output .= ' ';
            $pendingSpace = false;
            $output .= '/';
            $inClass = false;
            $regexEscaped = false;
            for ($index = $index + 1; $index < $length; $index++) {
                $regexCharacter = $javascript[$index];
                $output .= $regexCharacter;
                if ($regexEscaped) { $regexEscaped = false; continue; }
                if ($regexCharacter === '\\') { $regexEscaped = true; continue; }
                if ($regexCharacter === '[') { $inClass = true; continue; }
                if ($regexCharacter === ']') { $inClass = false; continue; }
                if ($regexCharacter === '/' && !$inClass) break;
                if ($regexCharacter === "\n" || $regexCharacter === "\r") break;
            }
            while ($index + 1 < $length && preg_match('/[A-Za-z]/', $javascript[$index + 1])) {
                $index++;
                $output .= $javascript[$index];
            }
            $canStartRegex = false;
            continue;
        }
        if ($character === "\n" || $character === "\r") {
            $pendingSpace = false;
            if ($output !== '' && !str_ends_with($output, "\n") && !str_ends_with($output, "\r")) $output .= $character;
            continue;
        }
        if (ctype_space($character)) {
            $pendingSpace = true;
            continue;
        }
        if (preg_match('/[A-Za-z0-9_$]/', $character)) {
            $token = $character;
            while ($index + 1 < $length && preg_match('/[A-Za-z0-9_$]/', $javascript[$index + 1])) {
                $token .= $javascript[++$index];
            }
            if ($pendingSpace && $output !== '' && preg_match('/[A-Za-z0-9_$]$/', $output)) $output .= ' ';
            elseif ($pendingSpace && $output !== '' && in_array(substr($output, -1), ['+','-'], true)) $output .= ' ';
            $pendingSpace = false;
            $output .= $token;
            $canStartRegex = in_array($token, $keywordsAllowRegex, true);
            continue;
        }
        if ($pendingSpace && $output !== '') {
            $previous = substr($output, -1);
            $operators = '+-*/%=!<>&|^?';
            if (str_contains($operators, $previous) && str_contains($operators, $character)) $output .= ' ';
        }
        $pendingSpace = false;
        $output .= $character;
        if (str_contains(')]}', $character) || $character === '.') $canStartRegex = false;
        elseif (str_contains('([{,:;=!?+-*%&|^~<>', $character)) $canStartRegex = true;
        elseif ($character === '/') { $canStartRegex = true; $safeToMinify = false; }
    }
    return $safeToMinify ? trim($output) : $javascript;
}

function dfo_minify_inline_blocks(string $html): string
{
    $options = dfo_options();
    if ($options['minify_inline_css'] || $options['font_display_swap']) {
        $html = preg_replace_callback('~(<style\b[^>]*>)(.*?)(</style\s*>)~is', static function (array $match) use ($options): string {
            $css = $options['minify_inline_css'] ? dfo_minify_css($match[2]) : $match[2];
            if ($options['font_display_swap']) $css = dfo_add_font_display_swap($css);
            return $match[1] . $css . $match[3];
        }, $html) ?? $html;
    }
    if ($options['minify_inline_js']) {
        $html = preg_replace_callback('~(<script\b([^>]*)>)(.*?)(</script\s*>)~is', static function (array $match): string {
            if (preg_match('/\bsrc\s*=|\btype\s*=\s*(["\'])(?:application\/(?:ld\+json|json)|importmap|speculationrules)\1/i', $match[2])) return $match[0];
            return $match[1] . dfo_minify_js($match[3]) . $match[4];
        }, $html) ?? $html;
    }
    return $html;
}

function dfo_minify_html(string $html): string
{
    $preserved = [];
    $html = preg_replace_callback('~<(script|style|pre|textarea|code|svg|math|noscript|template)\b[^>]*>.*?</\1\s*>~is', static function (array $match) use (&$preserved): string {
        $key = 'DFOPRESERVE' . bin2hex(random_bytes(8)) . 'TOKEN';
        $preserved[$key] = $match[0];
        return $key;
    }, $html) ?? $html;
    $html = preg_replace('~<!--(?!(?:\s*\[if\b|\s*<!\[endif\b))[\s\S]*?-->~i', '', $html) ?? $html;
    // Keep one whitespace character between tags so inline text does not become concatenated.
    $html = preg_replace('/>[\t\r\n ]+</u', '> <', $html) ?? $html;
    $html = trim($html);
    foreach ($preserved as $key => $block) $html = str_replace($key, $block, $html);
    return $html;
}

function dfo_attr_value(string $tag, string $attribute): ?string
{
    $pattern = '~(?:^|\s)' . preg_quote($attribute, '~') . '\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))~i';
    if (!preg_match($pattern, $tag, $match)) return null;
    $value = $match[1] !== '' ? $match[1] : ($match[2] !== '' ? $match[2] : ($match[3] ?? ''));
    return html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function dfo_set_attr(string $tag, string $attribute, string $value): string
{
    $escapedValue = htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $pattern = '~\s' . preg_quote($attribute, '~') . '\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s>]+)~i';
    if (preg_match($pattern, $tag)) {
        return preg_replace($pattern, ' ' . $attribute . '="' . $escapedValue . '"', $tag, 1) ?? $tag;
    }
    $insertAt = strrpos($tag, '/>');
    if ($insertAt === false) $insertAt = strrpos($tag, '>');
    if ($insertAt === false) return $tag;
    return substr($tag, 0, $insertAt) . ' ' . $attribute . '="' . $escapedValue . '"' . substr($tag, $insertAt);
}

function dfo_local_image_info(string $url): ?array
{
    $decoded = html_entity_decode(trim($url), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $parts = parse_url($decoded);
    if (!is_array($parts) || isset($parts['scheme']) || isset($parts['host'])) return null;
    $path = rawurldecode((string) ($parts['path'] ?? ''));
    $base = app_base_path();
    if ($base !== '' && ($path === $base || str_starts_with($path, $base . '/'))) $path = substr($path, strlen($base));
    $relative = ltrim($path, '/');
    if ($relative === '' || str_contains($relative, '..') || str_contains($relative, '\\')
        || (!str_starts_with($relative, 'uploads/') && !str_starts_with($relative, 'assets/img/'))
    ) return null;
    $appRoot = realpath(df_app_root());
    $disk = realpath(df_app_root() . '/' . $relative);
    if ($appRoot === false || $disk === false || is_link($disk) || !is_file($disk)
        || !str_starts_with($disk, $appRoot . DIRECTORY_SEPARATOR)
    ) return null;
    return ['relative' => $relative, 'disk' => $disk, 'url_path' => $path];
}

function dfo_update_image_tag(string $tag): string
{
    $options = dfo_options();
    if (preg_match('/\bdata-no-optimize\b/i', $tag)) return $tag;
    $src = dfo_attr_value($tag, 'src');
    $info = $src !== null ? dfo_local_image_info($src) : null;
    $isBrandAsset = $info !== null && (str_starts_with($info['relative'], 'uploads/brand/') || preg_match('~(?:^|/)logo(?:[-._]|$)~i', $info['relative']) === 1);
    $preloadedHero = (string) ($GLOBALS['_dfo_preloaded_hero_url'] ?? '');
    $isLcpImage = $preloadedHero !== '' && $src !== null && hash_equals($preloadedHero, $src);
    if ($options['lazy_images'] && !$isBrandAsset && !$isLcpImage && dfo_attr_value($tag, 'loading') === null) $tag = dfo_set_attr($tag, 'loading', 'lazy');
    if ($isLcpImage && dfo_attr_value($tag, 'fetchpriority') === null) $tag = dfo_set_attr($tag, 'fetchpriority', 'high');
    if ($options['image_dimensions'] && $info !== null && (dfo_attr_value($tag, 'width') === null || dfo_attr_value($tag, 'height') === null)) {
        $dimensions = @getimagesize($info['disk']);
        if (is_array($dimensions) && (int) $dimensions[0] > 0 && (int) $dimensions[1] > 0) {
            if (dfo_attr_value($tag, 'width') === null) $tag = dfo_set_attr($tag, 'width', (string) (int) $dimensions[0]);
            if (dfo_attr_value($tag, 'height') === null) $tag = dfo_set_attr($tag, 'height', (string) (int) $dimensions[1]);
        }
    }
    if ($info !== null && $options['webp_conversion'] && dfo_attr_value($tag, 'srcset') === null) {
        $webpPath = $info['disk'] . '.webp';
        if (is_file($webpPath) && !is_link($webpPath) && @getimagesize($webpPath) !== false) {
            $webpRelative = $info['relative'] . '.webp';
            $tag = dfo_set_attr($tag, 'srcset', app_url($webpRelative) . ' 1x');
        }
    }
    if ($options['lazy_images'] && dfo_attr_value($tag, 'decoding') === null) $tag = dfo_set_attr($tag, 'decoding', 'async');
    return $tag;
}

function dfo_transform_html(string $html, array $context = []): string
{
    if (!dfo_is_public_html_request($context) || $html === '') return $html;
    $options = dfo_options();
    if ($options['minify_inline_css'] || $options['minify_inline_js'] || $options['font_display_swap']) $html = dfo_minify_inline_blocks($html);
    if ($options['lazy_images'] || $options['image_dimensions'] || $options['webp_conversion']) {
        $html = preg_replace_callback('~<img\b[^>]*>~i', static fn(array $match): string => dfo_update_image_tag($match[0]), $html) ?? $html;
    }
    if ($options['defer_local_scripts']) {
        $html = preg_replace_callback('~<script\b[^>]*>~i', static function (array $match): string {
            $tag = $match[0];
            $src = dfo_attr_value($tag, 'src');
            if ($src === null || dfo_attr_value($tag, 'async') !== null || dfo_attr_value($tag, 'defer') !== null
                || dfo_attr_value($tag, 'type') === 'module' || !str_contains($src, '/assets/js/')
            ) return $tag;
            return dfo_set_attr($tag, 'defer', 'defer');
        }, $html) ?? $html;
    }
    if ($options['minify_html']) $html = dfo_minify_html($html);
    dfo_write_page_cache($html);
    return $html;
}

function dfo_real_upload_path(string $path): ?array
{
    $appRoot = realpath(df_app_root());
    $uploadsCandidate = df_app_root() . '/uploads';
    $realPath = realpath($path);
    $uploadsRoot = realpath($uploadsCandidate);
    if ($appRoot === false || $realPath === false || $uploadsRoot === false || is_link($uploadsCandidate) || is_link($path)
        || !is_file($realPath) || !str_starts_with($uploadsRoot, $appRoot . DIRECTORY_SEPARATOR)
        || !str_starts_with($realPath, $uploadsRoot . DIRECTORY_SEPARATOR)
    ) return null;
    return ['app_root' => $appRoot, 'file' => $realPath];
}

function dfo_convert_image_to_webp(string $source, int $quality, int $maxDimension): ?string
{
    if (!function_exists('imagewebp') || !function_exists('imagecreatefromstring')) return null;
    $safeSource = dfo_real_upload_path($source);
    if ($safeSource === null) return null;
    $source = $safeSource['file'];
    $size = (int) @filesize($source);
    if ($size < 1 || $size > 20 * 1024 * 1024) return null;
    $info = @getimagesize($source);
    if (!is_array($info) || empty($info[0]) || empty($info[1]) || (int) $info[0] * (int) $info[1] > 8000000) return null;
    $mime = (string) ($info['mime'] ?? '');
    if (!in_array($mime, ['image/jpeg','image/png','image/webp'], true) || $mime === 'image/webp') return null;
    $bytes = @file_get_contents($source);
    if (!is_string($bytes)) return null;
    $original = @imagecreatefromstring($bytes);
    if (!($original instanceof GdImage)) return null;
    $width = imagesx($original); $height = imagesy($original);
    if ($width < 1 || $height < 1) { imagedestroy($original); return null; }
    $scale = min(1.0, $maxDimension / max($width, $height));
    $targetWidth = max(1, (int) round($width * $scale));
    $targetHeight = max(1, (int) round($height * $scale));
    $targetImage = imagecreatetruecolor($targetWidth, $targetHeight);
    if (!($targetImage instanceof GdImage)) { imagedestroy($original); return null; }
    if ($mime === 'image/png') {
        imagealphablending($targetImage, false);
        imagesavealpha($targetImage, true);
        $transparent = imagecolorallocatealpha($targetImage, 0, 0, 0, 127);
        imagefilledrectangle($targetImage, 0, 0, $targetWidth, $targetHeight, $transparent);
    }
    $resampled = imagecopyresampled($targetImage, $original, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);
    imagedestroy($original);
    if (!$resampled) { imagedestroy($targetImage); return null; }
    $destination = $source . '.webp';
    if (is_file($destination) && !is_link($destination) && (int) @filemtime($destination) >= (int) @filemtime($source)) {
        imagedestroy($targetImage);
        return $destination;
    }
    $temporary = $destination . '.' . bin2hex(random_bytes(5)) . '.tmp.webp';
    $written = @imagewebp($targetImage, $temporary, max(60, min(92, $quality)));
    imagedestroy($targetImage);
    if (!$written || !is_file($temporary) || filesize($temporary) < 1) {
        @unlink($temporary);
        return null;
    }
    @chmod($temporary, 0640);
    if (!@rename($temporary, $destination)) { @unlink($temporary); return null; }
    return $destination;
}

function dfo_optimize_uploaded_image(string $path, string $mime, string $relativeDirectory): void
{
    $options = dfo_options();
    if (!$options['webp_conversion'] || !in_array($mime, ['image/jpeg','image/png'], true)) return;
    $safe = dfo_real_upload_path($path);
    if ($safe === null) return;
    dfo_convert_image_to_webp($safe['file'], (int) $options['webp_quality'], (int) $options['image_max_dimension']);
}

function dfo_convert_upload_batch(int $limit = 10): array
{
    $options = dfo_options();
    $appRoot = realpath(df_app_root());
    $uploadsCandidate = df_app_root() . '/uploads';
    $root = realpath($uploadsCandidate);
    if ($appRoot === false || $root === false || is_link($uploadsCandidate)
        || !str_starts_with($root, $appRoot . DIRECTORY_SEPARATOR) || !function_exists('imagewebp')
        || !function_exists('imagecreatefromstring')
    ) return ['converted' => 0, 'checked' => 0, 'done' => true];
    $assetsDirectory = dfo_cache_directory('assets');
    if (!dfo_ensure_cache_directory($assetsDirectory)) return ['converted' => 0, 'checked' => 0, 'done' => true];
    $candidates = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($iterator as $item) {
        if (!$item->isFile() || $item->isLink()) continue;
        $path = $item->getPathname();
        if (!in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), ['jpg','jpeg','png'], true)
            || (int) @filesize($path) < 1 || (int) @filesize($path) > 20 * 1024 * 1024
        ) continue;
        $info = @getimagesize($path);
        if (!is_array($info) || !in_array((string) ($info['mime'] ?? ''), ['image/jpeg','image/png'], true)
            || (int) $info[0] * (int) $info[1] > 8000000
        ) continue;
        $webpPath = $path . '.webp';
        if (is_file($webpPath) && !is_link($webpPath) && (int) @filemtime($webpPath) >= (int) @filemtime($path)) continue;
        $candidates[] = substr($path, strlen($root) + 1);
    }
    sort($candidates, SORT_STRING);
    $cursorPath = $assetsDirectory . '/webp-cursor.json';
    $cursorJson = is_file($cursorPath) && !is_link($cursorPath) ? @file_get_contents($cursorPath) : false;
    $cursorData = is_string($cursorJson) ? json_decode($cursorJson, true) : null;
    $cursor = is_array($cursorData) && is_string($cursorData['last'] ?? null) ? $cursorData['last'] : '';
    $pending = array_values(array_filter($candidates, static fn(string $relative): bool => $cursor === '' || strcmp($relative, $cursor) > 0));
    if (!$pending) {
        if (is_file($cursorPath) && !is_link($cursorPath)) @unlink($cursorPath);
        return ['converted' => 0, 'checked' => 0, 'done' => true];
    }
    $batch = array_slice($pending, 0, max(1, min(10, $limit)));
    $converted = 0;
    foreach ($batch as $relative) {
        if (dfo_convert_image_to_webp($root . '/' . $relative, (int) $options['webp_quality'], (int) $options['image_max_dimension']) !== null) $converted++;
    }
    $done = count($pending) <= count($batch);
    if ($done) {
        if (is_file($cursorPath) && !is_link($cursorPath)) @unlink($cursorPath);
    } elseif (dfo_ensure_cache_directory(dirname($cursorPath))) {
        $temporary = $cursorPath . '.' . bin2hex(random_bytes(5)) . '.tmp';
        if (@file_put_contents($temporary, json_encode(['last' => end($batch)], JSON_UNESCAPED_SLASHES), LOCK_EX) !== false) {
            @chmod($temporary, 0640);
            if (!@rename($temporary, $cursorPath)) @unlink($temporary);
        }
    }
    return ['converted' => $converted, 'checked' => count($batch), 'done' => $done];
}

function dfo_print_lcp_preload(PDO $pdo, array $context = []): void
{
    if (!dfo_options()['preload_home_hero']) return;
    $path = strtolower((string) (df_request_context()['path'] ?? '/'));
    if (!in_array($path, ['/', '/index.php', '/index.html'], true)) return;
    $hero = (string) setting($pdo, 'hero_image_path', '');
    if ($hero === '' || !function_exists('public_image_url')) return;
    $url = public_image_url($hero);
    if ($url === '' || preg_match('~^https?://~i', $url)) return;
    $GLOBALS['_dfo_preloaded_hero_url'] = $url;
    $preloadAttributes = 'href="' . e($url) . '"';
    $heroInfo = dfo_local_image_info($url);
    if (dfo_options()['webp_conversion'] && $heroInfo !== null) {
        $webpDiskPath = $heroInfo['disk'] . '.webp';
        if (is_file($webpDiskPath) && !is_link($webpDiskPath) && @getimagesize($webpDiskPath) !== false) {
            $preloadAttributes .= ' imagesrcset="' . e(app_url($heroInfo['relative'] . '.webp')) . ' 1x"';
        }
    }
    echo '<link rel="preload" as="image" fetchpriority="high" ' . $preloadAttributes . '>' . "\n  ";
}

function dfo_serve_asset_controller(PDO $pdo): never
{
    $kind = request_string($_GET, 'kind', '');
    $relativePath = request_string($_GET, 'file', '');
    $version = request_string($_GET, 'v', '');
    $response = df_apply_filters('extension.serve_asset', null, $pdo, $kind, $relativePath, $version);
    if (!is_array($response) || !isset($response['body']) || !is_string($response['body'])) {
        http_response_code(404);
        header('Cache-Control: no-store');
        exit('Not found.');
    }
    if (isset($response['status'])) http_response_code((int) $response['status']);
    if (isset($response['content_type'])) header('Content-Type: ' . (string) $response['content_type'] . '; charset=UTF-8');
    echo $response['body'];
    exit;
}
