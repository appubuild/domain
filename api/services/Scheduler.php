<?php
/**
 * Scheduled publishing.
 *
 * Publishes blog posts and pages whose `scheduled_at` (UTC) has passed and
 * writes every transition to `publishing_log`. Shared by the CLI cron job
 * (api/cron/publish-scheduled.php) and the admin "Run scheduler now" button so
 * both do exactly the same thing.
 *
 * Duplicate protection is the status guard on the UPDATE: only a row that is
 * still `scheduled` can move to `published`, so two overlapping runs cannot
 * publish — or log — the same item twice.
 */

declare(strict_types=1);

namespace Shn\Services;

use Shn\Helpers\Database;
use Shn\Models\BlogModel;
use Shn\Models\PageModel;
use Throwable;

final class Scheduler
{
    public function __construct(
        private readonly BlogModel $blog = new BlogModel(),
        private readonly PageModel $pages = new PageModel(),
    ) {
    }

    /**
     * Runs one pass.
     *
     * @return array{published:array<int,array<string,mixed>>,failed:array<int,array<string,mixed>>,checked:int}
     */
    public function run(string $actor = 'cron', int $limit = 50): array
    {
        $published = [];
        $failed = [];
        $checked = 0;

        foreach (['post' => $this->blog, 'page' => $this->pages] as $type => $model) {
            $due = $model->dueScheduled($limit);
            $checked += count($due);

            foreach ($due as $row) {
                $id = (int) $row['id'];
                try {
                    $won = $model->publishScheduled($id);
                    if (!$won) {
                        // Someone else already published it between the SELECT
                        // and the UPDATE — log a skip, never a second publish.
                        $this->log($type, $id, 'skipped', $row['scheduled_at'] ?? null, $actor, 'Already published by another run.');
                        continue;
                    }

                    $this->log($type, $id, 'published', $row['scheduled_at'] ?? null, $actor, 'Published "' . $row['title'] . '".');
                    $published[] = ['type' => $type, 'id' => $id, 'slug' => $row['slug'], 'title' => $row['title']];
                } catch (Throwable $error) {
                    $this->log($type, $id, 'failed', $row['scheduled_at'] ?? null, $actor, mb_substr($error->getMessage(), 0, 480));
                    $failed[] = ['type' => $type, 'id' => $id, 'slug' => $row['slug'], 'error' => $error->getMessage()];
                }
            }
        }

        if ($published !== []) {
            // A publish changes the public URL set: regenerate the sitemap now
            // so crawlers see the new article without waiting for the next run.
            try {
                (new SitemapBuilder())->write();
            } catch (Throwable $error) {
                $this->log('post', 0, 'failed', null, $actor, 'Sitemap rebuild failed: ' . $error->getMessage());
            }
        }

        return ['published' => $published, 'failed' => $failed, 'checked' => $checked];
    }

    /** @return array<int,array<string,mixed>> */
    public function recent(int $limit = 50): array
    {
        $statement = Database::pdo()->prepare(
            'SELECT id, entity_type, entity_id, action, scheduled_for, executed_at, actor, message
               FROM publishing_log ORDER BY id DESC LIMIT ' . max(1, min(200, $limit)),
        );
        $statement->execute();
        return $statement->fetchAll(\PDO::FETCH_ASSOC) ?: [];
    }

    public function log(string $type, int $id, string $action, ?string $scheduledFor, string $actor, string $message): void
    {
        $statement = Database::pdo()->prepare(
            'INSERT INTO publishing_log (entity_type, entity_id, action, scheduled_for, actor, message)
             VALUES (:type, :id, :action, :scheduled_for, :actor, :message)',
        );
        $statement->execute([
            ':type' => $type,
            ':id' => $id,
            ':action' => $action,
            ':scheduled_for' => $scheduledFor,
            ':actor' => mb_substr($actor, 0, 60),
            ':message' => mb_substr($message, 0, 500),
        ]);
    }

    /** Queues an audit entry when an editor schedules something by hand. */
    public function logScheduled(string $type, int $id, ?string $scheduledFor, string $actor): void
    {
        $this->log($type, $id, 'scheduled', $scheduledFor, $actor, 'Scheduled for ' . ($scheduledFor ?? 'an unset time') . ' (UTC).');
    }
}
