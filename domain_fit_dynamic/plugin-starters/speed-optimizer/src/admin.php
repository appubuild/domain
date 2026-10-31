<?php
declare(strict_types=1);

function dfo_admin_navigation_links(array $links, PDO $pdo, array $admin): array
{
    $links[] = ['manage_settings', 'Speed Optimizer', 'admin/extensions?plugin=speed-optimizer'];
    return $links;
}

function dfo_checkbox(string $key, string $label, array $options, string $help = ''): void
{
    $checked = !empty($options[$key]) ? ' checked' : '';
    echo '<label class="inline-check"><input type="checkbox" name="settings[' . e($key) . ']" value="1"' . $checked . '><span>' . e($label) . '</span></label>';
    if ($help !== '') echo '<small>' . e($help) . '</small>';
}

function dfo_render_settings(PDO $pdo, array $admin, array $savedOptions): void
{
    $options = dfo_normalize_options($savedOptions);
    $gdReady = function_exists('imagewebp') && function_exists('imagecreatefromstring');
    $zipReady = class_exists(ZipArchive::class);
    $zlibReady = function_exists('ob_gzhandler') || function_exists('gzencode');
    ?>
    <p>সব feature শুরুতে বন্ধ। একবারে একটি feature চালু করে staging/Lighthouse-এ যাচাই করুন। remote vendor script (যেমন AdSense), native/offline app, admin responses এবং HTML API responses এই optimizer rewrite করে না।</p>
    <div class="admin-stats">
      <article class="admin-stat"><span>WebP support</span><strong><?= $gdReady ? 'Available' : 'Not detected' ?></strong><small>PHP GD + imagewebp</small></article>
      <article class="admin-stat"><span>ZIP installer</span><strong><?= $zipReady ? 'Available' : 'Not detected' ?></strong><small>PHP ZipArchive</small></article>
      <article class="admin-stat"><span>Gzip support</span><strong><?= $zlibReady ? 'Available' : 'Not detected' ?></strong><small>Host Brotli/Gzip may already be enabled</small></article>
    </div>
    <form class="admin-form" method="post" action="<?= e(app_url('admin/extensions?plugin=speed-optimizer')) ?>">
      <?= csrf_field() ?><input type="hidden" name="action" value="save_settings"><input type="hidden" name="slug" value="speed-optimizer">
      <section class="admin-card"><h3>HTML, CSS and JavaScript</h3>
        <?php dfo_checkbox('minify_html', 'Conservative HTML minification', $options, 'Keeps script/style/pre/textarea/code/SVG blocks intact and retains a separator between adjacent tags.'); ?>
        <?php dfo_checkbox('minify_inline_css', 'Minify inline CSS', $options, 'Applies only to inline style blocks.'); ?>
        <?php dfo_checkbox('minify_inline_js', 'Conservative inline JavaScript minification', $options, 'JSON-LD, import maps, external scripts, template literals and slash-ambiguous JavaScript files are left untouched. Review custom scripts before enabling.'); ?>
        <?php dfo_checkbox('minify_local_css', 'Serve minified local CSS through the optimizer endpoint', $options, 'Only local assets/css/*.css files are included; remote CSS is untouched. Versioned output is cached for one year.'); ?>
        <?php dfo_checkbox('font_display_swap', 'Set font-display: swap on local and inline @font-face rules', $options, 'CSS is rewritten only when needed; combine with CSS minification only if desired.'); ?>
        <?php dfo_checkbox('minify_local_js', 'Serve conservatively minified local JavaScript', $options, 'Only local assets/js/*.js files are included. Test generator/editor interactions after enabling.'); ?>
        <?php dfo_checkbox('defer_local_scripts', 'Add defer to local JavaScript lacking async/defer', $options, 'External vendor scripts and scripts already marked async, defer or module are preserved.'); ?>
        <?php dfo_checkbox('gzip_compression', 'Enable negotiated Gzip where PHP zlib permits', $options, 'If the host already compresses responses, leave off; HTTP output is never intentionally double-compressed.'); ?>
      </section>
      <section class="admin-card"><h3>Images and LCP</h3>
        <?php dfo_checkbox('lazy_images', 'Lazy-load images without an explicit loading attribute', $options, 'Existing loading="eager" attributes are preserved; logo files under uploads/brand are not lazy-loaded.'); ?>
        <?php dfo_checkbox('image_dimensions', 'Add missing width/height for readable local images', $options, 'Reads dimensions only from local uploads/ and assets/img/ files.'); ?>
        <?php dfo_checkbox('webp_conversion', 'Create WebP alternatives while preserving original-image fallback', $options, 'New JPEG/PNG uploads get a sibling WebP file. HTML receives a WebP srcset candidate only when that file is valid; original src remains the fallback.'); ?>
        <div class="form-row">
          <div class="field"><label for="optimizer_webp_quality">WebP quality (60–92)</label><input id="optimizer_webp_quality" name="settings[webp_quality]" type="number" min="60" max="92" value="<?= (int) $options['webp_quality'] ?>"></div>
          <div class="field"><label for="optimizer_max_dimension">Maximum WebP edge in pixels (640–2400)</label><input id="optimizer_max_dimension" name="settings[image_max_dimension]" type="number" min="640" max="2400" step="80" value="<?= (int) $options['image_max_dimension'] ?>"></div>
        </div>
        <?php dfo_checkbox('preload_home_hero', 'Preload the homepage hero image as the LCP candidate', $options, 'Only emits a preload when a local hero image is configured in Site Settings.'); ?>
      </section>
      <section class="admin-card"><h3>Application page cache</h3>
        <?php dfo_checkbox('page_cache', 'Enable private file-based page cache', $options, 'Only anonymous GET requests to the homepage, blog/article and public information pages; requests with cookies/query strings, admin, API and form pages are excluded. CMS cache-clear actions invalidate the cache.'); ?>
        <div class="field"><label for="optimizer_cache_ttl">Cache lifetime in seconds (30–900)</label><input id="optimizer_cache_ttl" name="settings[page_cache_ttl]" type="number" min="30" max="900" step="30" value="<?= (int) $options['page_cache_ttl'] ?>"><small>Shared-host/LiteSpeed/CDN caching can coexist; do not enable competing rules without testing purge behavior.</small></div>
      </section>
      <div class="admin-actions"><button class="button button-primary" type="submit">Save optimizer settings</button></div>
    </form>

    <section class="admin-card"><h3>Existing upload conversion</h3>
      <?php if (!$gdReady): ?>
        <p>এই hosting runtime-এ GD/WebP encoder শনাক্ত হয়নি। Hostinger/PHP Selector-এ GD এবং WebP support চালু না হওয়া পর্যন্ত conversion ব্যবহার করা যাবে না।</p>
      <?php elseif (!$options['webp_conversion']): ?>
        <p>প্রথমে উপরের WebP conversion toggle চালু করে settings save করুন। মূল JPEG/PNG ফাইল মুছে ফেলা হবে না।</p>
      <?php else: ?>
        <p>প্রতি click-এ সর্বোচ্চ ১০টি সমর্থিত JPEG/PNG পরীক্ষা হবে। Original ফাইল অক্ষত থাকবে; বড়/অসমর্থিত image skip হতে পারে। Server memory সীমা বিবেচনায় batch করে চালান।</p>
        <form class="admin-form" method="post" action="<?= e(app_url('admin/extensions?plugin=speed-optimizer')) ?>">
          <?= csrf_field() ?><input type="hidden" name="action" value="extension_task"><input type="hidden" name="slug" value="speed-optimizer"><input type="hidden" name="task" value="convert_webp_batch">
          <button class="button button-small" type="submit">Convert next upload batch to WebP</button>
        </form>
      <?php endif; ?>
    </section>
    <?php
}

