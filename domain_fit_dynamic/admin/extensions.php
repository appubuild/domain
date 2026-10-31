<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';
require_once __DIR__ . '/../includes/extension-installer.php';

// Site settings permission is currently assigned only to the Super Administrator role.
admin_require_permission($pdo, $admin, 'manage_settings');
$schemaMessage = '';
try {
    df_check_extensions_schema($pdo);
} catch (Throwable $error) {
    $schemaMessage = $error instanceof RuntimeException ? $error->getMessage() : 'The extension registry database table is unavailable.';
}
if ($schemaMessage !== '') {
    admin_header($pdo, $admin, 'Extensions / Plugins');
    echo '<section class="admin-card"><h2>Database setup required</h2><div class="notice notice-error" role="alert">' . e($schemaMessage) . '</div><p>Existing databases need this one-time schema migration. Use phpMyAdmin → select the CMS database → Import, then choose <code>domain_fit_dynamic/migrations/20261030_extensions.sql</code>. The runtime database account is not asked to create tables.</p></section>';
    admin_footer();
    exit;
}

$errorMessage = '';
$selectedSlug = request_string($_GET, 'plugin', '');
if ($selectedSlug !== '' && !df_extension_slug_is_valid($selectedSlug)) {
    $selectedSlug = '';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    $action = request_string($_POST, 'action', '');
    try {
        if ($action === 'install') {
            $installed = df_install_extension_zip($pdo, $_FILES['extension_zip'] ?? [], (int) $admin['id']);
            audit_log($pdo, (int) $admin['id'], 'extension.installed', 'cms_extension', $installed['slug'], $installed['name'] . ' ' . $installed['version']);
            flash('success', 'Extension installed. Review it, then activate it when ready.');
            redirect_to('admin/extensions');
        }

        $slug = request_string($_POST, 'slug', '');
        if (!df_extension_slug_is_valid($slug)) {
            throw new RuntimeException('Invalid extension identifier.');
        }
        $lookup = $pdo->prepare('SELECT slug,name,version,status FROM cms_extensions WHERE slug=:slug LIMIT 1');
        $lookup->execute(['slug' => $slug]);
        $extension = $lookup->fetch();
        if (!$extension) {
            throw new RuntimeException('Extension installation record was not found.');
        }

        if ($action === 'status') {
            $newStatus = request_string($_POST, 'status', '');
            if (!in_array($newStatus, ['active', 'inactive'], true)) {
                throw new RuntimeException('Invalid extension status.');
            }
            if ($newStatus === 'active') {
                if (df_extension_inspect($slug) === null) {
                    throw new RuntimeException('This extension has an invalid manifest or missing entry file.');
                }
                $update = $pdo->prepare("UPDATE cms_extensions SET status='active' WHERE slug=:slug");
                $update->execute(['slug' => $slug]);
                if (df_extensions_load_plugin($pdo, $slug, true) === null) {
                    $pdo->prepare("UPDATE cms_extensions SET status='inactive' WHERE slug=:slug")->execute(['slug' => $slug]);
                    throw new RuntimeException('The extension could not be loaded. It remains inactive. Check the private PHP error log.');
                }
                try {
                    df_do_action_strict('extension.activated', $slug, $pdo);
                } catch (Throwable $error) {
                    $pdo->prepare("UPDATE cms_extensions SET status='inactive' WHERE slug=:slug")->execute(['slug' => $slug]);
                    throw $error;
                }
            } else {
                if ((string) $extension['status'] === 'active') {
                    df_do_action_strict('extension.deactivating', $slug, $pdo);
                }
                $pdo->prepare("UPDATE cms_extensions SET status='inactive' WHERE slug=:slug")->execute(['slug' => $slug]);
                if ((string) $extension['status'] === 'active') {
                    df_do_action_strict('extension.deactivated', $slug, $pdo);
                }
            }
            cache_clear_all();
            audit_log($pdo, (int) $admin['id'], 'extension.status_changed', 'cms_extension', $slug, $newStatus);
            flash('success', $newStatus === 'active' ? 'Extension activated.' : 'Extension deactivated.');
            redirect_to('admin/extensions');
        }

        if ($action === 'uninstall') {
            // An explicit administrator uninstall may load an inactive plugin solely for its cleanup hook.
            $uninstallManifest = df_extensions_load_plugin($pdo, $slug, true);
            if ($uninstallManifest !== null) {
                df_do_action_strict('extension.uninstalling', $slug, $pdo);
            }
            if ((string) $extension['status'] === 'active') {
                $pdo->prepare("UPDATE cms_extensions SET status='inactive' WHERE slug=:slug")->execute(['slug' => $slug]);
            }
            $root = df_extensions_root();
            $directory = $root . '/' . $slug;
            if (file_exists($directory) || is_link($directory)) {
                df_extension_remove_tree($directory, $root);
            }
            $pdo->prepare('DELETE FROM cms_extensions WHERE slug=:slug')->execute(['slug' => $slug]);
            if ($uninstallManifest !== null) {
                try {
                    df_do_action_strict('extension.uninstalled', $slug, $pdo);
                } catch (Throwable $hookError) {
                    error_log('Extension post-uninstall hook failed [' . $slug . ']: ' . $hookError->getMessage());
                }
            }
            cache_clear_all();
            audit_log($pdo, (int) $admin['id'], 'extension.uninstalled', 'cms_extension', $slug, (string) $extension['name']);
            flash('success', 'Extension uninstalled and its private files removed.');
            redirect_to('admin/extensions');
        }

        if ($action === 'save_settings') {
            if ((string) $extension['status'] !== 'active') {
                throw new RuntimeException('Activate this extension before editing its settings.');
            }
            $hook = 'admin.extension.save.' . $slug;
            if (!df_has_action($hook)) {
                throw new RuntimeException('This extension does not register a settings save handler.');
            }
            df_do_action_strict($hook, $pdo, $admin);
            cache_clear_all();
            audit_log($pdo, (int) $admin['id'], 'extension.settings_updated', 'cms_extension', $slug, (string) $extension['name']);
            flash('success', 'Extension settings saved.');
            redirect_to('admin/extensions?plugin=' . rawurlencode($slug));
        }

        if ($action === 'extension_task') {
            if ((string) $extension['status'] !== 'active') {
                throw new RuntimeException('Activate this extension before running its maintenance tasks.');
            }
            $hook = 'admin.extension.task.' . $slug;
            if (!df_has_action($hook)) {
                throw new RuntimeException('This extension does not register maintenance tasks.');
            }
            df_do_action_strict($hook, $pdo, $admin);
            flash('success', 'Extension task completed.');
            redirect_to('admin/extensions?plugin=' . rawurlencode($slug));
        }

        throw new RuntimeException('Unknown extension action.');
    } catch (Throwable $error) {
        error_log('Extension manager: ' . $error->getMessage());
        $errorMessage = $error instanceof RuntimeException
            ? $error->getMessage()
            : 'The extension action failed. Check the private PHP log and database/storage permissions.';
        $selectedSlug = request_string($_POST, 'slug', $selectedSlug);
        if (!df_extension_slug_is_valid($selectedSlug)) $selectedSlug = '';
    }
}

