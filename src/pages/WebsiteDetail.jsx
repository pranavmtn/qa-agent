import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import useStore from '../store'
import { runSimulation } from '../simulation'
import toast from 'react-hot-toast'
import RunProgress from '../components/RunProgress'

export default function WebsiteDetail() {
  const { cid, wid } = useParams()
  const nav = useNavigate()
  const website = useStore((s) => s.websites.find((w) => w.id === wid))
  const tasks = useStore((s) => s.tasks.filter((t) => t.website_id === wid))
  const runs = useStore((s) => s.runs)
  const addTask = useStore((s) => s.addTask)
  const updateWebsite = useStore((s) => s.updateWebsite)

  const [showModal, setShowModal] = useState(false)
  const [taskName, setTaskName] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [runningTask, setRunningTask] = useState(null)
  const [progress, setProgress] = useState({ step: '', pct: 0, logs: [] })
  const [ecomDraft, setEcomDraft] = useState({ product_url: '', category_url: '', variation_selectors: '' })
  const [editingEcom, setEditingEcom] = useState(false)
  const [manualUrlsDraft, setManualUrlsDraft] = useState('')
  const [editingManualUrls, setEditingManualUrls] = useState(false)
  const [showQaSettings, setShowQaSettings] = useState(false)

  if (!website) return <p className="text-gray-400">Website not found.</p>

  const handleAddTask = () => {
    if (!taskName.trim()) return
    addTask({ website_id: wid, name: taskName.trim(), description: taskDesc.trim() })
    setTaskName('')
    setTaskDesc('')
    setShowModal(false)
    toast.success('Task created')
  }

  const handleRun = async (task, runType) => {
    setRunningTask(task.id)
    setProgress({ step: 'Starting', pct: 0, logs: [] })
    toast(`${runType === 'baseline' ? 'Baseline' : 'Rerun'} started`)
    try {
      const runId = await runSimulation({
        taskId: task.id,
        runType,
        environment: 'staging',
        onStep: (step) => setProgress((p) => ({ ...p, step })),
        onProgress: (pct) => setProgress((p) => ({ ...p, pct })),
        onLog: (msg) => setProgress((p) => ({ ...p, logs: [...p.logs.slice(-20), msg] })),
      })
      toast.success('Run completed! Opening report...')
      setRunningTask(null)
      nav(`/clients/${cid}/websites/${wid}/tasks/${task.id}/runs/${runId}`)
    } catch {
      toast.error('Run failed')
      setRunningTask(null)
    }
  }

  const lastRunForTask = (tid) => {
    const tRuns = runs.filter((r) => r.task_id === tid).sort((a, b) => b.created_at.localeCompare(a.created_at))
    return tRuns[0]
  }

  return (
    <div>
      <Link to={`/clients/${cid}`} className="text-sm text-indigo-600 hover:underline">← Back</Link>
      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-bold">{website.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{website.staging_url}</p>
        <div className="flex gap-2 mt-2 flex-wrap">
          {website.http_auth_enabled && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">HTTP Auth</span>}
          {website.is_ecommerce && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">E-commerce</span>}
          {website.product_url && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full" title={website.product_url}>🛒 Product: {website.product_url.replace(/https?:\/\/[^/]+/, '').slice(0, 30)}</span>}
          {website.login_enabled && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">🔐 Login Flow</span>}
          {website.multi_viewport_enabled && <span className="text-xs bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full">📱 Multi-Viewport</span>}
          {website.test_forms_enabled && <span className="text-xs bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">🧪 Form Testing</span>}
          {website.manual_urls && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">📋 {website.manual_urls.split('\n').filter(s => s.trim()).length} manual URLs</span>}
        </div>

        {/* Manual test URLs */}
        <div className="mt-3 p-3 bg-orange-50 rounded-lg border border-orange-100">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-medium text-orange-700">📋 Manual Test URLs</p>
              <p className="text-xs text-gray-400">When set, ONLY these URLs are tested — auto-discovery is skipped</p>
            </div>
            {!editingManualUrls && (
              <button onClick={() => { setManualUrlsDraft(website.manual_urls || ''); setEditingManualUrls(true) }} className="text-xs text-orange-500 hover:text-orange-700">✏️ Edit</button>
            )}
          </div>
          {editingManualUrls ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                className="w-full border rounded px-2 py-1.5 text-xs font-mono"
                rows={6}
                placeholder={"https://example.com/\nhttps://example.com/shop\nhttps://example.com/product/t-shirt\nhttps://example.com/contact"}
                value={manualUrlsDraft}
                onChange={(e) => setManualUrlsDraft(e.target.value)}
              />
              <p className="text-xs text-gray-400">One URL per line. Leave empty to use auto-discovery.</p>
              <div className="flex gap-2">
                <button onClick={() => { updateWebsite(wid, { manual_urls: manualUrlsDraft.trim() }); setEditingManualUrls(false); toast.success('Manual URLs saved') }} className="text-xs px-3 py-1.5 bg-orange-500 text-white rounded hover:bg-orange-600">Save</button>
                <button onClick={() => setEditingManualUrls(false)} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              {website.manual_urls ? (
                <div className="space-y-0.5">
                  {website.manual_urls.split('\n').filter(s => s.trim()).map((u, i) => (
                    <p key={i} className="text-xs text-orange-700 font-mono truncate">{u.trim()}</p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">Not set — auto-discovery will be used</p>
              )}
            </div>
          )}
        </div>
        {/* E-commerce settings */}
        {website.is_ecommerce && (
          <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-purple-700">🛒 E-commerce Test Settings</p>
              {!editingEcom && (
                <button
                  onClick={() => { setEcomDraft({ product_url: website.product_url || '', category_url: website.category_url || '', variation_selectors: website.variation_selectors || '' }); setEditingEcom(true) }}
                  className="text-xs text-purple-500 hover:text-purple-700"
                >✏️ Edit</button>
              )}
            </div>
            {editingEcom ? (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Product URL * <span className="text-gray-400">(add-to-cart &amp; checkout flow)</span></label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" placeholder="https://example.com/product/t-shirt" value={ecomDraft.product_url} onChange={(e) => setEcomDraft((d) => ({ ...d, product_url: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category / Shop URL <span className="text-gray-400">(optional)</span></label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" placeholder="https://example.com/shop" value={ecomDraft.category_url} onChange={(e) => setEcomDraft((d) => ({ ...d, category_url: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Variable product selectors <span className="text-gray-400">(one per line — CSS selectors to pick before Add to Cart)</span></label>
                  <textarea
                    className="w-full border rounded px-2 py-1.5 text-xs font-mono"
                    rows={3}
                    placeholder={"select[name='pa_size']\nselect[name='pa_color']\n.swatch-size li:first-child"}
                    value={ecomDraft.variation_selectors}
                    onChange={(e) => setEcomDraft((d) => ({ ...d, variation_selectors: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => { updateWebsite(wid, { product_url: ecomDraft.product_url.trim(), category_url: ecomDraft.category_url.trim(), variation_selectors: ecomDraft.variation_selectors.trim() }); setEditingEcom(false); toast.success('E-commerce settings saved') }} className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700">Save</button>
                  <button onClick={() => setEditingEcom(false)} className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                <div className="flex gap-2">
                  <span className="text-xs text-gray-500 w-20 shrink-0">Product URL</span>
                  <span className="text-xs text-purple-700 truncate">{website.product_url || <span className="text-gray-400 italic">Not set</span>}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-xs text-gray-500 w-20 shrink-0">Category URL</span>
                  <span className="text-xs text-purple-700 truncate">{website.category_url || <span className="text-gray-400 italic">Not set</span>}</span>
                </div>
                {website.variation_selectors && (
                  <div className="flex gap-2">
                    <span className="text-xs text-gray-500 w-20 shrink-0">Var. selectors</span>
                    <span className="text-xs text-gray-600 font-mono truncate">{website.variation_selectors.split('\n').filter(Boolean).length} selector(s)</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* QA Settings panel */}
      <div className="mt-3 mb-2">
        <button onClick={() => setShowQaSettings((v) => !v)} className="text-xs text-indigo-600 hover:underline">
          {showQaSettings ? '▲ Hide QA settings' : '▼ Edit QA settings'}
        </button>
        {showQaSettings && (
          <div className="mt-2 p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
            {/* Multi-viewport */}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="mvp_edit" checked={website.multi_viewport_enabled ?? false}
                onChange={(e) => { updateWebsite(wid, { multi_viewport_enabled: e.target.checked }); toast.success('Settings saved') }} />
              <label htmlFor="mvp_edit" className="text-sm">Multi-viewport screenshots <span className="text-xs text-gray-400">(mobile / tablet / desktop)</span></label>
            </div>
            {/* Form testing */}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="forms_edit" checked={website.test_forms_enabled ?? false}
                onChange={(e) => { updateWebsite(wid, { test_forms_enabled: e.target.checked }); toast.success('Settings saved') }} />
              <label htmlFor="forms_edit" className="text-sm">Form submission testing <span className="text-xs text-gray-400">(auto-fill &amp; submit forms)</span></label>
            </div>
            {/* Login flow */}
            <div className="flex items-center gap-2">
              <input type="checkbox" id="login_edit" checked={website.login_enabled ?? false}
                onChange={(e) => { updateWebsite(wid, { login_enabled: e.target.checked }); toast.success('Settings saved') }} />
              <label htmlFor="login_edit" className="text-sm">Login flow automation</label>
            </div>
            {(website.login_enabled ?? false) && (
              <div className="ml-5 space-y-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                {[
                  { key: 'login_url', label: 'Login page URL', ph: 'https://example.com/login' },
                  { key: 'login_username', label: 'Username / Email', ph: 'user@example.com' },
                  { key: 'login_user_selector', label: 'Username selector (optional)', ph: '#email' },
                  { key: 'login_pass_selector', label: 'Password selector (optional)', ph: '#password' },
                  { key: 'login_submit_selector', label: 'Submit selector (optional)', ph: 'button[type="submit"]' },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label className="block text-xs text-blue-700 mb-0.5">{label}</label>
                    <input
                      className="w-full border rounded px-2 py-1 text-sm"
                      placeholder={ph}
                      value={website[key] || ''}
                      onChange={(e) => updateWebsite(wid, { [key]: e.target.value })}
                      onBlur={() => toast.success('Settings saved')}
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-blue-700 mb-0.5">Password</label>
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    type="password"
                    placeholder="••••••••"
                    value={website.login_password || ''}
                    onChange={(e) => updateWebsite(wid, { login_password: e.target.value })}
                    onBlur={() => toast.success('Settings saved')}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {runningTask && <RunProgress step={progress.step} pct={progress.pct} logs={progress.logs} />}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">QA Tasks</h2>
        <button onClick={() => setShowModal(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">+ New QA Task</button>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">📋</p>
          <p>No QA tasks yet — add one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => {
            const lr = lastRunForTask(t.id)
            const hasBaseline = !!t.baseline_run_id
            const isRunning = runningTask === t.id
            return (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-start justify-between">
                  <Link to={`/clients/${cid}/websites/${wid}/tasks/${t.id}`} className="hover:underline">
                    <h3 className="font-semibold">{t.name}</h3>
                    {t.description && <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{t.description}</p>}
                  </Link>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <button
                      disabled={isRunning}
                      onClick={() => handleRun(t, 'baseline')}
                      className="text-xs px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                    >
                      {hasBaseline ? 'Re-run Baseline' : 'Run Baseline'}
                    </button>
                    <div className="relative group">
                      <button
                        disabled={isRunning || !hasBaseline}
                        onClick={() => handleRun(t, 'rerun')}
                        className="text-xs px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                      >
                        Rerun & Compare
                      </button>
                      {!hasBaseline && (
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-gray-800 text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none">
                          Run a baseline first
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {lr && (
                  <div className="flex items-center gap-2 mt-2">
                    <StatusBadge status={lr.status} />
                    <span className="text-xs text-gray-400">{new Date(lr.created_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">New QA Task</h2>
            <input autoFocus className="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="Task name" value={taskName} onChange={(e) => setTaskName(e.target.value)} />
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm mb-4 h-24 resize-none" placeholder="Description / notes (optional)" value={taskDesc} onChange={(e) => setTaskDesc(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={handleAddTask} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || ''}`}>{status}</span>
}
