import { useState } from 'react'
import { Link } from 'react-router-dom'
import useStore from '../store'

export default function Reports() {
  const reports = useStore((s) => [...s.reports].sort((a, b) => b.created_at.localeCompare(a.created_at)))
  const deleteReport = useStore((s) => s.deleteReport)
  const clients = useStore((s) => s.clients)
  const websites = useStore((s) => s.websites)
  const tasks = useStore((s) => s.tasks)
  const runs = useStore((s) => s.runs)

  const [filter, setFilter] = useState('all') // 'all' | 'baseline' | 'rerun'
  const [search, setSearch] = useState('')

  const filtered = reports.filter((r) => {
    if (filter !== 'all' && r.run_type !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        (r.website_name || '').toLowerCase().includes(q) ||
        (r.environment || '').toLowerCase().includes(q) ||
        (r.summary || '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const getTaskForReport = (r) => tasks.find((t) => t.id === r.task_id)
  const getWebsiteForReport = (r) => websites.find((w) => w.id === r.website_id)

  const downloadReport = (r) => {
    const run = runs.find((run) => run.id === r.run_id)
    if (!run) return
    const report = {
      report_id: r.id,
      run_id: run.id,
      website: r.website_name,
      run_type: run.run_type,
      environment: run.environment,
      status: run.status,
      created_at: run.created_at,
      completed_at: run.completed_at,
      summary: run.summary,
      stats: {
        page_count: r.page_count,
        error_count: r.error_count,
        regression_count: r.regression_count,
        ecom_fail_count: r.ecom_fail_count,
      },
      pages: run.pages.map((p) => ({
        url: p.url,
        label: p.label,
        status_code: p.status_code,
        load_time_ms: p.load_time_ms,
        console_errors: p.console_errors,
        diff_score: p.diff_score,
        ecommerce_checks: p.ecommerce_checks,
        interactions: p.interactions,
      })),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qa-report-${r.website_name || 'unknown'}-${r.run_type}-${r.id.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">QA Reports</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
          placeholder="Search by website, environment, or summary..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1">
          {['all', 'baseline', 'rerun'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-2 rounded-lg capitalize ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {f === 'all' ? 'All' : f === 'baseline' ? 'Baselines' : 'Reruns'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">📊</p>
          <p>{reports.length === 0 ? 'No reports yet — run a QA task to generate one.' : 'No matching reports.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const task = getTaskForReport(r)
            const website = getWebsiteForReport(r)
            const client = clients.find((c) => c.id === r.client_id)
            const hasIssues = r.error_count > 0 || r.regression_count > 0 || r.ecom_fail_count > 0

            return (
              <div key={r.id} className={`bg-white rounded-xl border shadow-sm p-4 ${hasIssues ? 'border-amber-200' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm">{r.website_name || 'Unknown'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.run_type === 'baseline' ? 'bg-purple-100 text-purple-700' : 'bg-cyan-100 text-cyan-700'}`}>
                        {r.run_type === 'baseline' ? 'Baseline' : 'Rerun'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.environment === 'staging' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {r.environment}
                      </span>
                    </div>
                    {client && <p className="text-xs text-gray-400">{client.name} → {task?.name || 'Task'}</p>}

                    {/* Stats chips */}
                    <div className="flex gap-2 flex-wrap mt-2 text-xs">
                      <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{r.page_count} pages</span>
                      {r.error_count > 0 && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded">{r.error_count} errors</span>}
                      {r.regression_count > 0 && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{r.regression_count} regressions</span>}
                      {r.ecom_fail_count > 0 && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded">{r.ecom_fail_count} e-com fails</span>}
                      {!hasIssues && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">✓ No issues</span>}
                    </div>

                    {r.summary && (
                      <p className="text-xs text-gray-500 mt-2 line-clamp-2">{r.summary}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{new Date(r.created_at).toLocaleString()}</p>
                  </div>

                  <div className="flex flex-col gap-1.5 shrink-0">
                    {task && website && (
                      <Link
                        to={`/clients/${r.client_id}/websites/${r.website_id}/tasks/${r.task_id}/runs/${r.run_id}`}
                        className="text-xs px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 text-center"
                      >
                        View Details
                      </Link>
                    )}
                    <button
                      onClick={() => downloadReport(r)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
                    >
                      📥 Download
                    </button>
                    <button
                      onClick={() => { if (confirm('Delete this report?')) deleteReport(r.id) }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