$extensions = $pdo->query('SELECT slug,name,version,status,installed_at,updated_at FROM cms_extensions ORDER BY name,slug')->fetchAll();
$selectedExtension = null;
foreach ($extensions as $row) {
    if ((string) $row['slug'] === $selectedSlug) {
        $selectedExtension = $row;
        break;
    }
}
$selectedManifest = $selectedExtension ? df_extension_inspect((string) $selectedExtension['slug']) : null;
$selectedOptions = $selectedExtension ? df_extension_options($pdo, (string) $selectedExtension['slug']) : [];

admin_header($pdo, $admin, 'Extensions / Plugins');
?>
<?php if ($errorMessage !== ''): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
<section class="admin-card">
  <h2>Install an extension</h2>
  <p><strong>Security:</strong> PHP extensions execute with the CMS process's permissions; the private install folder is not a PHP sandbox. Install ZIPs only from a source you trust, back up the database and files first, and keep activation limited to administrators.</p>
  <p>Package format: one top-level lowercase slug folder containing <code>plugin.json</code> and the declared PHP entry file. ZIP limit: 20 MB; expanded package limit: 60 MB.</p>
  <?php if (!class_exists(ZipArchive::class)): ?><div class="notice notice-error">PHP ZipArchive is not enabled. Ask hosting support to enable the PHP zip extension before using ZIP installation.</div><?php endif; ?>
  <form class="admin-form" method="post" action="<?= e(app_url('admin/extensions')) ?>" enctype="multipart/form-data">
    <?= csrf_field() ?><input type="hidden" name="action" value="install">
    <div class="field"><label for="extension_zip">Plugin ZIP archive</label><input id="extension_zip" type="file" name="extension_zip" accept=".zip,application/zip" required><small>Hosting PHP settings must allow a request larger than the selected ZIP (post_max_size) and file (upload_max_filesize).</small></div>
    <button class="button button-primary" type="submit" <?= class_exists(ZipArchive::class) ? '' : 'disabled' ?>>Validate and install</button>
  </form>
