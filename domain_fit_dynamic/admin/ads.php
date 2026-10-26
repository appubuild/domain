<?php
declare(strict_types=1);

require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';
require_once __DIR__ . '/../includes/ads-helper.php';
admin_require_permission($pdo, $admin, 'manage_ads');

$errorMessage = '';
$schemaReady = true;
$slotRows = [];
try {
    $slotRows = $pdo->query('SELECT placement,label,publisher_id,ad_unit_id,ad_format,size_preset,show_desktop,show_tablet,show_mobile,custom_markup,is_enabled FROM ad_slots ORDER BY id')->fetchAll();
} catch (Throwable $error) {
    $schemaReady = false;
    error_log('Responsive ad schema unavailable: ' . $error->getMessage());
    try { $slotRows = $pdo->query('SELECT placement,label,publisher_id,ad_unit_id,ad_format,is_enabled FROM ad_slots ORDER BY id')->fetchAll(); } catch (Throwable $ignored) { $slotRows = []; }
    foreach ($slotRows as &$oldSlot) {
        $oldSlot['size_preset'] = 'responsive';
        $oldSlot['show_desktop'] = $oldSlot['show_tablet'] = $oldSlot['show_mobile'] = 1;
        $oldSlot['custom_markup'] = '';
    }
    unset($oldSlot);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf();
    try {
        if (!$schemaReady) throw new RuntimeException('Run php scripts/migrate-enterprise-cms.php before saving responsive ad settings.');
        $adsEnabled = isset($_POST['ads_enabled']);
        $ga4Input = $_POST['ga4_measurement_id'] ?? '';
        $ga4Id = strtoupper(trim(substr(is_scalar($ga4Input) ? (string) $ga4Input : '', 0, 32)));
        $ga4Enabled = isset($_POST['ga4_enabled']);
        $gtmInput = $_POST['gtm_container_id'] ?? '';
        $gtmId = strtoupper(trim(substr(is_scalar($gtmInput) ? (string) $gtmInput : '', 0, 32)));
        $gtmEnabled = isset($_POST['gtm_enabled']);
        if ($ga4Id !== '' && !preg_match('/^G-[A-Z0-9]{6,12}$/', $ga4Id)) throw new RuntimeException('GA4 measurement ID must match the G-XXXXXXXXXX format.');
        if ($ga4Enabled && $ga4Id === '') throw new RuntimeException('Enter a real GA4 measurement ID before enabling GA4.');
        if ($gtmId !== '' && !preg_match('/^GTM-[A-Z0-9]{4,12}$/', $gtmId)) throw new RuntimeException('Tag Manager container ID must match the GTM-XXXXXXX format.');
        if ($gtmEnabled && $gtmId === '') throw new RuntimeException('Enter a real Tag Manager container ID before enabling it.');

        $txtInput = $_POST['ads_txt'] ?? '';
        $txt = trim(is_string($txtInput) ? $txtInput : '');
        if (strlen($txt) > 20000) throw new RuntimeException('ads.txt content must be no larger than 20 KB.');
        $cleanLines = [];
        foreach (preg_split('/\r\n|\r|\n/', $txt) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') continue;
            if (str_starts_with($line, '#')) {
                if (strlen($line) > 200 || !preg_match('/^#[A-Za-z0-9 .,;:_-]*$/', $line)) throw new RuntimeException('ads.txt comment contains unsupported characters.');
                $cleanLines[] = $line;
                continue;
            }
            if (!preg_match('/^[A-Za-z0-9.-]+\s*,\s*(?:pub-[0-9]{16}|[A-Za-z0-9-]{1,80})\s*,\s*(?:DIRECT|RESELLER)(?:\s*,\s*[A-Fa-f0-9-]{8,64})?$/i', $line)) throw new RuntimeException('One ads.txt line is invalid. Only standard owner, publisher, relationship and optional certification fields are accepted.');
            $cleanLines[] = $line;
        }

        $publisherInputs = is_array($_POST['publisher_id'] ?? null) ? $_POST['publisher_id'] : [];
        $unitInputs = is_array($_POST['ad_unit_id'] ?? null) ? $_POST['ad_unit_id'] : [];
        $formatInputs = is_array($_POST['ad_format'] ?? null) ? $_POST['ad_format'] : [];
        $sizeInputs = is_array($_POST['size_preset'] ?? null) ? $_POST['size_preset'] : [];
        $enabledInputs = is_array($_POST['slot_enabled'] ?? null) ? $_POST['slot_enabled'] : [];
        $desktopInputs = is_array($_POST['show_desktop'] ?? null) ? $_POST['show_desktop'] : [];
        $tabletInputs = is_array($_POST['show_tablet'] ?? null) ? $_POST['show_tablet'] : [];
        $mobileInputs = is_array($_POST['show_mobile'] ?? null) ? $_POST['show_mobile'] : [];
        $customInputs = is_array($_POST['custom_markup'] ?? null) ? $_POST['custom_markup'] : [];
        $sizeOptions = ['responsive','leaderboard','mobile_banner','medium_rectangle','billboard','skyscraper'];
        $formatOptions = ['auto','rectangle','horizontal','vertical'];
        $validEnabledSlots = 0;
        $enabledPublishers = [];
        $slotData = [];
        foreach ($slotRows as $slotRow) {
            $placement = (string) $slotRow['placement'];
            $publisher = trim(substr(is_scalar($publisherInputs[$placement] ?? '') ? (string) ($publisherInputs[$placement] ?? '') : '', 0, 32));
            $unit = trim(substr(is_scalar($unitInputs[$placement] ?? '') ? (string) ($unitInputs[$placement] ?? '') : '', 0, 32));
            $formatInput = $formatInputs[$placement] ?? 'auto';
            $format = is_string($formatInput) && in_array($formatInput, $formatOptions, true) ? $formatInput : 'auto';
            $sizeInput = $sizeInputs[$placement] ?? 'responsive';
            $size = is_string($sizeInput) && in_array($sizeInput, $sizeOptions, true) ? $sizeInput : 'responsive';
            $enabled = isset($enabledInputs[$placement]);
            $showDesktop = isset($desktopInputs[$placement]);
            $showTablet = isset($tabletInputs[$placement]);
            $showMobile = isset($mobileInputs[$placement]);
            $rawMarkup = $customInputs[$placement] ?? '';
            $rawMarkup = is_scalar($rawMarkup) ? (string) $rawMarkup : '';
            if (strlen($rawMarkup) > 10000) throw new RuntimeException('Custom ad markup must be no larger than 10 KB.');
            if ($enabled && (!preg_match('/^ca-pub-[0-9]{16}$/', $publisher) || !preg_match('/^[0-9]{10,20}$/', $unit))) throw new RuntimeException('An enabled AdSense slot is missing a valid publisher or ad-unit ID. Use only IDs issued in your account.');
            if ($publisher !== '' && !preg_match('/^ca-pub-[0-9]{16}$/', $publisher)) throw new RuntimeException('A publisher ID is invalid.');
            if ($unit !== '' && !preg_match('/^[0-9]{10,20}$/', $unit)) throw new RuntimeException('An ad-unit ID is invalid.');
            if ($enabled && !$showDesktop && !$showTablet && !$showMobile) throw new RuntimeException('Choose at least one device for every enabled ad slot.');
            $safeMarkup = $rawMarkup === '' ? '' : sanitize_ad_markup($rawMarkup, $publisher, $unit);
            if ($enabled) {
                $validEnabledSlots++;
                $enabledPublishers[$publisher] = true;
            }
            $slotData[] = [
                'placement' => $placement, 'publisher' => $publisher, 'unit' => $unit, 'format' => $format,
                'size' => $size, 'enabled' => $enabled, 'desktop' => $showDesktop, 'tablet' => $showTablet,
                'mobile' => $showMobile, 'markup' => $safeMarkup,
            ];
        }
        if (count($enabledPublishers) > 1) throw new RuntimeException('All enabled AdSense placements must use the same publisher ID.');
        if ($adsEnabled && $validEnabledSlots === 0) throw new RuntimeException('Before turning on site ads, configure at least one real and enabled AdSense slot.');

        $pdo->beginTransaction();
        $save = $pdo->prepare('UPDATE ad_slots SET publisher_id=:publisher,ad_unit_id=:unit,ad_format=:format,size_preset=:size,show_desktop=:desktop,show_tablet=:tablet,show_mobile=:mobile,custom_markup=:markup,is_enabled=:enabled,updated_by=:admin WHERE placement=:placement');
        foreach ($slotData as $slot) {
            $save->execute([
                'publisher' => $slot['publisher'], 'unit' => $slot['unit'], 'format' => $slot['format'],
                'size' => $slot['size'], 'desktop' => $slot['desktop'] ? 1 : 0, 'tablet' => $slot['tablet'] ? 1 : 0,
                'mobile' => $slot['mobile'] ? 1 : 0, 'markup' => $slot['markup'] !== '' ? $slot['markup'] : null,
                'enabled' => $slot['enabled'] ? 1 : 0, 'admin' => (int) $admin['id'], 'placement' => $slot['placement'],
            ]);
        }
        save_setting($pdo, 'ads_enabled', $adsEnabled, (int) $admin['id'], true);
        save_setting($pdo, 'ads_txt', implode("\n", $cleanLines), (int) $admin['id'], false);
        save_setting($pdo, 'ga4_measurement_id', $ga4Id, (int) $admin['id'], false);
        save_setting($pdo, 'ga4_enabled', $ga4Enabled, (int) $admin['id'], false);
        save_setting($pdo, 'gtm_container_id', $gtmId, (int) $admin['id'], false);
        save_setting($pdo, 'gtm_enabled', $gtmEnabled, (int) $admin['id'], false);
        audit_log($pdo, (int) $admin['id'], 'integrations.updated', 'ads', 'all', 'Responsive web ads, ads.txt and analytics integrations updated.');
        $pdo->commit();
        cache_clear_all();
        flash('success', 'Advertising and integration settings saved.');
        redirect_to('admin/ads');
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('Ads/settings: ' . $error->getMessage());
        $errorMessage = $error instanceof RuntimeException ? $error->getMessage() : 'Settings could not be saved. Check IDs, migration status and database configuration.';
    }
}

