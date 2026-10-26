<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/config/db.php';

function app_base_path(): string
{
    static $base = null;
    if ($base === null) {
        $value = getenv('APP_BASE_PATH');
        $base = $value === false ? '/domain_fit_dynamic' : '/' . trim($value, '/');
        if ($base === '/') {
            $base = '';
        }
    }
    return $base;
}

function app_url(string $path = ''): string
{
    $path = ltrim($path, '/');
    return app_base_path() . '/' . $path;
}

function asset_url(string $path): string
{
    return app_url('assets/' . ltrim($path, '/'));
}

function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function request_string(array $source, string $key, string $default = ''): string
{
    $value = $source[$key] ?? $default;
    return is_scalar($value) ? (string) $value : $default;
}

function start_app_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('domain_fit_dynamic_admin');
    $cookiePath = app_base_path();
    if ($cookiePath === '') $cookiePath = '/';
    else $cookiePath .= '/';
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => $cookiePath,
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

function csrf_token(): string
{
    start_app_session();
    if (empty($_SESSION['_csrf'])) {
        $_SESSION['_csrf'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['_csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function verify_csrf(): void
{
    start_app_session();
    $posted = request_string($_POST, '_csrf');
    $known = (string) ($_SESSION['_csrf'] ?? '');
    if ($posted === '' || $known === '' || !hash_equals($known, $posted)) {
        http_response_code(419);
        exit('Your session expired. Refresh the page and try again.');
    }
}

function flash(string $key, ?string $message = null): ?string
{
    start_app_session();
    if ($message !== null) {
        $_SESSION['_flash'][$key] = $message;
        return null;
    }
    $value = $_SESSION['_flash'][$key] ?? null;
    unset($_SESSION['_flash'][$key]);
    return is_string($value) ? $value : null;
}

function redirect_to(string $path, int $status = 303): never
{
    header('Location: ' . app_url($path), true, $status);
    exit;
}

function setting(PDO $pdo, string $key, mixed $default = null): mixed
{
    static $cache = [];
    $connectionId = spl_object_id($pdo);
    if (!isset($cache[$connectionId])) {
        $cache[$connectionId] = [];
        try {
            foreach ($pdo->query('SELECT setting_key, value_json FROM site_settings WHERE is_public = 1') as $row) {
                $cache[$connectionId][$row['setting_key']] = json_decode((string) $row['value_json'], true);
            }
        } catch (Throwable $error) {
            // A first-run page can still render defaults while the installer is being completed.
        }
    }
    return $cache[$connectionId][$key] ?? $default;
}

function private_setting(PDO $pdo, string $key, mixed $default = null): mixed
{
    $statement = $pdo->prepare('SELECT value_json FROM site_settings WHERE setting_key = :key LIMIT 1');
    $statement->execute(['key' => $key]);
    $value = $statement->fetchColumn();
    if ($value === false) {
        return $default;
    }
    $decoded = json_decode((string) $value, true);
    return $decoded === null && (string) $value !== 'null' ? $default : $decoded;
}

function save_setting(PDO $pdo, string $key, mixed $value, ?int $adminId = null, bool $isPublic = true): void
{
    $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $statement = $pdo->prepare(
        'INSERT INTO site_settings (setting_key, value_json, is_public, updated_by) VALUES (:key, :value, :public, :admin) '
        . 'ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), is_public = VALUES(is_public), updated_by = VALUES(updated_by)'
    );
    $statement->execute(['key' => $key, 'value' => $json, 'public' => $isPublic ? 1 : 0, 'admin' => $adminId]);
}

function site_href(string $href): string
{
    $href = trim($href);
    if (preg_match('~^(https?://|mailto:|tel:)~i', $href)) {
        return $href;
    }
    if (str_starts_with($href, '//')) {
        return '#';
    }
    return app_url($href);
}

function slugify(string $value): string
{
    $value = trim(function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value));
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
    if (is_string($ascii)) {
        $value = strtolower($ascii);
    }
    $value = preg_replace('/[^a-z0-9]+/', '-', $value) ?? '';
    return trim($value, '-');
}

function parse_datetime_local_utc(string $value): ?string
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $value)) return null;
    $format = '!Y-m-d\\TH:i';
    $date = DateTimeImmutable::createFromFormat($format, $value, new DateTimeZone('UTC'));
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || (is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) || $date->format('Y-m-d\\TH:i') !== $value) return null;
    return $date->format('Y-m-d H:i:s');
}