</section>

<section class="admin-card">
  <h2>Installed extensions</h2>
  <?php if (!$extensions): ?><p>No extensions are installed.</p><?php else: ?>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Extension</th><th>Status</th><th>Installed</th><th>Actions</th></tr></thead><tbody>
    <?php foreach ($extensions as $extension): $slug = (string) $extension['slug']; $isActive = $extension['status'] === 'active'; $settingsHook = 'admin.extension.settings.' . $slug; ?>
      <tr>
        <td><strong><?= e($extension['name']) ?></strong><br><small><?= e($slug) ?> · v<?= e($extension['version']) ?></small></td>
        <td><span class="admin-badge admin-badge--<?= $isActive ? 'published' : 'draft' ?>"><?= $isActive ? 'Active' : 'Inactive' ?></span></td>
        <td><?= e((string) $extension['installed_at']) ?></td>
        <td><div class="admin-actions">
          <?php if ($isActive && df_has_action($settingsHook)): ?><a href="<?= e(app_url('admin/extensions?plugin=' . rawurlencode($slug))) ?>">Settings</a><?php endif; ?>
          <form method="post" action="<?= e(app_url('admin/extensions')) ?>"><?= csrf_field() ?><input type="hidden" name="action" value="status"><input type="hidden" name="slug" value="<?= e($slug) ?>"><input type="hidden" name="status" value="<?= $isActive ? 'inactive' : 'active' ?>"><button type="submit"><?= $isActive ? 'Deactivate' : 'Activate' ?></button></form>
          <form method="post" action="<?= e(app_url('admin/extensions')) ?>" data-confirm="Uninstall <?= e($extension['name']) ?> and remove its files and saved settings?"><?= csrf_field() ?><input type="hidden" name="action" value="uninstall"><input type="hidden" name="slug" value="<?= e($slug) ?>"><button class="admin-danger" type="submit">Uninstall</button></form>
        </div></td>
      </tr>
    <?php endforeach; ?>
    </tbody></table></div>
  <?php endif; ?>
</section>

<?php if ($selectedExtension): ?>
<section class="admin-card">
  <div class="section-heading"><div><p class="eyebrow">Extension settings</p><h2><?= e($selectedExtension['name']) ?></h2></div><a class="text-link" href="<?= e(app_url('admin/extensions')) ?>">Back to all extensions</a></div>
  <?php if ($selectedExtension['status'] !== 'active'): ?>
    <p>Activate this extension before opening its settings page.</p>
  <?php elseif ($selectedManifest === null): ?>
    <div class="notice notice-error">The extension manifest is invalid or its entry file is missing. Deactivate and uninstall it before reinstalling a trusted package.</div>
  <?php elseif (df_has_action('admin.extension.settings.' . $selectedSlug)): ?>
    <?php df_do_action('admin.extension.settings.' . $selectedSlug, $pdo, $admin, $selectedOptions); ?>
  <?php else: ?>
    <p>This active extension has no dedicated settings view.</p>
  <?php endif; ?>
</section>
<?php endif; ?>
<?php admin_footer(); ?>
