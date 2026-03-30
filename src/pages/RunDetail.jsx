import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import useStore from '../store'
import { generateQAReportPDF } from '../utils/pdfExport'
import toast from 'react-hot-toast'

export default function RunDetail() {
  const { cid, wid, tid, rid } = useParams()
  const run = useStore((s) => s.runs.find((r) => r.id === rid))
  const baselineRun = useStore((s) => {
    const task = s.tasks.find((t) => t.id === tid)
    return task?.baseline_run_id ? s.runs.find((r) => r.id === task.baseline_run_id) : null
  })
  const [expandedPage, setExpandedPage] = useState(null)
  const [lightboxImg, setLightboxImg] = useState(null)
  const [filter, setFilter] = useState('all')
  const [pdfLoading, setPdfLoading] = useState(false)

  if (!run) return <p className="text-gray-400">Run not found.</p>

  const duration = run.completed_at
    ? Math.round((new Date(run.completed_at) - new Date(run.created_at)) / 1000)
    : null

  const errorCount = run.pages.reduce((n, p) => n + p.console_errors.length, 0)
  const regressedCount = run.pages.filter((p) => p.diff_score > 0.05).length
  const ecomFailCount = run.pages.filter((p) => p.ecommerce_checks && Object.values(p.ecommerce_checks).includes('fail')).length

  const downloadJson = () => {
    const report = {
      run_id: run.id, run_type: run.run_type, environment: run.environment,
      status: run.status, created_at: run.created_at, completed_at: run.completed_at,
      summary: run.summary,
      pages: run.pages.map((p) => ({
        url: p.url, label: p.label, source: p.source, status_code: p.status_code,
        load_time_ms: p.load_time_ms, console_errors: p.console_errors,
        diff_score: p.diff_score, pixel_changed: p.pixel_changed, pixel_total: p.pixel_total,
        ecommerce_checks: p.ecommerce_checks, interactions: p.interactions,
        form_tests: p.form_tests?.map((f) => ({ ...f, screenshot_before: '[omitted]', screenshot_after: '[omitted]' })),
      })),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `qa-report-${run.id.slice(0, 8)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const downloadPdf = async () => {
    if (pdfLoading) return
    setPdfLoading(true)
    toast('Generating PDF — this may take a moment...')
    try {
      const store = useStore.getState()
      const task = store.tasks.find((t) => t.id === tid)
      const website = store.websites.find((w) => w.id === wid)
      const doc = await generateQAReportPDF(run, task, website, baselineRun)
      const filename = `qa-report-${website?.name || 'run'}-${run.run_type}-${new Date(run.created_at).toISOString().slice(0, 10)}.pdf`
        .replace(/[^a-z0-9\-_.]/gi, '-')
      doc.save(filename)
      toast.success('PDF downloaded!')
    } catch (err) {
      toast.error(`PDF failed: ${err.message}`)
    }
    setPdfLoading(false)
  }

  const diffColor = (score) => {
    if (score < 0.01) return 'text-emerald-600 bg-emerald-50'
    if (score < 0.05) return 'text-amber-600 bg-amber-50'
    return 'text-red-600 bg-red-50'
  }
  const diffBg = (score) => {
    if (score < 0.01) return 'border-emerald-200'
    if (score < 0.05) return 'border-amber-300'
    return 'border-red-300'
  }

  return (
    <div>
      <Link to={`/clients/${cid}/websites/${wid}/tasks/${tid}`} className="text-sm text-indigo-600 hover:underline">← Back to Task</Link>

      {/* Summary Card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mt-2 mb-6">
        <div className="flex flex-wrap gap-2 mb-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${run.run_type === 'baseline' ? 'bg-purple-100 text-purple-700' : 'bg-cyan-100 text-cyan-700'}`}>
            {run.run_type === 'baseline' ? 'Baseline' : 'Rerun'}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${run.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
            {run.status}
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm mb-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <span className="text-gray-400 block text-xs">Duration</span>
            <span className="font-semibold">{duration ? `${duration}s` : '—'}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <span className="text-gray-400 block text-xs">Pages Crawled</span>
            <span className="font-semibold">{run.pages.length}</span>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <span className="text-gray-400 block text-xs">Console Errors</span>
            <span className={`font-semibold ${errorCount > 0 ? 'text-red-600' : ''}`}>{errorCount}</span>
          </div>
          {run.run_type === 'rerun' && (
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-gray-400 block text-xs">Regressions</span>
              <span className={`font-semibold ${regressedCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{regressedCount}</span>
            </div>
          )}
          {ecomFailCount > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-gray-400 block text-xs">E-com Failures</span>
              <span className="font-semibold text-red-600">{ecomFailCount}</span>
            </div>
          )}
        </div>

        {run.run_type === 'rerun' && baselineRun && (
          <p className="text-xs text-gray-400 mb-3">📊 Compared against baseline from {new Date(baselineRun.created_at).toLocaleString()}</p>
        )}
        {run.summary && (
          <div className="p-3 bg-indigo-50 rounded-lg text-sm text-indigo-800 leading-relaxed">
            <span className="font-medium">AI Summary:</span> {run.summary}
          </div>
        )}
        <div className="mt-4 flex gap-2 flex-wrap">
          <button
            onClick={downloadPdf}
            disabled={pdfLoading}
            className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-1.5"
          >
            {pdfLoading ? '⏳ Generating PDF...' : '📄 Download PDF Report'}
          </button>
          <button onClick={downloadJson} className="text-sm px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">📥 JSON</button>
        </div>
      </div>

      {/* Page Results */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Page Results ({run.pages.length})</h2>
        {run.run_type === 'rerun' && (
          <div className="flex gap-1">
            {[
              { key: 'all', label: 'All Pages', count: run.pages.length },
              { key: 'changed', label: 'Changes', count: run.pages.filter((p) => p.diff_score !== null && p.diff_score > 0).length },
              { key: 'regressed', label: 'Regressions >5%', count: run.pages.filter((p) => p.diff_score > 0.05).length },
              { key: 'errors', label: 'Errors', count: run.pages.filter((p) => p.status_code !== 200 || p.console_errors.length > 0).length },
              { key: 'forms', label: 'Form Tests', count: run.pages.filter((p) => p.form_tests?.length > 0).length },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-lg transition ${
                  filter === f.key
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f.label}{f.count > 0 ? ` (${f.count})` : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {run.pages
          .map((p, i) => ({ ...p, _idx: i }))
          .filter((p) => {
            if (filter === 'all') return true
            if (filter === 'changed') return p.diff_score !== null && p.diff_score > 0
            if (filter === 'regressed') return p.diff_score > 0.05
            if (filter === 'errors') return p.status_code !== 200 || p.console_errors.length > 0
            if (filter === 'forms') return p.form_tests?.length > 0
            return true
          })
          .map((p) => {
          const i = p._idx
          const isExpanded = expandedPage === i
          return (
            <div key={i} className={`bg-white rounded-xl border shadow-sm overflow-hidden ${p.diff_score !== null ? diffBg(p.diff_score) : 'border-gray-200'}`}>
              {/* Page header — clickable to expand */}
              <div className="p-4 cursor-pointer hover:bg-gray-50 transition" onClick={() => setExpandedPage(isExpanded ? null : i)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{p.source === 'menu' ? '📌' : p.source === 'nav' ? '🔗' : '📄'}</span>
                      <p className="text-sm font-medium truncate">{p.label || p.url}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">{p.url}</p>
                    <div className="flex gap-3 text-xs text-gray-500 mt-1.5">
                      <span className={`font-medium ${p.status_code === 200 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {p.status_code === 200 ? '✅' : '❌'} {p.status_code}
                      </span>
                      <span>⏱ {p.load_time_ms}ms</span>
                      {p.console_errors.length > 0 && (
                        <span className="text-red-500">⚠ {p.console_errors.length} error{p.console_errors.length > 1 ? 's' : ''}</span>
                      )}
                      {p.interactions?.length > 0 && (
                        <span className="text-purple-600">🛒 {p.interactions.length} interactions</span>
                      )}
                      {p.viewports && Object.keys(p.viewports).length > 0 && (
                        <span className="text-teal-600">📱 {Object.keys(p.viewports).length} viewports</span>
                      )}
                      {p.form_tests?.length > 0 && (
                        <span className="text-pink-600">🧪 {p.form_tests.length} form{p.form_tests.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {p.diff_score !== null && (
                      <div className="text-right">
                        <span className={`text-sm font-bold px-2 py-1 rounded-lg ${diffColor(p.diff_score)}`}>
                          {(p.diff_score * 100).toFixed(2)}%
                        </span>
                        {p.pixel_changed != null && (
                          <p className="text-xs text-gray-400 mt-0.5">{p.pixel_changed.toLocaleString()} px</p>
                        )}
                      </div>
                    )}
                    <img src={p.screenshot_url} alt="" className="w-28 h-20 rounded border object-cover object-top" />
                    <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
                  {/* Screenshots */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Screenshots</h4>
                    {run.run_type === 'rerun' ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        {/* Baseline column */}
                        {p.diff_image_url && !p.diff_image_url.startsWith('[') ? (
                          <div>
                            <p className="text-xs text-gray-400 mb-1">Baseline (previous)</p>
                            <img src={p.diff_image_url} alt="Baseline" className="w-full rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition" onClick={(e) => { e.stopPropagation(); setLightboxImg(p.diff_image_url) }} />
                          </div>
                        ) : (
                          <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-center">
                            <p className="text-xs text-gray-400">Baseline screenshot<br/>not in memory<br/><span className="text-gray-300">(session ended)</span></p>
                          </div>
                        )}
                        {/* Current column */}
                        <div>
                          <p className="text-xs text-blue-500 mb-1 font-medium">Current (Rerun)</p>
                          {p.screenshot_url && !p.screenshot_url.startsWith('[') ? (
                            <img src={p.screenshot_url} alt="Current" className="w-full rounded-lg border border-blue-200 cursor-pointer hover:opacity-90 transition" onClick={(e) => { e.stopPropagation(); setLightboxImg(p.screenshot_url) }} />
                          ) : (
                            <div className="flex items-center justify-center rounded-lg border border-dashed border-blue-100 bg-blue-50 p-4">
                              <p className="text-xs text-blue-300">Screenshot not in memory</p>
                            </div>
                          )}
                        </div>
                        {/* Pixel diff column */}
                        {p.pixel_diff_url && !p.pixel_diff_url.startsWith('[') ? (
                          <div>
                            <p className="text-xs text-red-400 mb-1 font-medium">Pixel Diff (red = changed)</p>
                            <img src={p.pixel_diff_url} alt="Pixel diff" className="w-full rounded-lg border border-red-300 cursor-pointer hover:opacity-90 transition" onClick={(e) => { e.stopPropagation(); setLightboxImg(p.pixel_diff_url) }} />
                            {p.pixel_changed != null && (
                              <p className="text-xs text-red-500 mt-1">{p.pixel_changed.toLocaleString()} / {p.pixel_total?.toLocaleString()} px changed</p>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center rounded-lg border border-dashed border-red-100 bg-red-50 p-4 text-center">
                            <p className="text-xs text-red-300">Diff image<br/>not in memory</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs text-gray-400 mb-1">{run.run_type === 'rerun' ? 'Current' : 'Baseline'} Snapshot</p>
                        <img src={p.screenshot_url} alt="Screenshot" className="w-full rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition" onClick={(e) => { e.stopPropagation(); setLightboxImg(p.screenshot_url) }} />
                      </div>
                    )}
                  </div>

                  {/* Multi-viewport screenshots */}
                  {p.viewports && Object.keys(p.viewports).length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Viewport Comparison</h4>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {Object.entries(p.viewports).map(([vpName, vpData]) => (
                          <div key={vpName}>
                            <p className="text-xs text-gray-400 mb-1 capitalize">{vpName} <span className="text-gray-300">({vpData.width}×{vpData.height})</span></p>
                            {vpData.error ? (
                              <div className="text-xs text-red-400 bg-red-50 rounded p-2">{vpData.error}</div>
                            ) : vpData.screenshot && !vpData.screenshot.startsWith('[') ? (
                              <img src={vpData.screenshot} alt={vpName} className="w-full rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition" onClick={(e) => { e.stopPropagation(); setLightboxImg(vpData.screenshot) }} />
                            ) : (
                              <div className="text-xs text-gray-300 bg-gray-50 rounded p-2">Screenshot not available</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Form test results */}
                  {p.form_tests?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Form Tests ({p.form_tests.length})</h4>
                      <div className="space-y-3">
                        {p.form_tests.map((ft, fi) => (
                          <div key={fi} className="bg-purple-50 border border-purple-100 rounded-lg p-3">
                            <p className="text-xs font-semibold text-purple-700 mb-2">Form: "{ft.form_id}" — {ft.input_count} input(s)</p>
                            <div className="space-y-1 mb-2">
                              {ft.steps?.map((step, si) => (
                                <div key={si} className="flex items-center gap-2 text-xs">
                                  <span className={step.status === 'pass' ? 'text-emerald-600' : step.status === 'fail' ? 'text-red-600' : 'text-gray-400'}>
                                    {step.status === 'pass' ? '✅' : step.status === 'fail' ? '❌' : '○'}
                                  </span>
                                  <span className="text-gray-700">{step.action}</span>
                                  {step.detail && <span className="text-gray-400">{step.detail}</span>}
                                </div>
                              ))}
                            </div>
                            {ft.screenshot_after && !ft.screenshot_after.startsWith('[') && (
                              <div>
                                <p className="text-xs text-purple-500 mb-1">After submission:</p>
                                <img src={ft.screenshot_after} alt="After form submit" className="w-full rounded border border-purple-200 cursor-pointer hover:opacity-90 transition" onClick={(e) => { e.stopPropagation(); setLightboxImg(ft.screenshot_after) }} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Interactions (e-commerce flow) */}
                  {p.interactions?.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Interactions Performed</h4>
                      <div className="space-y-1.5">
                        {p.interactions.map((act, j) => (
                          <div key={j} className="flex items-center gap-2 text-sm">
                            <span className={act.status === 'done' ? 'text-emerald-600' : 'text-red-600'}>
                              {act.status === 'done' ? '✅' : '❌'}
                            </span>
                            <span>{act.action}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${act.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {act.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* E-commerce checks */}
                  {p.ecommerce_checks && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase">E-commerce Flow</h4>
                      {/* Step badges */}
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { key: 'product_page', label: '1. Product Page' },
                          { key: 'add_to_cart',  label: '2. Add to Cart'  },
                          { key: 'cart_update',  label: '3. Cart Verified' },
                          { key: 'checkout',     label: '4. Checkout'      },
                        ].map(({ key, label }) => {
                          const v = p.ecommerce_checks[key] || 'skip'
                          return (
                            <span key={key} className={`text-xs px-2.5 py-1 rounded-full font-medium ${v === 'pass' ? 'bg-emerald-100 text-emerald-700' : v === 'fail' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}`}>
                              {v === 'pass' ? '✓' : v === 'fail' ? '✗' : '–'} {label}
                            </span>
                          )
                        })}
                      </div>
                      {/* Flow screenshots: product → cart → checkout */}
                      {p.ecommerce_screenshots && Object.keys(p.ecommerce_screenshots).length > 0 && (
                        <div className="grid gap-3 sm:grid-cols-3">
                          {[
                            { key: 'product',   label: 'Product Page' },
                            { key: 'cart',      label: 'Cart'         },
                            { key: 'checkout',  label: 'Checkout'     },
                          ].map(({ key, label }) => {
                            const src = p.ecommerce_screenshots[key]
                            return (
                              <div key={key}>
                                <p className="text-xs text-gray-500 mb-1 font-medium">{label}</p>
                                {src && !src.startsWith('[') ? (
                                  <img
                                    src={src}
                                    alt={label}
                                    className="w-full rounded border border-gray-200 cursor-zoom-in object-top"
                                    style={{ maxHeight: 200, objectFit: 'cover' }}
                                    onClick={() => setLightboxImg(src)}
                                  />
                                ) : (
                                  <div className="flex items-center justify-center rounded border border-gray-200 bg-gray-50" style={{ height: 120 }}>
                                    <p className="text-xs text-gray-400 text-center">Not available</p>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Console errors */}
                  {p.console_errors.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Console Errors</h4>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 space-y-1 font-mono">
                        {p.console_errors.map((e, j) => <div key={j}>• {e}</div>)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {filter !== 'all' && run.pages.filter((p) => {
          if (filter === 'changed') return p.diff_score !== null && p.diff_score > 0
          if (filter === 'regressed') return p.diff_score > 0.15
          if (filter === 'errors') return p.status_code !== 200 || p.console_errors.length > 0
          return true
        }).length === 0 && (
          <div className="text-center py-10 text-gray-400">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-sm">{filter === 'changed' ? 'No visual changes detected — all pages match baseline.' : filter === 'regressed' ? 'No regressions >5% — all pages within tolerance.' : filter === 'forms' ? 'No pages with form tests in this run.' : 'No errors — all pages loaded successfully.'}</p>
          </div>
        )}
      </div>

      {/* Full-size screenshot lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
          <div className="relative max-w-5xl w-full max-h-[90vh] overflow-auto">
            <button onClick={() => setLightboxImg(null)} className="absolute top-2 right-2 z-10 bg-white/90 rounded-full w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-white">✕</button>
            <img src={lightboxImg} alt="Full screenshot" className="w-full rounded-lg" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  )
}