function sanitize_rich_html(string $html): string
{
    $allowedTags = ['p','br','h1','h2','h3','h4','ul','ol','li','blockquote','strong','b','em','i','u','a','img','figure','figcaption','table','thead','tbody','tr','th','td','hr','pre','code','time','div','section','main','article','header','aside','span','small','dl','dt','dd','details','summary','mark'];
    if (!class_exists(DOMDocument::class)) {
        // Fail closed if ext-dom is missing: preserve text but remove active markup.
        return nl2br(e(strip_tags($html)), false);
    }

    $previous = libxml_use_internal_errors(true);
    $dom = new DOMDocument('1.0', 'UTF-8');
    $wrapped = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="cms-root">' . $html . '</div></body></html>';
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $wrapped, LIBXML_NONET | LIBXML_HTML_NODEFDTD);
    $xpath = new DOMXPath($dom);
    $root = $xpath->query('//*[@id="cms-root"]')->item(0);
    if (!$root instanceof DOMElement) {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        return '';
    }

    $sanitizeNode = function (DOMNode $parent) use (&$sanitizeNode, $allowedTags): void {
        $children = [];
        foreach ($parent->childNodes as $child) {
            $children[] = $child;
        }
        foreach ($children as $child) {
            if (!$child instanceof DOMElement) {
                if (!$child instanceof DOMText && !$child instanceof DOMDocumentFragment) {
                    $parent->removeChild($child);
                }
                continue;
            }

            $tag = strtolower($child->tagName);
            if (!in_array($tag, $allowedTags, true)) {
                if (in_array($tag, ['script','style','iframe','object','embed','svg','math','form'], true)) {
                    $parent->removeChild($child);
                    continue;
                }
                $sanitizeNode($child);
                while ($child->firstChild) {
                    $parent->insertBefore($child->firstChild, $child);
                }
                $parent->removeChild($child);
                continue;
            }

            $allowedAttributes = match ($tag) {
                'a' => ['href','title','target','id','class','aria-label','rel'],
                'img' => ['src','alt','title','width','height','id','class','loading'],
                'td','th' => ['colspan','rowspan','id','class'],
                default => ['id','class','role','aria-label','aria-labelledby','aria-hidden'],
            };
            $attrs = [];
            foreach ($child->attributes as $attribute) {
                $attrs[] = $attribute->name;
            }
            foreach ($attrs as $name) {
                $value = trim((string) $child->getAttribute($name));
                $lowerName = strtolower($name);
                $valid = true;
                if ($lowerName === 'id') $valid = preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,80}$/', $value) === 1;
                if ($lowerName === 'class') $valid = strlen($value) <= 200 && preg_match('/^[A-Za-z0-9 _-]*$/', $value) === 1;
                if ($lowerName === 'target') $valid = in_array($value, ['_blank','_self'], true);
                if ($lowerName === 'loading') $valid = in_array($value, ['lazy','eager'], true);
                if (in_array($lowerName, ['width','height','colspan','rowspan'], true)) $valid = preg_match('/^[0-9]{1,4}$/', $value) === 1;
                if ($lowerName === 'role') $valid = in_array($value, ['note','img','presentation','list','listitem','figure','group','status','alert'], true);
                if ($lowerName === 'aria-hidden') $valid = in_array($value, ['true','false'], true);
                if ($lowerName === 'aria-labelledby') $valid = preg_match('/^[A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*)*$/', $value) === 1;
                if ($lowerName === 'rel') $valid = preg_match('/^[A-Za-z0-9 _-]{1,100}$/', $value) === 1;
                if ($lowerName === 'aria-label' && strlen($value) > 200) $valid = false;
                if (!$valid || str_starts_with($lowerName, 'on') || !in_array($lowerName, $allowedAttributes, true)) {
                    $child->removeAttribute($name);
                    continue;
                }
                if (in_array(strtolower($name), ['href','src'], true)) {
                    $isLocal = !str_starts_with($value, '//') && str_starts_with($value, '/');
                    $isSafeRemote = $tag === 'a' && preg_match('~^(https://|mailto:)~i', $value) === 1;
                    if (!$isLocal && !$isSafeRemote && $value !== '#') {
                        $child->removeAttribute($name);
                    }
                }
            }
            if ($tag === 'a' && $child->getAttribute('target') === '_blank') {
                $child->setAttribute('rel', 'noopener noreferrer');
            }
            if ($tag === 'img' && $child->getAttribute('src') === '') {
                $parent->removeChild($child);
                continue;
            }
            $sanitizeNode($child);
        }
    };
    $sanitizeNode($root);

    $result = '';
    foreach ($root->childNodes as $child) {
        $result .= $dom->saveHTML($child);
    }
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    return $result;
}

