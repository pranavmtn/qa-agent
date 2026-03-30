import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import useStore from '../store'
import toast from 'react-hot-toast'
import { generateTaskComparisonPDF } from '../utils/pdfExport'

// ── Compute visual + console diff between two runs ─────────────────
function computeComparison(baselineRun, rerunRun) {
  if (!baselineRun || !rerunRun) return null

  const regressions = rerunRun.pages
    .filter((p) => p.diff_score != null && p.diff_score > 0)
    .sort((a, b) => b.diff_score - a.diff_score)

  const newErrorPages = []
  const resolvedErrorPages = []

  for (const rerunPage of rerunRun.pages) {
    const baselinePage = baselineRun.pages.find((p) => p.url === rerunPage.url)
    const baselineErrors = new Set(baselinePage?.console_errors || [])
    const rerunErrors = new Set(rerunPage.console_errors || [])

    const newErrors = [...rerunErrors].filter((e) => !baselineErrors.has(e))
    const resolvedErrors = [...baselineErrors].filter((e) => !rerunErrors.has(e))

    if (newErrors.length > 0) newErrorPages.push({ url: rerunPage.url, label: rerunPage.label, errors: newErrors })
    if (resolvedErrors.length > 0) resolvedErrorPages.push({ url: rerunPage.url, label: rerunPage.label, errors: resolvedErrors })
  }

  return { regressions, newErrorPages, resolvedErrorPages }
}