$adsEnabled = (bool) setting($pdo, 'ads_enabled', false);
$adsTxt = (string) private_setting($pdo, 'ads_txt', '');
$ga4Id = (string) private_setting($pdo, 'ga4_measurement_id', '');
$ga4Enabled = (bool) private_setting($pdo, 'ga4_enabled', false);
$gtmId = (string) private_setting($pdo, 'gtm_container_id', '');
$gtmEnabled = (bool) private_setting($pdo, 'gtm_enabled', false);
$presets = [
    'responsive' => 'Responsive / fluid', 'leaderboard' => 'Leaderboard · 728 × 90',
    'mobile_banner' => 'Mobile banner · 320 × 100', 'medium_rectangle' => 'Medium rectangle · 300 × 250',
    'billboard' => 'Billboard · 970 × 250', 'skyscraper' => 'Skyscraper · 160 × 600',
];
admin_header($pdo, $admin, 'Ads & integrations', ['css/dynamic.css']);
?>
<?php if ($errorMessage !== ''): ?><div class="notice notice-error" role="alert"><?= e($errorMessage) ?></div><?php endif; ?>
<?php if (!$schemaReady): ?><div class="notice notice-warning" role="status">Responsive ad settings are not installed yet. Run <code>php scripts/migrate-enterprise-cms.php</code> from the CMS folder before changing placement settings.</div><?php endif; ?>
<form class="admin-form" method="post"><?= csrf_field() ?>
  <section class="admin-card"><div class="section-heading section-heading--admin"><div><p class="admin-card-eyebrow">Web monetization</p><h2>Responsive AdSense placements</h2></div><span class="admin-badge <?= $adsEnabled ? 'admin-badge--published' : 'admin-badge--draft' ?>"><?= $adsEnabled ? 'Enabled' : 'Off by default' ?></span></div>
    <p>Ads render only on this PHP website, only for globally enabled slots with real account-issued publisher and ad-unit IDs. Capacitor's local/offline app remains ad-free. Ad clicks are not recorded in first-party analytics.</p>
    <label class="inline-check"><input type="checkbox" name="ads_enabled" value="1" <?= $adsEnabled ? 'checked' : '' ?>><span>Enable configured web ad placements globally</span></label>
    <div class="ad-manager-grid">
      <?php foreach ($slotRows as $slot): $placement = (string) $slot['placement']; ?>
      <article class="ad-manager-card" data-ad-manager-card>
        <div class="ad-manager-heading"><div><p class="admin-card-eyebrow">Placement</p><h3><?= e($slot['label']) ?></h3><code><?= e($placement) ?></code></div><label class="inline-check"><input type="checkbox" name="slot_enabled[<?= e($placement) ?>]" value="1" <?= !empty($slot['is_enabled']) ? 'checked' : '' ?>><span>On</span></label></div>
        <div class="form-row"><div class="field"><label for="publisher-<?= e($placement) ?>">Publisher ID</label><input id="publisher-<?= e($placement) ?>" name="publisher_id[<?= e($placement) ?>]" maxlength="32" value="<?= e($slot['publisher_id'] ?? '') ?>" placeholder="Publisher ID issued by AdSense" data-ad-preview-input></div><div class="field"><label for="unit-<?= e($placement) ?>">Ad-unit ID</label><input id="unit-<?= e($placement) ?>" name="ad_unit_id[<?= e($placement) ?>]" maxlength="32" value="<?= e($slot['ad_unit_id'] ?? '') ?>" placeholder="Account-issued ad unit"></div></div>
        <div class="form-row"><div class="field"><label for="format-<?= e($placement) ?>">AdSense format</label><select id="format-<?= e($placement) ?>" name="ad_format[<?= e($placement) ?>]"><?php foreach (['auto','rectangle','horizontal','vertical'] as $format): ?><option value="<?= e($format) ?>" <?= ($slot['ad_format'] ?? 'auto') === $format ? 'selected' : '' ?>><?= e(ucfirst($format)) ?></option><?php endforeach; ?></select></div><div class="field"><label for="size-<?= e($placement) ?>">Size preset</label><select id="size-<?= e($placement) ?>" name="size_preset[<?= e($placement) ?>]" data-ad-size-select><?php foreach ($presets as $key => $label): ?><option value="<?= e($key) ?>" <?= ($slot['size_preset'] ?? 'responsive') === $key ? 'selected' : '' ?>><?= e($label) ?></option><?php endforeach; ?></select></div></div>
        <fieldset class="device-toggles"><legend>Show on devices</legend><label><input type="checkbox" name="show_desktop[<?= e($placement) ?>]" value="1" <?= !empty($slot['show_desktop']) ? 'checked' : '' ?>><span>Desktop</span></label><label><input type="checkbox" name="show_tablet[<?= e($placement) ?>]" value="1" <?= !empty($slot['show_tablet']) ? 'checked' : '' ?>><span>Tablet</span></label><label><input type="checkbox" name="show_mobile[<?= e($placement) ?>]" value="1" <?= !empty($slot['show_mobile']) ? 'checked' : '' ?>><span>Mobile</span></label></fieldset>
        <div class="ad-preview-box ad-size--<?= e($slot['size_preset'] ?? 'responsive') ?>" data-ad-preview><span>Ad preview</span><small><?= e($slot['size_preset'] ?? 'responsive') ?> · IDs required</small></div>
        <details class="custom-ad-details"><summary>Optional custom HTML markup</summary><p>Non-executable HTML only. Script, iframe, event-handler, style and unsafe URL content is rejected. An AdSense <code>&lt;ins&gt;</code> must match this slot’s configured publisher and unit IDs. Approved vendor scripts belong in privileged Site Settings code injection.</p><label class="visually-hidden" for="markup-<?= e($placement) ?>">Custom safe HTML for <?= e($placement) ?></label><textarea class="code-input" id="markup-<?= e($placement) ?>" name="custom_markup[<?= e($placement) ?>]" maxlength="10000" rows="5" placeholder="Leave blank to use the standard responsive AdSense unit."><?= e($slot['custom_markup'] ?? '') ?></textarea></details>
      </article>
      <?php endforeach; ?>
    </div>
  </section>

  <section class="admin-card"><p class="admin-card-eyebrow">Publisher file</p><h2>ads.txt</h2><p>Safe standard ads.txt records are served at <code>/ads.txt</code>. Add records issued by your actual advertising account; no placeholder IDs are preloaded.</p><div class="field"><label for="ads_txt">ads.txt rows</label><textarea class="code-input" id="ads_txt" name="ads_txt" maxlength="20000" rows="8" placeholder="Enter a record issued by your advertising account"><?= e($adsTxt) ?></textarea></div></section>

  <section class="admin-card"><p class="admin-card-eyebrow">Analytics &amp; tag management</p><h2>GA4 and Google Tag Manager</h2><p>Both integrations are blank/off until configured with account-issued IDs. Do not enable overlapping tags that count the same events twice.</p><div class="form-row"><div class="field"><label for="ga4_measurement_id">GA4 measurement ID</label><input id="ga4_measurement_id" name="ga4_measurement_id" maxlength="32" value="<?= e($ga4Id) ?>" placeholder="Measurement ID issued by Google Analytics"></div><div class="field"><label for="gtm_container_id">Google Tag Manager container ID</label><input id="gtm_container_id" name="gtm_container_id" maxlength="32" value="<?= e($gtmId) ?>" placeholder="Container ID issued by Tag Manager"></div></div><div class="form-row"><label class="inline-check"><input type="checkbox" name="ga4_enabled" value="1" <?= $ga4Enabled ? 'checked' : '' ?>><span>Enable GA4 script</span></label><label class="inline-check"><input type="checkbox" name="gtm_enabled" value="1" <?= $gtmEnabled ? 'checked' : '' ?>><span>Enable Tag Manager script</span></label></div><p>Consent, disclosure and retention requirements depend on your actual site configuration and local law; this CMS does not supply a consent-management platform.</p></section>
  <div class="admin-actions"><button class="button button-primary" type="submit">Save ads &amp; integrations</button></div>
</form>
<script src="<?= e(asset_url('js/admin-tools.js')) ?>" defer></script>
<?php admin_footer(); ?>