function save_uploaded_image(string $field, string $targetDirectory = 'uploads'): ?string
{
    if (!isset($_FILES[$field]) || !is_array($_FILES[$field]) || (int) ($_FILES[$field]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }
    $file = $_FILES[$field];
    if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || (int) ($file['size'] ?? 0) > 5 * 1024 * 1024) {
        throw new RuntimeException('Image upload failed or exceeds the 5 MB limit.');
    }
    if (!class_exists(finfo::class)) {
        throw new RuntimeException('The PHP fileinfo extension is required for uploads.');
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file((string) $file['tmp_name']);
    $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    if (!isset($extensions[$mime]) || @getimagesize((string) $file['tmp_name']) === false) {
        throw new RuntimeException('Only valid JPEG, PNG or WebP images are accepted.');
    }
    $relativeDirectory = trim($targetDirectory, '/');
    $absoluteDirectory = dirname(__DIR__) . '/' . $relativeDirectory;
    if (!is_dir($absoluteDirectory) && !mkdir($absoluteDirectory, 0755, true) && !is_dir($absoluteDirectory)) {
        throw new RuntimeException('Upload directory is not available.');
    }
    $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
    $destination = $absoluteDirectory . '/' . $filename;
    if (!move_uploaded_file((string) $file['tmp_name'], $destination)) {
        throw new RuntimeException('Could not store the uploaded image.');
    }
    return app_url($relativeDirectory . '/' . $filename);
}

function admin_user(PDO $pdo): ?array
{
    start_app_session();
    $id = filter_var($_SESSION['admin_id'] ?? null, FILTER_VALIDATE_INT);
    if (!$id) {
        return null;
    }
    $query = $pdo->prepare('SELECT id, email, display_name, status FROM admin_users WHERE id = :id AND status = \'active\' LIMIT 1');
    $query->execute(['id' => $id]);
    $user = $query->fetch();
    return $user ?: null;
}

function has_permission(PDO $pdo, int $userId, string $permission): bool
{
    $query = $pdo->prepare('SELECT 1 FROM admin_user_roles ur JOIN admin_roles r ON r.id = ur.role_id JOIN admin_role_permissions rp ON rp.role_id = r.id JOIN admin_permissions p ON p.id = rp.permission_id WHERE ur.user_id = :uid AND p.permission_key = :perm LIMIT 1');
    $query->execute(['uid' => $userId, 'perm' => $permission]);
    return (bool) $query->fetchColumn();
}

function require_permission(PDO $pdo, array $admin, string $permission): void
{
    if (!has_permission($pdo, (int) $admin['id'], $permission)) {
        http_response_code(403);
        exit('You do not have permission to perform this action.');
    }
}