function dfo_save_settings(PDO $pdo, array $admin): void
{
    $submitted = is_array($_POST['settings'] ?? null) ? $_POST['settings'] : [];
    $options = dfo_default_options();
    $booleanKeys = ['minify_html','minify_inline_css','minify_inline_js','minify_local_css','minify_local_js','font_display_swap','lazy_images','image_dimensions','webp_conversion','preload_home_hero','defer_local_scripts','gzip_compression','page_cache'];
    foreach ($booleanKeys as $key) $options[$key] = isset($submitted[$key]) && (string) $submitted[$key] === '1';
    $options['webp_quality'] = max(60, min(92, (int) ($submitted['webp_quality'] ?? $options['webp_quality'])));
    $options['image_max_dimension'] = max(640, min(2400, (int) ($submitted['image_max_dimension'] ?? $options['image_max_dimension'])));
    $options['page_cache_ttl'] = max(30, min(900, (int) ($submitted['page_cache_ttl'] ?? $options['page_cache_ttl'])));
    $options = dfo_normalize_options($options);
    df_extension_save_options($pdo, 'speed-optimizer', $options);
    $GLOBALS['_dfo_options'] = $options;
}

function dfo_run_admin_task(PDO $pdo, array $admin): void
{
    if (request_string($_POST, 'task', '') !== 'convert_webp_batch') {
        throw new RuntimeException('Unknown optimizer maintenance task.');
    }
    $options = dfo_options();
    if (!$options['webp_conversion']) throw new RuntimeException('Enable and save WebP conversion first.');
    if (!function_exists('imagewebp') || !function_exists('imagecreatefromstring')) throw new RuntimeException('PHP GD WebP support is not available on this hosting account.');
    $result = dfo_convert_upload_batch(10);
    dfo_clear_page_cache();
    $message = 'Checked ' . (int) $result['checked'] . ' image(s); created or refreshed ' . (int) $result['converted'] . ' WebP alternative(s).';
    $message .= !empty($result['done']) ? ' No further eligible files remain in this pass.' : ' Run again for the next batch.';
    flash('success', $message);
    redirect_to('admin/extensions?plugin=speed-optimizer');
}
