/**
 * Publishing & scheduler.
 *
 * Shows what the cron job has done, lets an editor run the same pass manually,
 * and rebuilds the XML sitemap. The CLI cron job and this screen share one
 * implementation (Shn\Services\Scheduler), so what you see here is exactly what
 * the server will do unattended.
 */
import { useEffect, useState } from 'react'
import { CalendarClock, CheckCircle2, FileCode2, Play, RefreshCw, XCircle } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'
import { contentApi, formatUtc } from '@/admin/data/contentApi'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'

interface LogRow {
  id: number
  entity_type: string
  entity_id: number
  action: string
  scheduled_for: string | null
  executed_at: string
  actor: string
  message: string | null
}

const ACTION_TONE: Record<string, 'success' | 'amber' | 'rose' | 'slate'> = {
  published: 'success',
  scheduled: 'amber',
  skipped: 'slate',
  failed: 'rose',
  unpublished: 'slate',
}

export const PublishingPage = () => {
  const toast = useToast()
  const [log, setLog] = useState<LogRow[]>([])
  const [sitemap, setSitemap] = useState<{ path: string; last_updated: string | null; urls: number; base_url: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const [rows, status] = await Promise.all([contentApi.publishingLog(60), contentApi.sitemapStatus()])
      setLog(rows)
      setSitemap(status)
    } catch (cause) {
      toast.error('Could not load publishing data', cause instanceof Error ? cause.message : 'Try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      const result = await contentApi.runScheduler()
      toast.success(
        result.published.length ? `${result.published.length} item(s) published` : 'Nothing was due',
        result.checked ? `${result.checked} scheduled item(s) checked.` : 'The queue is empty.',
      )
      await load()
    } catch (cause) {
      toast.error('Scheduler failed', cause instanceof Error ? cause.message : 'Try again.')
    } finally {
      setRunning(false)
    }
  }

  const rebuild = async (): Promise<void> => {
    setRebuilding(true)
    try {
      const result = await contentApi.rebuildSitemap()
      toast.success('Sitemap rebuilt', `${result.urls} URLs · ${result.bytes} bytes`)
      await load()
    } catch (cause) {
      toast.error('Sitemap not rebuilt', cause instanceof Error ? cause.message : 'Check the folder permissions.')
    } finally {
      setRebuilding(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Publishing & scheduler"
        description={`Scheduled posts publish automatically. Times are stored in UTC and entered in ${ADMIN_CONFIG.publishing.timezoneLabel}.`}
        actions={
          <>
            <Button variant="ghost" size="sm" iconLeft={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={loading}>
              Refresh
            </Button>
            <Button size="sm" iconLeft={<Play className="h-4 w-4" />} onClick={() => void run()} loading={running}>
              Publish due items
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Publishing log" description="Every publish, skip and failure is recorded — duplicates are impossible." />
          {loading ? (
            <p className="p-6 text-sm text-muted">Loading…</p>
          ) : log.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-5 w-5" />}
              title="Nothing published yet"
              description="Schedule a post from the editor and it will appear here when the cron job runs."
            />
          ) : (
            <ul className="divide-y divide-line">
              {log.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">
                      {row.entity_type} #{row.entity_id} · {row.message ?? row.action}
                    </p>
                    <p className="text-2xs text-muted">
                      {formatUtc(row.executed_at)} · {row.actor}
                      {row.scheduled_for ? ` · was due ${formatUtc(row.scheduled_for)}` : ''}
                    </p>
                  </div>
                  <Badge tone={ACTION_TONE[row.action] ?? 'slate'}>{row.action}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Sitemap" description="Regenerated after every publish and by an hourly cron." />
            <div className="space-y-2 p-4 pt-0 text-xs text-muted">
              {sitemap ? (
                <>
                  <p className="flex items-center gap-1.5 text-ink">
                    <FileCode2 className="h-3.5 w-3.5 text-brand-600" />
                    {sitemap.urls} public URLs
                  </p>
                  <p>Last write: {sitemap.last_updated ? formatUtc(sitemap.last_updated) : 'never'}</p>
                  <p className="break-all font-mono text-2xs">{sitemap.path}</p>
                  <Button size="sm" variant="secondary" className="mt-1 w-full" onClick={() => void rebuild()} loading={rebuilding}>
                    Rebuild now
                  </Button>
                </>
              ) : (
                <p>Available when the console is connected to the API.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Cron command" description="Add this in cPanel → Cron Jobs." />
            <pre className="m-4 mt-0 overflow-x-auto rounded-lg bg-navy-950 p-3 text-2xs leading-relaxed text-emerald-200">
{`*/5 * * * * /usr/local/bin/php \\
  /home/USER/public_html/api/cron/publish-scheduled.php \\
  >> /home/USER/public_html/api/storage/logs/cron.log 2>&1`}
            </pre>
            <div className="flex flex-wrap gap-2 px-4 pb-4">
              <Badge tone="success">
                <CheckCircle2 className="h-3 w-3" /> 5 min
              </Badge>
              <Badge tone="slate">UTC timestamps</Badge>
              <Badge tone="rose">
                <XCircle className="h-3 w-3" /> no web access
              </Badge>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default PublishingPage
