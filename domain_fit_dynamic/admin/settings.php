<?php
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';
require_once __DIR__ . '/../includes/gemini.php';
admin_require_permission($pdo,$admin,'manage_settings');
$errorMessage='';
$customHeadCode = (string) private_setting($pdo,'custom_head_code','');
$customFooterCode = (string) private_setting($pdo,'custom_footer_code','');
if ($_SERVER['REQUEST_METHOD']==='POST') {
    // Keep submitted values visible if validation or a database/upload error occurs.
    $customHeadCode = request_string($_POST,'custom_head_code',$customHeadCode);
    $customFooterCode = request_string($_POST,'custom_footer_code',$customFooterCode);
    $postLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if (empty($_POST) && $postLength > 0) {
        error_log('Site settings form body was empty; received content length=' . $postLength . '. Check PHP post_max_size/upload limits.');
        $errorMessage='The server did not receive the settings form. Check PHP post_max_size and upload limits, then retry.';
    } else {
        verify_csrf();
        $expectedFields=['site_title','site_description','site_author','google_site_verification','theme_mode','primary_color','accent_color','hero_title','hero_subtitle','hero_cta','hero_secondary','footer_text','copyright_text','generator_controls_mode','custom_head_code','custom_footer_code','gemini_api_key'];
        $missingFields=[];
        foreach($expectedFields as $fieldName){if(!array_key_exists($fieldName,$_POST)||!is_scalar($_POST[$fieldName]))$missingFields[]=$fieldName;}
        if($missingFields){
            error_log('Site settings payload missing fields: ' . implode(',', $missingFields));
            $errorMessage='Some settings fields did not reach the server. No values were changed; refresh the page and try again.';
        } else {
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
        $customHeadCode=request_string($_POST,'custom_head_code','');
        $customFooterCode=request_string($_POST,'custom_footer_code','');
        if(strlen($customHeadCode)>20000||strlen($customFooterCode)>20000) throw new RuntimeException('Header and footer code must each be no larger than 20 KB.');
        foreach([$customHeadCode,$customFooterCode] as $injectionCode){
            if(preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/',$injectionCode)||preg_match('~</(?:head|body)\b~i',$injectionCode)) throw new RuntimeException('Injected code contains a forbidden control character or document-closing tag.');
        }
        $customHeadCode=trim($customHeadCode);$customFooterCode=trim($customFooterCode);
        $geminiApiKeyInput=trim(request_string($_POST,'gemini_api_key',''));
        $clearGeminiApiKey=isset($_POST['clear_gemini_api_key']);
        if(strlen($geminiApiKeyInput)>512||preg_match('/[\r\n\x00]/',$geminiApiKeyInput)) throw new RuntimeException('Gemini API key must be a single line of at most 512 characters.');
        if($geminiApiKeyInput!==''&&$clearGeminiApiKey) throw new RuntimeException('Choose either replacing or clearing the Gemini API key, not both.');
        $encryptedGeminiApiKey=$geminiApiKeyInput!==''?encrypt_private_secret($geminiApiKeyInput):null;
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
        save_setting($pdo,'custom_head_code',$customHeadCode,(int)$admin['id'],false);
        save_setting($pdo,'custom_footer_code',$customFooterCode,(int)$admin['id'],false);
        if($encryptedGeminiApiKey!==null) save_setting($pdo,'gemini_api_key',$encryptedGeminiApiKey,(int)$admin['id'],false);
        elseif($clearGeminiApiKey) save_setting($pdo,'gemini_api_key','',(int)$admin['id'],false);
        $verificationValues=$values+['custom_head_code'=>$customHeadCode,'custom_footer_code'=>$customFooterCode];
        if($encryptedGeminiApiKey!==null)$verificationValues['gemini_api_key']=$encryptedGeminiApiKey;
        elseif($clearGeminiApiKey)$verificationValues['gemini_api_key']='';
        $verifySetting=$pdo->prepare('SELECT value_json FROM site_settings WHERE setting_key=:key LIMIT 1');
        foreach($verificationValues as $key=>$expectedValue){
            $verifySetting->execute(['key'=>$key]);
            $storedJson=$verifySetting->fetchColumn();
            if($storedJson===false){throw new RuntimeException('A setting could not be verified in the database. No changes were committed.');}
            try{$storedValue=json_decode((string)$storedJson,true,512,JSON_THROW_ON_ERROR);}catch(Throwable $decodeError){throw new RuntimeException('The database returned an invalid settings value. No changes were committed.');}
            if($storedValue!==$expectedValue){throw new RuntimeException('A setting failed the database save check. No changes were committed; verify the site_settings JSON column and database permissions.');}
        }
        audit_log($pdo,(int)$admin['id'],'settings.updated','site_settings','public','Site identity, code injection and integration settings updated.');
        $pdo->commit();
        cache_clear_all();
        flash('success','Site settings saved.');
        redirect_to('admin/site-settings');
    } catch(Throwable $error) {
        if($pdo->inTransaction())$pdo->rollBack();
        error_log('Site settings: '.$error->getMessage());
        $errorMessage=$error instanceof RuntimeException?$error->getMessage():'Settings could not be saved. Check uploaded image files and configuration.';
    }
        }
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
if($errorMessage!==''&&$_SERVER['REQUEST_METHOD']==='POST'){
    $postedSettingMap=[
        'site_title'=>'site_title','site_description'=>'site_description','site_author'=>'site_author',
        'google_site_verification'=>'google_site_verification','theme_mode'=>'theme_mode','primary_color'=>'primary_color',
        'accent_color'=>'accent_color','hero_title'=>'hero_title','hero_subtitle'=>'hero_subtitle',
        'hero_cta'=>'hero_cta','hero_secondary'=>'hero_secondary','footer_text'=>'footer_text',
        'copyright_text'=>'copyright_text','generator_controls_mode'=>'generator_controls_mode'
    ];
    foreach($postedSettingMap as $fieldName=>$settingKey){
        if(array_key_exists($fieldName,$_POST)&&is_scalar($_POST[$fieldName]))$settings[$settingKey]=(string)$_POST[$fieldName];
    }
    $settings['site_analytics_enabled']=isset($_POST['site_analytics_enabled']);
}
$geminiKeyConfigured=gemini_api_key_configured($pdo);
admin_header($pdo,$admin,'Site settings');
?>
<?php if($errorMessage!==''):?><div class="notice notice-error" role="alert"><?=e($errorMessage)?></div><?php endif;?>
<form class="admin-form" method="post" action="<?=e(app_url('admin/site-settings'))?>" enctype="multipart/form-data"><?=csrf_field()?>
<section class="admin-card"><h2>Identity &amp; search metadata</h2><div class="form-row"><div class="field"><label for="site_title">Site title</label><input id="site_title" name="site_title" maxlength="120" required value="<?=e($settings['site_title'])?>"></div><div class="field"><label for="site_author">Structured-data author name</label><input id="site_author" name="site_author" maxlength="120" value="<?=e($settings['site_author'])?>"></div></div><div class="field"><label for="site_description">Default meta description</label><textarea id="site_description" name="site_description" maxlength="320" rows="3"><?=e($settings['site_description'])?></textarea></div><div class="field"><label for="google_site_verification">Search Console verification token</label><input id="google_site_verification" name="google_site_verification" maxlength="200" value="<?=e($settings['google_site_verification']??'')?>"><small>Blank unless a token was issued for your verified domain.</small></div></section>
<section class="admin-card"><h2>Brand, theme &amp; homepage</h2><div class="form-row three"><div class="field"><label for="theme_mode">Default theme</label><select id="theme_mode" name="theme_mode"><option value="light" <?=$settings['theme_mode']==='light'?'selected':''?>>Light</option><option value="dark" <?=$settings['theme_mode']==='dark'?'selected':''?>>Dark</option></select></div><div class="field"><label for="primary_color">Primary color</label><input id="primary_color" name="primary_color" type="color" value="<?=e($settings['primary_color'])?>"></div><div class="field"><label for="accent_color">Accent color</label><input id="accent_color" name="accent_color" type="color" value="<?=e($settings['accent_color'])?>"></div></div><div class="form-row"><div class="field"><label for="logo_file">Logo upload (JPEG, PNG or WebP · max 5 MB)</label><?php if($settings['logo_path']):?><small>Current logo: <?=e($settings['logo_path'])?></small><?php endif;?><input id="logo_file" type="file" name="logo_file" accept="image/jpeg,image/png,image/webp"></div><div class="field"><label for="hero_image_file">Homepage hero image (optional)</label><?php if($settings['hero_image_path']):?><small>Current hero image: <?=e($settings['hero_image_path'])?></small><?php endif;?><input id="hero_image_file" type="file" name="hero_image_file" accept="image/jpeg,image/png,image/webp"></div></div><div class="field"><label for="hero_title">Hero heading</label><input id="hero_title" name="hero_title" maxlength="180" required value="<?=e($settings['hero_title'])?>"></div><div class="field"><label for="hero_subtitle">Hero description</label><textarea id="hero_subtitle" name="hero_subtitle" maxlength="500" rows="3" required><?=e($settings['hero_subtitle'])?></textarea></div><div class="form-row"><div class="field"><label for="hero_cta">Primary button label</label><input id="hero_cta" name="hero_cta" maxlength="80" value="<?=e($settings['hero_cta'])?>"></div><div class="field"><label for="hero_secondary">Secondary link label</label><input id="hero_secondary" name="hero_secondary" maxlength="80" value="<?=e($settings['hero_secondary'])?>"></div></div><div class="form-row"><div class="field"><label for="footer_text">Footer description</label><input id="footer_text" name="footer_text" maxlength="240" value="<?=e($settings['footer_text'])?>"></div><div class="field"><label for="copyright_text">Copyright line (optional)</label><input id="copyright_text" name="copyright_text" maxlength="200" value="<?=e($settings['copyright_text'])?>"></div></div></section>
<section class="admin-card"><h2>Generator &amp; first-party analytics</h2><div class="field"><label for="generator_controls_mode">Generator settings on mobile</label><select id="generator_controls_mode" name="generator_controls_mode"><option value="drawer" <?=$settings['generator_controls_mode']==='drawer'?'selected':''?>>Mobile drawer (desktop remains inline)</option><option value="accordion" <?=$settings['generator_controls_mode']==='accordion'?'selected':''?>>Mobile accordion (desktop remains inline)</option></select></div><label class="inline-check"><input type="checkbox" name="site_analytics_enabled" value="1" <?=$settings['site_analytics_enabled']?'checked':''?>><span>Enable privacy-aware first-party page-view and generator-run counts</span></label><p>First-party analytics is off by default. When enabled, the site stores event type and page path; it stores no raw IP address and does not track AdSense clicks. Configure a unique ANALYTICS_SALT environment variable if you need daily approximate unique counts, and update your privacy information before enabling.</p></section>
<section class="admin-card"><h2>Third-party integrations</h2><p>GA4, Tag Manager and AdSense are separate, blank/off controls. Configure actual account IDs and explicit switches in <a href="<?=e(app_url('admin/ads'))?>">Ads &amp; integrations</a>. Third-party consent, policy and legal requirements depend on your deployment.</p><p>Production origin: <code><?=e(getenv('SITE_ORIGIN')?:'Not configured')?></code>. Set SITE_ORIGIN in the hosting environment for absolute canonical links and sitemap URLs.</p></section>
<section class="admin-card admin-danger-zone"><h2>Header &amp; footer code injection</h2><p>Only use vendor-issued verification, analytics or tag-manager code. Saved snippets are rendered on every public CMS page. This is a privileged feature; keep the fields blank unless you intentionally configure an integration. Avoid duplicating GA4/GTM already enabled in Ads &amp; integrations.</p><div class="form-row"><div class="field"><label for="custom_head_code">Code in document head</label><textarea class="code-input" id="custom_head_code" name="custom_head_code" maxlength="20000" rows="9" spellcheck="false"><?=e($customHeadCode)?></textarea><small>Maximum 20 KB. This field is blank by default.</small></div><div class="field"><label for="custom_footer_code">Code before closing body</label><textarea class="code-input" id="custom_footer_code" name="custom_footer_code" maxlength="20000" rows="9" spellcheck="false"><?=e($customFooterCode)?></textarea><small>Maximum 20 KB. Closing document tags are rejected.</small></div></div><p>These snippets are stored as private CMS settings but become public browser code when rendered. Never paste passwords, private server keys or payment secrets here.</p></section>
<section class="admin-card"><h2>Gemini Domain Brain integration</h2><p>Status: <span class="admin-badge <?=$geminiKeyConfigured?'admin-badge--published':'admin-badge--draft'?>"><?=$geminiKeyConfigured?'API key configured':'Not configured'?></span>. Gemini calls are made server-side; the key is not sent to browser JavaScript.</p><div class="field"><label for="gemini_api_key">Gemini API key</label><input id="gemini_api_key" name="gemini_api_key" type="password" maxlength="512" autocomplete="new-password" value="" placeholder="Leave blank to keep the existing key"><small>When entered here, the key is encrypted at rest with AES-256-GCM using APP_SECRET. Alternatively, set GEMINI_API_KEY in the server environment; it takes precedence.</small></div><label class="inline-check"><input type="checkbox" name="clear_gemini_api_key" value="1"><span>Clear the encrypted CMS key (does not override a server environment key)</span></label><p>Changing APP_SECRET makes the stored key unreadable; re-enter it after rotating that secret. Generated terms stay marked unverified until a human editor reviews them.</p></section>
<div class="admin-actions"><button class="button button-primary" type="submit">Save site settings</button></div>
</form>
<?php admin_footer(); ?>
