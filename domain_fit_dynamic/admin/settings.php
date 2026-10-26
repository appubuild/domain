<?php
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';
admin_require_permission($pdo,$admin,'manage_settings');
$errorMessage='';
if ($_SERVER['REQUEST_METHOD']==='POST') {
    verify_csrf();
    try {
        $siteTitle=trim(substr(strip_tags(request_string($_POST, 'site_title', '')),0,120));
        $siteDescription=trim(substr(strip_tags(request_string($_POST, 'site_description', '')),0,320));
        $siteAuthor=trim(substr(strip_tags(request_string($_POST, 'site_author', '')),0,120));
        $theme=in_array(($_POST['theme_mode']??''),['light','dark'],true)?(string)$_POST['theme_mode']:'light';
        $primary=trim(request_string($_POST, 'primary_color', ''));
        $accent=trim(request_string($_POST, 'accent_color', ''));
        $heroTitle=trim(substr(strip_tags(request_string($_POST, 'hero_title', '')),0,180));
        $heroSubtitle=trim(substr(strip_tags(request_string($_POST, 'hero_subtitle', '')),0,500));
        $heroCta=trim(substr(strip_tags(request_string($_POST, 'hero_cta', '')),0,80));
        $heroSecondary=trim(substr(strip_tags(request_string($_POST, 'hero_secondary', '')),0,80));
        $footerText=trim(substr(strip_tags(request_string($_POST, 'footer_text', '')),0,240));
        $copyrightText=trim(substr(strip_tags(request_string($_POST, 'copyright_text', '')),0,200));
        $generatorMode=in_array(($_POST['generator_controls_mode']??''),['drawer','accordion'],true)?(string)$_POST['generator_controls_mode']:'drawer';
        $verification=trim(request_string($_POST, 'google_site_verification', ''));
        if($siteTitle===''||$heroTitle===''||$heroSubtitle==='') throw new RuntimeException('Site title, hero heading and hero description are required.');
        if(!preg_match('/^#[0-9a-fA-F]{6}$/',$primary)||!preg_match('/^#[0-9a-fA-F]{6}$/',$accent)) throw new RuntimeException('Theme colors must be six-digit hexadecimal colors.');
        if($verification!==''&&!preg_match('/^[A-Za-z0-9_-]{8,200}$/',$verification)) throw new RuntimeException('Search Console verification value contains unsupported characters.');
        $logoPath=(string)setting($pdo,'logo_path','');
        $heroImage=(string)setting($pdo,'hero_image_path','');
        $logoUpload=save_uploaded_image('logo_file','uploads/brand'); if($logoUpload!==null)$logoPath=$logoUpload;
        $heroUpload=save_uploaded_image('hero_image_file','uploads/brand'); if($heroUpload!==null)$heroImage=$heroUpload;
        $values=[
            'site_title'=>$siteTitle,'site_description'=>$siteDescription,'site_author'=>$siteAuthor,'theme_mode'=>$theme,
            'primary_color'=>$primary,'accent_color'=>$accent,'hero_title'=>$heroTitle,'hero_subtitle'=>$heroSubtitle,
            'hero_cta'=>$heroCta,'hero_secondary'=>$heroSecondary,'footer_text'=>$footerText,'copyright_text'=>$copyrightText,
            'logo_path'=>$logoPath,'hero_image_path'=>$heroImage,'generator_controls_mode'=>$generatorMode,
            'google_site_verification'=>$verification,'site_analytics_enabled'=>isset($_POST['site_analytics_enabled'])
        ];
        $pdo->beginTransaction();
        foreach($values as $key=>$value) save_setting($pdo,$key,$value,(int)$admin['id'],true);
        audit_log($pdo,(int)$admin['id'],'settings.updated','site_settings','public','Site identity and display options updated.');
        $pdo->commit();
        cache_clear_all();
        flash('success','Site settings saved.');
        redirect_to('admin/settings.php');
    } catch(Throwable $error) {
        if($pdo->inTransaction())$pdo->rollBack();
        error_log('Site settings: '.$error->getMessage());
        $errorMessage=$error instanceof RuntimeException?$error->getMessage():'Settings could not be saved. Check uploaded image files and configuration.';
    }
}
$keys=['site_title','site_description','site_author','google_site_verification','theme_mode','primary_color','accent_color','logo_path','hero_image_path','hero_title','hero_subtitle','hero_cta','hero_secondary','footer_text','copyright_text','generator_controls_mode','site_analytics_enabled'];
$settings=[];
$load=$pdo->prepare('SELECT setting_key,value_json FROM site_settings WHERE setting_key=:key LIMIT 1');
foreach($keys as $key){$load->execute(['key'=>$key]);$value=$load->fetchColumn();$settings[$key]=$value===false?null:json_decode((string)$value,true);}
$settings['site_title']=$settings['site_title']?:'DomainFits';
$settings['site_description']=$settings['site_description']?:'';
$settings['site_author']=$settings['site_author']?:'DomainFits Editorial';
$settings['theme_mode']=$settings['theme_mode']?:'light';
$settings['primary_color']=$settings['primary_color']?:'#5746e8';
$settings['accent_color']=$settings['accent_color']?:'#16a085';
$settings['hero_title']=$settings['hero_title']?:'';$settings['hero_subtitle']=$settings['hero_subtitle']?:'';
$settings['hero_cta']=$settings['hero_cta']?:'';$settings['hero_secondary']=$settings['hero_secondary']?:'';
$settings['footer_text']=$settings['footer_text']?:'';$settings['copyright_text']=$settings['copyright_text']?:'';
$settings['generator_controls_mode']=$settings['generator_controls_mode']?:'drawer';
$settings['site_analytics_enabled']=(bool)$settings['site_analytics_enabled'];
admin_header($pdo,$admin,'Site settings');
?>
<?php if($errorMessage!==''):?><div class="notice notice-error" role="alert"><?=e($errorMessage)?></div><?php endif;?>
<form class="admin-form" method="post" enctype="multipart/form-data"><?=csrf_field()?>
<section class="admin-card"><h2>Identity &amp; search metadata</h2><div class="form-row"><div class="field"><label for="site_title">Site title</label><input id="site_title" name="site_title" maxlength="120" required value="<?=e($settings['site_title'])?>"></div><div class="field"><label for="site_author">Structured-data author name</label><input id="site_author" name="site_author" maxlength="120" value="<?=e($settings['site_author'])?>"></div></div><div class="field"><label for="site_description">Default meta description</label><textarea id="site_description" name="site_description" maxlength="320" rows="3"><?=e($settings['site_description'])?></textarea></div><div class="field"><label for="google_site_verification">Search Console verification token</label><input id="google_site_verification" name="google_site_verification" maxlength="200" value="<?=e($settings['google_site_verification']??'')?>"><small>Blank unless a token was issued for your verified domain.</small></div></section>
<section class="admin-card"><h2>Brand, theme &amp; homepage</h2><div class="form-row three"><div class="field"><label for="theme_mode">Default theme</label><select id="theme_mode" name="theme_mode"><option value="light" <?=$settings['theme_mode']==='light'?'selected':''?>>Light</option><option value="dark" <?=$settings['theme_mode']==='dark'?'selected':''?>>Dark</option></select></div><div class="field"><label for="primary_color">Primary color</label><input id="primary_color" name="primary_color" type="color" value="<?=e($settings['primary_color'])?>"></div><div class="field"><label for="accent_color">Accent color</label><input id="accent_color" name="accent_color" type="color" value="<?=e($settings['accent_color'])?>"></div></div><div class="form-row"><div class="field"><label for="logo_file">Logo upload (JPEG, PNG or WebP · max 5 MB)</label><?php if($settings['logo_path']):?><small>Current logo: <?=e($settings['logo_path'])?></small><?php endif;?><input id="logo_file" type="file" name="logo_file" accept="image/jpeg,image/png,image/webp"></div><div class="field"><label for="hero_image_file">Homepage hero image (optional)</label><?php if($settings['hero_image_path']):?><small>Current hero image: <?=e($settings['hero_image_path'])?></small><?php endif;?><input id="hero_image_file" type="file" name="hero_image_file" accept="image/jpeg,image/png,image/webp"></div></div><div class="field"><label for="hero_title">Hero heading</label><input id="hero_title" name="hero_title" maxlength="180" required value="<?=e($settings['hero_title'])?>"></div><div class="field"><label for="hero_subtitle">Hero description</label><textarea id="hero_subtitle" name="hero_subtitle" maxlength="500" rows="3" required><?=e($settings['hero_subtitle'])?></textarea></div><div class="form-row"><div class="field"><label for="hero_cta">Primary button label</label><input id="hero_cta" name="hero_cta" maxlength="80" value="<?=e($settings['hero_cta'])?>"></div><div class="field"><label for="hero_secondary">Secondary link label</label><input id="hero_secondary" name="hero_secondary" maxlength="80" value="<?=e($settings['hero_secondary'])?>"></div></div><div class="form-row"><div class="field"><label for="footer_text">Footer description</label><input id="footer_text" name="footer_text" maxlength="240" value="<?=e($settings['footer_text'])?>"></div><div class="field"><label for="copyright_text">Copyright line (optional)</label><input id="copyright_text" name="copyright_text" maxlength="200" value="<?=e($settings['copyright_text'])?>"></div></div></section>
<section class="admin-card"><h2>Generator &amp; first-party analytics</h2><div class="field"><label for="generator_controls_mode">Generator settings on mobile</label><select id="generator_controls_mode" name="generator_controls_mode"><option value="drawer" <?=$settings['generator_controls_mode']==='drawer'?'selected':''?>>Mobile drawer (desktop remains inline)</option><option value="accordion" <?=$settings['generator_controls_mode']==='accordion'?'selected':''?>>Mobile accordion (desktop remains inline)</option></select></div><label class="inline-check"><input type="checkbox" name="site_analytics_enabled" value="1" <?=$settings['site_analytics_enabled']?'checked':''?>><span>Enable privacy-aware first-party page-view and generator-run counts</span></label><p>First-party analytics is off by default. When enabled, the site stores event type and page path; it stores no raw IP address and does not track AdSense clicks. Configure a unique ANALYTICS_SALT environment variable if you need daily approximate unique counts, and update your privacy information before enabling.</p></section>
<section class="admin-card"><h2>Third-party integrations</h2><p>GA4, Tag Manager and AdSense are separate, blank/off controls. This page only manages search verification; configure IDs and explicit enable switches in <a href="<?=e(app_url('admin/ads.php'))?>">Ads &amp; integrations</a>. Third-party consent, policy and legal requirements depend on your actual deployment.</p><p>Production origin: <code><?=e(getenv('SITE_ORIGIN')?:'Not configured')?></code>. Set SITE_ORIGIN in the hosting environment for absolute canonical links and sitemap URLs.</p></section>
<div class="admin-actions"><button class="button button-primary" type="submit">Save site settings</button></div>
</form>
<?php admin_footer(); ?>