// ── AI comparison summary ──────────────────────────────────────────
async function callClaudeComparison(apiKey, baselineRun, rerunRun, comparison) {
  const { regressions, newErrorPages, resolvedErrorPages } = comparison
  const totalNewErrors = newErrorPages.reduce((n, p) => n + p.errors.length, 0)
  const totalResolved = resolvedErrorPages.reduce((n, p) => n + p.errors.length, 0)

  if (!apiKey) {
    // verdict only based on actual regressions and new errors — missing diff data is NOT a failure
    const verdict = regressions.length === 0 && totalNewErrors === 0 ? 'PASS' : 'FAIL'
    const noDiffPages = rerunRun.pages.filter(p => p.diff_score === null)
    const cleanPages = rerunRun.pages.filter(p => p.diff_score != null && p.diff_score <= 0.05 && !newErrorPages.find(e => e.url === p.url))
    const lines = [`## Overall Verdict: ${verdict}`]
    lines.push('\n### Failed Issues')
    if (regressions.length === 0 && totalNewErrors === 0) {
      lines.push('- None — all checks passed.')
    } else {
      for (const r of regressions) lines.push(`- ${r.label}: ${(r.diff_score * 100).toFixed(2)}% visual difference${r.pixel_changed ? ` (${r.pixel_changed.toLocaleString()} changed pixels)` : ''}`)
      for (const p of newErrorPages) lines.push(`- ${p.label}: ${p.errors.length} new console error(s)`)
    }
    lines.push('\n### Passed Checks')
    if (cleanPages.length === 0 && totalResolved === 0) {
      lines.push('- None.')
    } else {
      for (const p of cleanPages) lines.push(`- ${p.label}: ${p.diff_score < 0.001 ? '0.00%' : (p.diff_score * 100).toFixed(2) + '%'} diff, no new errors`)
      for (const p of resolvedErrorPages) lines.push(`- ${p.label}: ${p.errors.length} previous error(s) resolved`)
    }
    if (noDiffPages.length > 0) {
      lines.push('\n### Note')
      lines.push(`- Baseline comparison unavailable for ${noDiffPages.length} page(s) (screenshots not in session memory): ${noDiffPages.map(p => p.label).join(', ')}`)
      lines.push('- Re-run baseline and rerun in the same session to enable pixel diff for these pages.')
    }
    lines.push('\n### Summary')
    lines.push(verdict === 'PASS'
      ? `${cleanPages.length} page(s) compared — no regressions or new errors detected.${noDiffPages.length > 0 ? ` ${noDiffPages.length} page(s) could not be compared (run in same session to enable).` : ''} Safe to release.`
      : `${regressions.length} visual regression(s) and ${totalNewErrors} new console error(s) detected — must be fixed before release. Add an API key in Settings for a detailed AI review.`)
    return lines.join('\n')
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `You are a senior QA engineer writing a final QA report for a client. Output ONLY the structured report below — no preamble, no extra sentences.

Use this exact format:
## Overall Verdict: [PASS or FAIL]

### Failed Issues
- [bullet for each page with visual diff >5%: page name, exact diff %, pixel count if available]
- [bullet for each new console error introduced: page name, error summary]
(If none, write: None — all checks passed.)

### Passed Checks
- [bullet for each page that was compared and passed: page name, diff %, any resolved errors]
(If none, write: None.)

### Note
- Pages where baseline comparison was unavailable (screenshots not in session memory): [list page names, or "None"]

### Summary
One concise sentence about overall quality and what must be fixed before release.

CRITICAL RULES — follow exactly:
- VERDICT = FAIL only if: at least one page has visual diff >5% OR new console errors were introduced
- VERDICT = PASS if: no page has diff >5% AND no new console errors (even if some pages have no diff data)
- "No diff data" means the baseline screenshot was from a previous session — this is NOT a failure, do NOT list these in Failed Issues
- Do NOT fail the build due to missing diff data, server errors, or unavailable screenshots
- Use exact page names and exact percentages from the data below

DATA:
- Baseline: ${baselineRun.pages.length} pages, run ${new Date(baselineRun.created_at).toLocaleString()}
- Rerun: ${rerunRun.pages.length} pages, run ${new Date(rerunRun.created_at).toLocaleString()}
- Visual regressions >5% (FAIL triggers): ${regressions.length === 0 ? 'NONE' : JSON.stringify(regressions.map(p => ({ page: p.label, diff: (p.diff_score * 100).toFixed(2) + '%', changedPixels: p.pixel_changed ?? 'n/a' })))}
- Visual diffs 0–5% (informational, not failures): ${JSON.stringify(rerunRun.pages.filter(p => p.diff_score != null && p.diff_score > 0 && p.diff_score <= 0.05).map(p => ({ page: p.label, diff: (p.diff_score * 100).toFixed(2) + '%' })))}
- Pages with NO diff data (baseline screenshot unavailable — NOT failures): ${rerunRun.pages.filter(p => p.diff_score === null).map(p => p.label).join(', ') || 'none'}
- New console errors introduced — ${totalNewErrors} total (FAIL triggers): ${totalNewErrors === 0 ? 'NONE' : JSON.stringify(newErrorPages.slice(0, 8).map(p => ({ page: p.label, errors: p.errors.slice(0, 2) })))}
- Resolved console errors — ${totalResolved} total: ${totalResolved === 0 ? 'none' : JSON.stringify(resolvedErrorPages.slice(0, 8).map(p => ({ page: p.label, count: p.errors.length })))}
- Pages compared and clean (diff ≤5%, no new errors): ${rerunRun.pages.filter(p => p.diff_score != null && p.diff_score <= 0.05 && !newErrorPages.find(e => e.url === p.url)).map(p => p.label).join(', ') || 'none'}`,
        }],
      }),
    })
    const data = await resp.json()
    return data.content?.[0]?.text || 'Summary unavailable.'
  } catch {
    return 'Could not generate AI summary — check your API key in Settings.'
  }
}

