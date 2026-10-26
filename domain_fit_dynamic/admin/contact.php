<?php
require_once __DIR__ . '/../includes/auth-check.php';
require_once __DIR__ . '/../includes/admin-ui.php';
require_once __DIR__ . '/../includes/analytics.php';
admin_require_permission($pdo,$admin,'manage_contacts');
function contact_csv_cell(string $value): string
{
    if (preg_match('/^[\s]*[=+\-@]/u',$value)) $value="'".$value;
    return '"'.str_replace('"','""',$value).'"';
}
if(isset($_GET['export'])&&$_GET['export']==='csv'){
    header('Content-Type: text/csv; charset=utf-8');header('Content-Disposition: attachment; filename="domainfits-contact-inbox-'.gmdate('Ymd-His').'.csv"');header('Cache-Control: no-store');
    $rows=$pdo->query('SELECT id,name,email,topic,subject,message,status,submitted_at FROM contact_messages ORDER BY submitted_at DESC')->fetchAll();
    echo "\xEF\xBB\xBF";echo implode(',',array_map('contact_csv_cell',['ID','Name','Email','Topic','Subject','Message','Status','Submitted UTC']))."\r\n";
    foreach($rows as $row)echo implode(',',array_map('contact_csv_cell',array_map(static fn($v)=>(string)$v,array_values($row))))."\r\n";
    exit;
}
if($_SERVER['REQUEST_METHOD']==='POST'){
    verify_csrf();$action=request_string($_POST, 'action', '');$id=filter_var($_POST['id']??null,FILTER_VALIDATE_INT);
    if(!$id){http_response_code(400);exit('Invalid contact message.');}
    if($action==='delete'){$pdo->prepare('DELETE FROM contact_messages WHERE id=:id')->execute(['id'=>$id]);audit_log($pdo,(int)$admin['id'],'contact.deleted','contact_message',(string)$id);flash('success','Message deleted.');redirect_to('admin/contact');}
    $status=in_array(($_POST['status']??''),['unread','read','replied','archived'],true)?(string)$_POST['status']:'';
    if($status===''){http_response_code(400);exit('Invalid status.');}
    $pdo->prepare('UPDATE contact_messages SET status=:status WHERE id=:id')->execute(['status'=>$status,'id'=>$id]);audit_log($pdo,(int)$admin['id'],'contact.status_changed','contact_message',(string)$id,'Status: '.$status);flash('success','Message status updated.');redirect_to('admin/contact?view='.$id);
}
$filter=in_array(($_GET['status']??''),['unread','read','replied','archived'],true)?(string)$_GET['status']:'';
$sql='SELECT id,name,email,topic,status,submitted_at FROM contact_messages';$params=[];if($filter!==''){$sql.=' WHERE status=:status';$params['status']=$filter;}$sql.=' ORDER BY submitted_at DESC LIMIT 300';$query=$pdo->prepare($sql);$query->execute($params);$messages=$query->fetchAll();
$selected=null;$viewId=filter_var($_GET['view']??null,FILTER_VALIDATE_INT);if($viewId){$show=$pdo->prepare('SELECT * FROM contact_messages WHERE id=:id LIMIT 1');$show->execute(['id'=>$viewId]);$selected=$show->fetch()?:null;}
admin_header($pdo,$admin,'Contact inbox');
?>
<div class="admin-actions" style="margin-bottom:1rem"><a class="button button-small" href="<?=e(app_url('admin/contact?export=csv'))?>">Export CSV</a><span class="admin-badge">Email is not sent automatically; respond using your mail client.</span></div>
<form class="admin-filter" method="get"><select name="status"><option value="">All statuses</option><?php foreach(['unread','read','replied','archived'] as $option):?><option value="<?=e($option)?>" <?=$filter===$option?'selected':''?>><?=e(ucfirst($option))?></option><?php endforeach;?></select><button class="button button-small" type="submit">Filter</button></form>
<div class="admin-columns"><section class="admin-card"><h2>Messages (latest 300)</h2><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>From</th><th>Topic / status</th><th>Received UTC</th></tr></thead><tbody><?php foreach($messages as $message):?><tr><td><a href="<?=e(app_url('admin/contact?view='.(int)$message['id']))?>"><?=e($message['name'])?></a><br><small><?=e($message['email'])?></small></td><td><?=e($message['topic'])?><br><span class="admin-badge"><?=e(ucfirst($message['status']))?></span></td><td><?=e($message['submitted_at'])?></td></tr><?php endforeach;?><?php if(!$messages):?><tr><td colspan="3">No messages in this view.</td></tr><?php endif;?></tbody></table></div></section>
<section class="admin-card"><h2><?= $selected?'Message details':'Select a message' ?></h2><?php if($selected):?><p><strong><?=e($selected['name'])?></strong> · <a href="mailto:<?=e(rawurlencode($selected['email']))?>?subject=<?=e(rawurlencode('Re: '.$selected['topic']))?>">Reply in email</a></p><p><?=e($selected['email'])?> · <?=e($selected['topic'])?> · <?=e($selected['submitted_at'])?> UTC</p><pre class="message-body"><?=e($selected['message'])?></pre><form class="admin-form" method="post"><?=csrf_field()?><input type="hidden" name="id" value="<?=(int)$selected['id']?>"><div class="field"><label for="status">Status</label><select id="status" name="status"><?php foreach(['unread','read','replied','archived'] as $option):?><option value="<?=e($option)?>" <?=$selected['status']===$option?'selected':''?>><?=e(ucfirst($option))?></option><?php endforeach;?></select></div><div class="admin-actions"><button class="button button-primary" type="submit">Update status</button></div></form><form method="post" data-confirm="Permanently delete this contact message?"><?=csrf_field()?><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="<?=(int)$selected['id']?>"><button class="admin-danger" type="submit">Delete message</button></form><?php endif;?></section></div>
<?php admin_footer(); ?>
