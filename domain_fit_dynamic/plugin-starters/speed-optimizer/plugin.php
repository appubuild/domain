<?php
declare(strict_types=1);

require_once __DIR__ . '/src/optimizer.php';
require_once __DIR__ . '/src/admin.php';

$GLOBALS['_dfo_options'] = dfo_normalize_options(df_extension_options(db(), 'speed-optimizer'));

df_add_filter('asset.url', 'dfo_filter_asset_url', 20, 3);
df_add_filter('response.html', 'dfo_transform_html', 20, 2);
df_add_filter('extension.serve_asset', 'dfo_serve_asset', 20, 5);
df_add_filter('admin.navigation_links', 'dfo_admin_navigation_links', 30, 3);
df_add_action('request.extensions_loaded', 'dfo_before_request', 20, 1);
df_add_action('image.uploaded', 'dfo_optimize_uploaded_image', 20, 3);
df_add_action('public.head', 'dfo_print_lcp_preload', 20, 2);
df_add_action('cache.clearing', 'dfo_clear_page_cache', 20, 0);
df_add_action('extension.deactivating', 'dfo_clear_optimizer_cache_for_lifecycle', 20, 1);
df_add_action('extension.uninstalling', 'dfo_clear_optimizer_cache_for_lifecycle', 20, 1);
df_add_action('admin.extension.settings.speed-optimizer', 'dfo_render_settings', 10, 3);
df_add_action('admin.extension.save.speed-optimizer', 'dfo_save_settings', 10, 2);
df_add_action('admin.extension.task.speed-optimizer', 'dfo_run_admin_task', 10, 2);
