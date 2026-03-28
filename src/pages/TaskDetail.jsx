import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import useStore from '../store'
import { runSimulation } from '../simulation'
import toast from 'react-hot-toast'
import RunProgress from '../components/RunProgress'

export default function TaskDetail() {
  const { cid, wid, tid } = useParams()
  const nav = useNavigate()
  const task = useStore((s) => s.tasks.find((t) => t.id === tid))
  const runs = useStore((s) => s.runs.filter((r) => r.task_id === tid).sort((a, b) => b.created_at.localeCompare(a.created_at)))

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ step: '', pct: 0, logs: [] })

  if (!task) return <p className="text-gray-400">Task not found.</p>

  const handleRun = async (runType) => {
    setRunning(true)
    setProgress({ step: 'Starting', pct: 0, logs: [] })
    toast(`${runType === 'baseline' ? 'Baseline' : 'Rerun'} started`)
    try {
      const runId = await runSimulation({
        taskId: tid,
        runType,
        environment: 'staging',
        onStep: (step) => setProgress((p) => ({ ...p, step })),
        onProgress: (pct) => setProgress((p) => ({ ...p, pct })),
        onLog: (msg) => setProgress((p) => ({ ...p, logs: [...p.logs.slice(-30), msg] })),
      })
      toast.success('Run completed! Opening report...')
      nav(`/clients/${cid}/websites/${wid}/tasks/${tid}/runs/${runId}`)
    } catch {
      toast.error('Run failed')
    }
    setRunning(false)
  }

  return (
    <div>
      <Link to={`/clients/${cid}/websites/${wid}`} className="text-sm text-indigo-600 hover:underline">← Back</Link>
      <div className="mt-2 mb-4">
        <h1 className="text-2xl font-bold">{task.name}</h1>
        {task.description && <p className="text-sm text-gray-500 mt-1">{task.description}</p>}
      </div>

      <div className="flex gap-2 mb-6">
        <button disabled={running} onClick={() => handleRun('baseline')} className="text-sm px-4 py-2 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50">
          {task.baseline_run_id ? 'Re-run Baseline' : 'Run Baseline'}
        </button>
        <div className="relative group">
          <button disabled={running || !task.baseline_run_id} onClick={() => handleRun('rerun')} className="text-sm px-4 py-2 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50">Rerun & Compare</button>
          {!task.baseline_run_id && (
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-gray-800 text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none">
              Run a baseline first
            </span>
          )}
        </div>
      </div>

      {running && <RunProgress step={progress.step} pct={progress.pct} logs={progress.logs} />}

      <h2 className="text-lg font-semibold mb-3">Run History</h2>
      {runs.length === 0 ? (
        <p className="text-gray-400 text-sm">No runs yet.</p>
      ) : (
        <div className="space-y-3">
          {runs.map((r) => (
            <Link
              key={r.id}
              to={`/clients/${cid}/websites/${wid}/tasks/${tid}/runs/${r.id}`}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center justify-between hover:shadow-md transition block"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.run_type === 'baseline' ? 'bg-purple-100 text-purple-700' : 'bg-cyan-100 text-cyan-700'}`}>
                  {r.run_type === 'baseline' ? 'Baseline' : 'Rerun'}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.environment === 'staging' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {r.environment}
                </span>
                <StatusBadge status={r.status} />
                <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <div className="text-sm text-gray-500">
                {r.pages.length} pages · {r.pages.filter((p) => p.console_errors.length > 0).length} issues
              </div>
            </Link>
          ))}
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
