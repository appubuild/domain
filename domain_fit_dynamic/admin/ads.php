<?php
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';
admin_require_permission($pdo,$admin,'manage_ads');
$errorMessage='';
if($_SERVER['REQUEST_METHOD']==='POST'){
 verify_csrf();
 try{
  $adsEnabled=isset($_POST['ads_enabled']);
  $ga4Input=$_POST['ga4_measurement_id']??'';$ga4Id=strtoupper(trim(substr(is_scalar($ga4Input)?(string)$ga4Input:'',0,32)));
  $ga4Enabled=isset($_POST['ga4_enabled']);
  $gtmInput=$_POST['gtm_container_id']??'';$gtmId=strtoupper(trim(substr(is_scalar($gtmInput)?(string)$gtmInput:'',0,32)));
  $gtmEnabled=isset($_POST['gtm_enabled']);
  if($ga4Id!==''&&!preg_match('/^G-[A-Z0-9]{6,12}$/',$ga4Id))throw new RuntimeException('GA4 measurement ID must match the G-XXXXXXXXXX format.');
  if($ga4Enabled&&$ga4Id==='')throw new RuntimeException('Enter a real GA4 measurement ID before enabling GA4.');
  if($gtmId!==''&&!preg_match('/^GTM-[A-Z0-9]{4,12}$/',$gtmId))throw new RuntimeException('Tag Manager container ID must match the GTM-XXXXXXX format.');
  if($gtmEnabled&&$gtmId==='')throw new RuntimeException('Enter a real Tag Manager container ID before enabling it.');
  $txtInput=$_POST['ads_txt']??'';$txt=trim(is_string($txtInput)?$txtInput:'');
  if(strlen($txt)>20000)throw new RuntimeException('ads.txt content must be no larger than 20 KB.');
  $cleanLines=[];
  foreach(preg_split('/\r\n|\r|\n/',$txt)?:[] as $line){
   $line=trim($line);if($line==='')continue;
   if(str_starts_with($line,'#')){if(strlen($line)>200||!preg_match('/^#[A-Za-z0-9 .,;:_-]*$/',$line))throw new RuntimeException('ads.txt comment contains unsupported characters.');$cleanLines[]=$line;continue;}
   if(!preg_match('/^[A-Za-z0-9.-]+\s*,\s*(?:pub-[0-9]{16}|[A-Za-z0-9-]{1,80})\s*,\s*(?:DIRECT|RESELLER)(?:\s*,\s*[A-Fa-f0-9-]{8,64})?$/i',$line))throw new RuntimeException('One ads.txt line is invalid. Only standard owner, publisher, relationship and optional certification fields are accepted.');
   $cleanLines[]=$line;
  }
  $slotRows=$pdo->query('SELECT placement FROM ad_slots ORDER BY placement')->fetchAll(PDO::FETCH_COLUMN);
  $publisherInputs=is_array($_POST['publisher_id']??null)?$_POST['publisher_id']:[];
  $unitInputs=is_array($_POST['ad_unit_id']??null)?$_POST['ad_unit_id']:[];
  $formatInputs=is_array($_POST['ad_format']??null)?$_POST['ad_format']:[];
  $enabledInputs=is_array($_POST['slot_enabled']??null)?$_POST['slot_enabled']:[];
  $validEnabledSlots=0;$slotData=[];
  foreach($slotRows as $placement){
   $publisherValue=$publisherInputs[$placement]??'';$unitValue=$unitInputs[$placement]??'';$formatValue=$formatInputs[$placement]??'auto';
   $publisher=trim(substr(is_scalar($publisherValue)?(string)$publisherValue:'',0,32));
   $unit=trim(substr(is_scalar($unitValue)?(string)$unitValue:'',0,32));
   $format=is_string($formatValue)&&in_array($formatValue,['auto','rectangle','horizontal','vertical'],true)?$formatValue:'auto';
   $enabled=isset($enabledInputs[$placement]);
   if($enabled&&(!preg_match('/^ca-pub-[0-9]{16}$/',$publisher)||!preg_match('/^[0-9]{10,20}$/',$unit)))throw new RuntimeException('An enabled AdSense slot is missing a valid publisher or ad-unit ID. Use only IDs issued in your AdSense account.');
   if($publisher!==''&&!preg_match('/^ca-pub-[0-9]{16}$/',$publisher))throw new RuntimeException('A publisher ID is invalid.');
   if($unit!==''&&!preg_match('/^[0-9]{10,20}$/',$unit))throw new RuntimeException('An ad-unit ID is invalid.');
   if($enabled)$validEnabledSlots++;
   $slotData[]=['placement'=>$placement,'publisher'=>$publisher,'unit'=>$unit,'format'=>$format,'enabled'=>$enabled];
  }
  if($adsEnabled&&$validEnabledSlots===0)throw new RuntimeException('Before turning on site ads, configure at least one real and enabled AdSense slot.');
  $pdo->beginTransaction();
  foreach($slotData as $slot){$save=$pdo->prepare('UPDATE ad_slots SET publisher_id=:publisher,ad_unit_id=:unit,ad_format=:format,is_enabled=:enabled,updated_by=:admin WHERE placement=:placement');$save->execute(['publisher'=>$slot['publisher'],'unit'=>$slot['unit'],'format'=>$slot['format'],'enabled'=>$slot['enabled']?1:0,'admin'=>(int)$admin['id'],'placement'=>$slot['placement']]);}
  save_setting($pdo,'ads_enabled',$adsEnabled,(int)$admin['id'],true);
  save_setting($pdo,'ads_txt',implode("\n",$cleanLines),(int)$admin['id'],false);
  save_setting($pdo,'ga4_measurement_id',$ga4Id,(int)$admin['id'],false);
  save_setting($pdo,'ga4_enabled',$ga4Enabled,(int)$admin['id'],false);
  save_setting($pdo,'gtm_container_id',$gtmId,(int)$admin['id'],false);
  save_setting($pdo,'gtm_enabled',$gtmEnabled,(int)$admin['id'],false);
  audit_log($pdo,(int)$admin['id'],'integrations.updated','ads','all','Ads, ads.txt and analytics integration settings updated.');
  $pdo->commit();
  cache_clear_all();flash('success','Advertising and integration settings saved.');redirect_to('admin/ads');
 }catch(Throwable $error){if($pdo->inTransaction())$pdo->rollBack();error_log('Ads/settings: '.$error->getMessage());$errorMessage=$error instanceof RuntimeException?$error->getMessage():'Settings could not be saved. Check IDs and database configuration.';}
}
$slots=$pdo->query('SELECT placement,label,publisher_id,ad_unit_id,ad_format,is_enabled FROM ad_slots ORDER BY id')->fetchAll();
$adsEnabled=(bool)setting($pdo,'ads_enabled',false);
$adsTxt=(string)private_setting($pdo,'ads_txt','');
$ga4Id=(string)private_setting($pdo,'ga4_measurement_id','');$ga4Enabled=(bool)private_setting($pdo,'ga4_enabled',false);
$gtmId=(string)private_setting($pdo,'gtm_container_id','');$gtmEnabled=(bool)private_setting($pdo,'gtm_enabled',false);
admin_header($pdo,$admin,'Ads & integrations');
?>
<?php if($errorMessage!==''):?><div class="notice notice-error" role="alert"><?=e($errorMessage)?></div><?php endif;?>
<form class="admin-form" method="post"><?=csrf_field()?>
<section class="admin-card"><h2>Web-only AdSense slots</h2><p>Ads are off until a publisher ID and real ad-unit ID are entered. This CMS never records AdSense ad-clicks in its own analytics. Native/offline Capacitor app bundles are separate and do not use this PHP site's ad rendering.</p><label class="inline-check"><input type="checkbox" name="ads_enabled" value="1" <?=$adsEnabled?'checked':''?>><span>Enable configured web ad slots globally</span></label>
<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Placement</th><th>Publisher ID</th><th>Ad-unit ID</th><th>Format</th><th>Enabled</th></tr></thead><tbody><?php foreach($slots as $slot):?><tr><td><strong><?=e($slot['label'])?></strong><br><code><?=e($slot['placement'])?></code></td><td><input name="publisher_id[<?=e($slot['placement'])?>]" maxlength="32" value="<?=e($slot['publisher_id'])?>" placeholder="ca-pub-0000000000000000" aria-label="Publisher ID for <?=e($slot['placement'])?>"></td><td><input name="ad_unit_id[<?=e($slot['placement'])?>]" maxlength="32" value="<?=e($slot['ad_unit_id'])?>" placeholder="Ad unit ID" aria-label="Ad-unit ID for <?=e($slot['placement'])?>"></td><td><select name="ad_format[<?=e($slot['placement'])?>]" aria-label="Format for <?=e($slot['placement'])?>"><?php foreach(['auto','rectangle','horizontal','vertical'] as $format):?><option value="<?=e($format)?>" <?=$slot['ad_format']===$format?'selected':''?>><?=e(ucfirst($format))?></option><?php endforeach;?></select></td><td><input type="checkbox" name="slot_enabled[<?=e($slot['placement'])?>]" value="1" <?=$slot['is_enabled']?'checked':''?> aria-label="Enable <?=e($slot['placement'])?>"></td></tr><?php endforeach;?></tbody></table></div></section>
<section class="admin-card"><h2>ads.txt</h2><p>Only standard ads.txt rows and safe comments are served at <code>/ads.txt</code>. Add records issued by your actual advertising account; no placeholder IDs are preloaded.</p><div class="field"><label for="ads_txt">ads.txt rows</label><textarea class="code-input" id="ads_txt" name="ads_txt" maxlength="20000" rows="8" placeholder="google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0"><?=e($adsTxt)?></textarea></div></section>
<section class="admin-card"><h2>Google analytics integrations (off by default)</h2><div class="form-row"><div class="field"><label for="ga4_measurement_id">GA4 measurement ID</label><input id="ga4_measurement_id" name="ga4_measurement_id" maxlength="32" value="<?=e($ga4Id)?>" placeholder="G-XXXXXXXXXX"></div><div class="field"><label for="gtm_container_id">Google Tag Manager container ID</label><input id="gtm_container_id" name="gtm_container_id" maxlength="32" value="<?=e($gtmId)?>" placeholder="GTM-XXXXXXX"></div></div><div class="form-row"><label class="inline-check"><input type="checkbox" name="ga4_enabled" value="1" <?=$ga4Enabled?'checked':''?>><span>Enable GA4 script</span></label><label class="inline-check"><input type="checkbox" name="gtm_enabled" value="1" <?=$gtmEnabled?'checked':''?>><span>Enable Tag Manager script</span></label></div><p>Use an actual ID from your account. Enabling overlapping GA4 and Tag Manager setups may double-count events. Consent, disclosure and retention requirements depend on your site configuration and local law; this CMS does not provide a consent-management platform.</p></section>
<div class="admin-actions"><button class="button button-primary" type="submit">Save ads &amp; integrations</button></div></form>
<?php admin_footer(); ?>
