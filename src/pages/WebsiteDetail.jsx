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
  const [editingProductUrl, setEditingProductUrl] = useState(false)
  const [productUrlDraft, setProductUrlDraft] = useState('')

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
        {website.live_url && <p className="text-sm text-gray-400">{website.live_url}</p>}
        <div className="flex gap-2 mt-2 flex-wrap">
          {website.http_auth_enabled && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">HTTP Auth</span>}
          {website.is_ecommerce && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">E-commerce</span>}
          {website.product_url && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full" title={website.product_url}>🛒 Product: {website.product_url.replace(/https?:\/\/[^/]+/, '').slice(0, 30)}</span>}
        </div>
        {/* Editable product URL for e-commerce */}
        {website.is_ecommerce && (
          <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-purple-700 mb-1">🛒 Product URL (for cart/checkout testing)</p>
                {editingProductUrl ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      placeholder="https://example.com/products/sample-item"
                      value={productUrlDraft}
                      onChange={(e) => setProductUrlDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateWebsite(wid, { product_url: productUrlDraft.trim() })
                          setEditingProductUrl(false)
                          toast.success('Product URL updated')
                        }
                      }}
                    />
                    <button onClick={() => { updateWebsite(wid, { product_url: productUrlDraft.trim() }); setEditingProductUrl(false); toast.success('Product URL updated') }} className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700">Save</button>
                    <button onClick={() => setEditingProductUrl(false)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-purple-600 truncate">{website.product_url || 'Not set — click edit to add'}</p>
                    <button onClick={() => { setProductUrlDraft(website.product_url || ''); setEditingProductUrl(true) }} className="text-xs text-purple-500 hover:text-purple-700">✏️ Edit</button>
                  </div>
                )}
              </div>
            </div>
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
