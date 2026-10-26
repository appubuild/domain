<?php
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
require_once __DIR__ . '/../includes/cache.php';
admin_require_permission($pdo,$admin,'manage_settings');
$errorMessage='';
if($_SERVER['REQUEST_METHOD']==='POST'){
 verify_csrf();$action=request_string($_POST, 'action', 'save');
 try{
  if($action==='delete'){
   $id=filter_var($_POST['id']??null,FILTER_VALIDATE_INT);if(!$id)throw new RuntimeException('Invalid navigation item.');
   $pdo->prepare('DELETE FROM navigation_items WHERE id=:id')->execute(['id'=>$id]);
   audit_log($pdo,(int)$admin['id'],'navigation.deleted','navigation_item',(string)$id);flash('success','Navigation item deleted.');cache_clear_all();redirect_to('admin/navigation.php');
  }
  $id=filter_var($_POST['id']??null,FILTER_VALIDATE_INT)?:0;
  $location=in_array(($_POST['menu_location']??''),['header','footer'],true)?(string)$_POST['menu_location']:'header';
  $label=trim(substr(strip_tags(request_string($_POST, 'label', '')),0,100));$href=trim(substr(request_string($_POST, 'href', ''),0,500));
  $group=trim(substr(strip_tags(request_string($_POST, 'group_label', '')),0,80));$sort=max(-10000,min(10000,(int)($_POST['sort_order']??0)));$active=isset($_POST['is_active'])?1:0;
  $external=preg_match('~^(https://|mailto:|tel:)~i',$href)===1;
  $safeLocal=$href!==''&&!str_starts_with($href,'//')&&!preg_match('~^[a-z][a-z0-9+.-]*:~i',$href)&&!str_contains($href,'..');
  if($label===''||(!$external&&!$safeLocal))throw new RuntimeException('Enter a label and a local relative path or HTTPS/mailto/tel URL.');
  if($id){$sql=$pdo->prepare('UPDATE navigation_items SET menu_location=:location,group_label=:group,label=:label,href=:href,sort_order=:sort,is_active=:active WHERE id=:id');$sql->execute(['location'=>$location,'group'=>$group,'label'=>$label,'href'=>$href,'sort'=>$sort,'active'=>$active,'id'=>$id]);}
  else{$sql=$pdo->prepare('INSERT INTO navigation_items(menu_location,group_label,label,href,sort_order,is_active) VALUES(:location,:group,:label,:href,:sort,:active)');$sql->execute(['location'=>$location,'group'=>$group,'label'=>$label,'href'=>$href,'sort'=>$sort,'active'=>$active]);$id=(int)$pdo->lastInsertId();}
  audit_log($pdo,(int)$admin['id'],'navigation.saved','navigation_item',(string)$id,$label);cache_clear_all();flash('success','Navigation item saved.');redirect_to('admin/navigation.php');
 }catch(Throwable $error){if($pdo->inTransaction())$pdo->rollBack();error_log('Navigation save: '.$error->getMessage());$errorMessage=$error instanceof RuntimeException?$error->getMessage():'Could not save this navigation item; check for a duplicate label.';}
}
$items=$pdo->query('SELECT * FROM navigation_items ORDER BY menu_location,group_label,sort_order,id')->fetchAll();
$editing=null;if(isset($_GET['edit'])){$id=filter_var($_GET['edit'],FILTER_VALIDATE_INT);foreach($items as $item)if((int)$item['id']===$id)$editing=$item;}
admin_header($pdo,$admin,'Navigation menus');
?>
<?php if($errorMessage!==''):?><div class="notice notice-error" role="alert"><?=e($errorMessage)?></div><?php endif;?>
<div class="admin-columns"><section class="admin-card"><h2><?=$editing?'Edit':'Add'?> menu item</h2><form class="admin-form" method="post"><?=csrf_field()?><?php if($editing):?><input type="hidden" name="id" value="<?=(int)$editing['id']?>"><?php endif;?><div class="form-row"><div class="field"><label for="label">Label</label><input id="label" name="label" maxlength="100" required value="<?=e($editing['label']??'')?>"></div><div class="field"><label for="menu_location">Location</label><select id="menu_location" name="menu_location"><option value="header" <?=($editing['menu_location']??'header')==='header'?'selected':''?>>Header</option><option value="footer" <?=($editing['menu_location']??'header')==='footer'?'selected':''?>>Footer</option></select></div></div><div class="field"><label for="href">Destination</label><input id="href" name="href" maxlength="500" required placeholder="pages/about or https://example.com" value="<?=e($editing['href']??'')?>"><small>Internal paths are relative to this CMS (for example pages/contact, blog/, tools/domain-generator).</small></div><div class="form-row"><div class="field"><label for="group_label">Footer group (footer only)</label><input id="group_label" name="group_label" maxlength="80" value="<?=e($editing['group_label']??'')?>"></div><div class="field"><label for="sort_order">Sort order</label><input id="sort_order" type="number" name="sort_order" min="-10000" max="10000" value="<?=e($editing['sort_order']??10)?>"></div></div><label class="inline-check"><input type="checkbox" name="is_active" value="1" <?=!$editing||$editing['is_active']?'checked':''?>><span>Show this link</span></label><div class="admin-actions"><button class="button button-primary" type="submit">Save menu item</button><?php if($editing):?><a class="button button-small" href="<?=e(app_url('admin/navigation.php'))?>">Cancel edit</a><?php endif;?></div></form></section><section class="admin-card"><h2>Header and footer links</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Link</th><th>Location / group</th><th>Order</th><th>Actions</th></tr></thead><tbody><?php foreach($items as $item):?><tr><td><strong><?=e($item['label'])?></strong><br><small><?=e($item['href'])?></small><?php if(!$item['is_active']):?><br><span class="admin-badge">Hidden</span><?php endif;?></td><td><?=e(ucfirst($item['menu_location']))?><?= $item['group_label']!==''?' · '.e($item['group_label']):''?></td><td><?=(int)$item['sort_order']?></td><td><div class="admin-actions"><a href="<?=e(app_url('admin/navigation.php?edit='.(int)$item['id']))?>">Edit</a><form method="post" data-confirm="Delete this menu item?"><?=csrf_field()?><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="<?=(int)$item['id']?>"><button class="admin-danger" type="submit">Delete</button></form></div></td></tr><?php endforeach;?></tbody></table></div></section></div>
<?php admin_footer(); ?>