// ── Single task report card ────────────────────────────────────────
function TaskReportCard({ taskGroup, clients, websites, tasks, runs }) {
  const { taskId, reports } = taskGroup
  const [expanded, setExpanded] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [confirmDeleteHistory, setConfirmDeleteHistory] = useState(false)

  const { apiKey, taskSummaries, setTaskSummary, clearTaskSummary, deleteTaskHistory, deleteRun } = useStore.getState()
  const taskSummaryData = useStore((s) => s.taskSummaries[taskId])

  const task = tasks.find((t) => t.id === taskId)
  const baselineReport = reports.find((r) => r.run_type === 'baseline')
  const rerunReports = reports.filter((r) => r.run_type === 'rerun').sort((a, b) => b.created_at.localeCompare(a.created_at))
  const latestRerunReport = rerunReports[0] || null

  const baselineRun = baselineReport ? runs.find((r) => r.id === baselineReport.run_id) : null
  const rerunRun = latestRerunReport ? runs.find((r) => r.id === latestRerunReport.run_id) : null

  const website = websites.find((w) => w.id === (baselineReport || latestRerunReport)?.website_id)
  const client = clients.find((c) => c.id === (baselineReport || latestRerunReport)?.client_id)

  const comparison = useMemo(() => computeComparison(baselineRun, rerunRun), [baselineRun, rerunRun])

  const totalNewErrors = comparison?.newErrorPages.reduce((n, p) => n + p.errors.length, 0) ?? 0
  const totalResolved = comparison?.resolvedErrorPages.reduce((n, p) => n + p.errors.length, 0) ?? 0
  const hasRegressions = (comparison?.regressions.length ?? 0) > 0
  const hasNewErrors = totalNewErrors > 0
  const isClean = comparison && !hasRegressions && !hasNewErrors

  const [generating, setGenerating] = useState(false)

  const generateSummary = async () => {
    if (!baselineRun || !rerunRun || !comparison) return
    setGenerating(true)
    const apiKeyVal = useStore.getState().apiKey
    try {
      const summary = await callClaudeComparison(apiKeyVal, baselineRun, rerunRun, comparison)
      setTaskSummary(taskId, {
        summary,
        generatedAt: new Date().toISOString(),
        baselineRunId: baselineRun.id,
        rerunRunId: rerunRun.id,
      })
      toast.success('AI summary generated')
    } catch (err) {
      toast.error('Summary generation failed')
    }
    setGenerating(false)
  }

  const downloadPdf = async () => {
    if (pdfLoading) return
    if (!baselineRun || !rerunRun) {
      toast.error('Need both a baseline and a rerun to generate a comparison PDF.')
      return
    }
    setPdfLoading(true)
    toast('Generating PDF...')
    try {
      const summary = taskSummaryData?.summary || null
      const doc = await generateTaskComparisonPDF({
        task, website, client,
        baselineRun, rerunRun,
        comparison,
        aiSummary: summary,
      })
      const filename = `qa-task-${task?.name || 'report'}-${new Date().toISOString().slice(0, 10)}.pdf`
        .replace(/[^a-z0-9\-_.]/gi, '-')
      doc.save(filename)
      toast.success('PDF downloaded!')
    } catch (err) {
      toast.error(`PDF failed: ${err.message}`)
    }
    setPdfLoading(false)
  }

  const summaryStale = taskSummaryData &&
    (taskSummaryData.baselineRunId !== baselineRun?.id || taskSummaryData.rerunRunId !== rerunRun?.id)

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
      comparison && hasRegressions ? 'border-amber-300' :
      comparison && hasNewErrors ? 'border-red-200' :
      isClean ? 'border-emerald-200' :
      'border-gray-200'
    }`}>
      {/* Card header */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <h3 className="font-semibold text-base truncate">{task?.name || 'Unknown Task'}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {client?.name && <span>{client.name} → </span>}
              {website?.name || 'Unknown Website'}
              {website?.staging_url && <span className="ml-1 text-gray-300">({website.staging_url})</span>}
            </p>
          </div>
          {isClean && (
            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full shrink-0">✓ No Issues</span>
          )}
          {hasRegressions && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full shrink-0">{comparison.regressions.length} regression{comparison.regressions.length !== 1 ? 's' : ''}</span>
          )}
          {!comparison && latestRerunReport == null && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full shrink-0">Baseline only</span>
          )}
        </div>

        {/* Baseline vs Rerun side by side */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          {/* Baseline */}
          <div className={`rounded-lg p-3 ${baselineReport ? 'bg-purple-50 border border-purple-100' : 'bg-gray-50 border border-dashed border-gray-200'}`}>
            <p className="text-xs font-semibold text-purple-600 mb-2">Baseline</p>
            {baselineReport ? (
              <>
                <p className="text-xs text-gray-500">{new Date(baselineReport.created_at).toLocaleString()}</p>
                <div className="flex gap-2 flex-wrap mt-1.5 text-xs">
                  <span className="text-gray-600">{baselineReport.page_count} pages</span>
                  {baselineReport.error_count > 0
                    ? <span className="text-red-600">{baselineReport.error_count} errors</span>
                    : <span className="text-emerald-600">0 errors</span>}
                </div>
                <Link
                  to={`/clients/${baselineReport.client_id}/websites/${baselineReport.website_id}/tasks/${baselineReport.task_id}/runs/${baselineReport.run_id}`}
                  className="text-xs text-purple-500 hover:underline mt-1 block"
                >View run →</Link>
              </>
            ) : (
              <p className="text-xs text-gray-400">No baseline yet</p>
            )}
          </div>

          {/* Latest Rerun */}
          <div className={`rounded-lg p-3 ${latestRerunReport ? 'bg-cyan-50 border border-cyan-100' : 'bg-gray-50 border border-dashed border-gray-200'}`}>
            <p className="text-xs font-semibold text-cyan-600 mb-2">Latest Rerun</p>
            {latestRerunReport ? (
              <>
                <p className="text-xs text-gray-500">{new Date(latestRerunReport.created_at).toLocaleString()}</p>
                <div className="flex gap-2 flex-wrap mt-1.5 text-xs">
                  <span className="text-gray-600">{latestRerunReport.page_count} pages</span>
                  {latestRerunReport.error_count > 0
                    ? <span className="text-red-600">{latestRerunReport.error_count} errors</span>
                    : <span className="text-emerald-600">0 errors</span>}
                  {latestRerunReport.regression_count > 0 && (
                    <span className="text-amber-600">{latestRerunReport.regression_count} visual diff</span>
                  )}
                </div>
                <Link
                  to={`/clients/${latestRerunReport.client_id}/websites/${latestRerunReport.website_id}/tasks/${latestRerunReport.task_id}/runs/${latestRerunReport.run_id}`}
                  className="text-xs text-cyan-500 hover:underline mt-1 block"
                >View run →</Link>
              </>
            ) : (
              <p className="text-xs text-gray-400">No rerun yet</p>
            )}
          </div>
        </div>

        {/* Comparison badges */}
        {comparison && (
          <div className="flex gap-2 flex-wrap mt-3">
            {comparison.regressions.length > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-lg">
                🔴 {comparison.regressions.length} visual regression{comparison.regressions.length !== 1 ? 's' : ''}
              </span>
            )}
            {totalNewErrors > 0 && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-lg">
                ⚠ {totalNewErrors} new error{totalNewErrors !== 1 ? 's' : ''}
              </span>
            )}
            {totalResolved > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg">
                ✅ {totalResolved} error{totalResolved !== 1 ? 's' : ''} resolved
              </span>
            )}
            {isClean && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg">
                ✓ No regressions or new errors
              </span>
            )}
          </div>
        )}
      </div>

      {/* AI Final Summary */}
      {comparison && (
        <div className="px-5 pb-4">
          <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
            <div className="flex items-center justify-between mb-2 gap-2">
              <p className="text-xs font-semibold text-indigo-700">AI Final QA Summary</p>
              <div className="flex gap-1.5">
                {taskSummaryData && (
                  <button
                    onClick={() => clearTaskSummary(taskId)}
                    className="text-xs text-indigo-400 hover:text-indigo-600 px-2 py-0.5 rounded"
                    title="Clear and regenerate"
                  >↺ Regenerate</button>
                )}
                {!taskSummaryData && (
                  <button
                    onClick={generateSummary}
                    disabled={generating}
                    className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {generating ? '⏳ Generating...' : '✨ Generate Summary'}
                  </button>
                )}
              </div>
            </div>
            {taskSummaryData ? (
              <>
                {summaryStale && (
                  <p className="text-xs text-amber-600 mb-1">⚠ Runs have changed — regenerate for updated summary.</p>
                )}
                <div className="text-sm text-indigo-900 leading-relaxed">
                  {taskSummaryData.summary.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) {
                      const isPass = line.toLowerCase().includes('pass')
                      const isFail = line.toLowerCase().includes('fail')
                      return (
                        <p key={i} className={`font-bold text-base mb-2 ${isFail ? 'text-red-700' : isPass ? 'text-emerald-700' : 'text-indigo-900'}`}>
                          {isFail ? '❌ ' : isPass ? '✅ ' : ''}{line.replace(/^## /, '')}
                        </p>
                      )
                    }
                    if (line.startsWith('### ')) {
                      return <p key={i} className="font-semibold text-indigo-800 mt-3 mb-1 border-b border-indigo-100 pb-0.5">{line.replace(/^### /, '')}</p>
                    }
                    if (line.startsWith('- ')) {
                      return <p key={i} className="ml-3 text-indigo-800 before:content-['•'] before:mr-1.5 before:text-indigo-400">{line.replace(/^- /, '')}</p>
                    }
                    if (line.trim() === '') return <div key={i} className="h-1" />
                    return <p key={i} className="text-indigo-700 italic text-xs mt-1">{line}</p>
                  })}
                </div>
                <p className="text-xs text-indigo-400 mt-1">Generated {new Date(taskSummaryData.generatedAt).toLocaleString()}</p>
              </>
            ) : (
              <p className="text-xs text-indigo-400 italic">
                {generating ? 'Analysing visual and console differences...' : 'Click "Generate Summary" for an AI-powered comparison of baseline vs rerun.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-5 pb-5 flex items-center gap-2 flex-wrap">
        {comparison && (
          <button
            onClick={downloadPdf}
            disabled={pdfLoading}
            className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1.5"
          >
            {pdfLoading ? '⏳ Generating PDF...' : '📄 Download QA Report PDF'}
          </button>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-sm px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
        >
          {expanded ? '▲ Hide Details' : '▼ Show Details'}
        </button>
        {rerunReports.length > 1 && (
          <span className="text-xs text-gray-400">{rerunReports.length} reruns total</span>
        )}

        {/* Delete history */}
        <div className="ml-auto">
          {!confirmDeleteHistory ? (
            <button
              onClick={() => setConfirmDeleteHistory(true)}
              className="text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition"
            >
              🗑 Delete History
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              <span className="text-xs text-red-700 font-medium">Delete all runs &amp; reports for this task?</span>
              <button
                onClick={() => {
                  deleteTaskHistory(taskId)
                  toast.success('QA history deleted')
                  setConfirmDeleteHistory(false)
                }}
                className="text-xs bg-red-600 text-white px-2 py-0.5 rounded hover:bg-red-700"
              >Yes</button>
              <button onClick={() => setConfirmDeleteHistory(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && comparison && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-5 bg-gray-50">

          {/* Visual regressions list */}
          {comparison.regressions.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Visual Regressions ({comparison.regressions.length})
              </h4>
              <div className="space-y-1.5">
                {comparison.regressions.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm bg-white rounded-lg px-3 py-2 border border-gray-100">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      p.diff_score < 0.01 ? 'bg-emerald-100 text-emerald-700' :
                      p.diff_score < 0.05 ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {(p.diff_score * 100).toFixed(2)}%
                    </span>
                    <span className="flex-1 truncate text-gray-700">{p.label || p.url}</span>
                    {p.pixel_changed != null && (
                      <span className="text-xs text-gray-400 shrink-0">{p.pixel_changed.toLocaleString()} px</span>
                    )}
                    <Link
                      to={`/clients/${latestRerunReport?.client_id}/websites/${latestRerunReport?.website_id}/tasks/${taskId}/runs/${rerunRun?.id}`}
                      className="text-xs text-indigo-500 hover:underline shrink-0"
                    >view →</Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New console errors */}
          {comparison.newErrorPages.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                New Console Errors ({totalNewErrors})
              </h4>
              <div className="space-y-2">
                {comparison.newErrorPages.map((p, i) => (
                  <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <p className="text-xs font-medium text-red-700 mb-1">{p.label || p.url}</p>
                    {p.errors.map((e, j) => (
                      <p key={j} className="text-xs text-red-600 font-mono">• {e}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resolved errors */}
          {comparison.resolvedErrorPages.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Resolved Errors ({totalResolved})
              </h4>
              <div className="space-y-2">
                {comparison.resolvedErrorPages.map((p, i) => (
                  <div key={i} className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                    <p className="text-xs font-medium text-emerald-700 mb-1">{p.label || p.url}</p>
                    {p.errors.map((e, j) => (
                      <p key={j} className="text-xs text-emerald-600 font-mono">• {e}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All reruns list */}
          {rerunReports.length > 1 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">All Reruns</h4>
              <div className="space-y-1">
                {rerunReports.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 text-xs text-gray-600">
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                    <span className="text-gray-400">{r.page_count} pages · {r.regression_count} regressions · {r.error_count} errors</span>
                    <Link
                      to={`/clients/${r.client_id}/websites/${r.website_id}/tasks/${r.task_id}/runs/${r.run_id}`}
                      className="text-indigo-500 hover:underline"
                    >view →</Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Reports page ──────────────────────────────────────────────
export default function Reports() {
  const reports = useStore((s) => s.reports)
  const clients = useStore((s) => s.clients)
  const websites = useStore((s) => s.websites)
  const tasks = useStore((s) => s.tasks)
  const runs = useStore((s) => s.runs)

  const [search, setSearch] = useState('')

  // Group reports by task_id, sorted by most recent activity
  const taskGroups = useMemo(() => {
    const groups = {}
    for (const r of reports) {
      if (!groups[r.task_id]) groups[r.task_id] = { taskId: r.task_id, reports: [] }
      groups[r.task_id].reports.push(r)
    }
    return Object.values(groups).sort((a, b) => {
      const latestA = Math.max(...a.reports.map((r) => new Date(r.created_at).getTime()))
      const latestB = Math.max(...b.reports.map((r) => new Date(r.created_at).getTime()))
      return latestB - latestA
    })
  }, [reports])

  const filtered = useMemo(() => {
    if (!search.trim()) return taskGroups
    const q = search.toLowerCase()
    return taskGroups.filter(({ taskId, reports: reps }) => {
      const task = tasks.find((t) => t.id === taskId)
      const rep = reps[0]
      const website = websites.find((w) => w.id === rep?.website_id)
      const client = clients.find((c) => c.id === rep?.client_id)
      return (
        (task?.name || '').toLowerCase().includes(q) ||
        (website?.name || '').toLowerCase().includes(q) ||
        (client?.name || '').toLowerCase().includes(q) ||
        reps.some((r) => (r.summary || '').toLowerCase().includes(q))
      )
    })
  }, [taskGroups, search, tasks, websites, clients])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">QA Reports</h1>
      <p className="text-sm text-gray-500 mb-5">Grouped by QA task — baseline vs rerun comparison with AI analysis.</p>

      <input
        className="border rounded-lg px-3 py-2 text-sm w-full max-w-md mb-5"
        placeholder="Search by task, website, or client..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">📊</p>
          <p>{reports.length === 0 ? 'No reports yet — run a QA task to generate one.' : 'No matching tasks.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((group) => (
            <TaskReportCard
              key={group.taskId}
              taskGroup={group}
              clients={clients}
              websites={websites}
              tasks={tasks}
              runs={runs}
            />
          ))}
        </div>
      )}
    </div>
  )
}
