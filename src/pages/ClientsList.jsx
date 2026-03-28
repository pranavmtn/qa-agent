import { useState } from 'react'
import { Link } from 'react-router-dom'
import useStore from '../store'
import toast from 'react-hot-toast'

export default function ClientsList() {
  const { clients, websites, runs, addClient } = useStore()
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')

  const handleAdd = () => {
    if (!name.trim()) return
    addClient(name.trim())
    setName('')
    setShowModal(false)
    toast.success('Client created')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clients</h1>
        <button onClick={() => setShowModal(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">
          + New Client
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-2">👥</p>
          <p>No clients yet — add one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => {
            const siteCount = websites.filter((w) => w.client_id === c.id).length
            const clientRuns = runs.filter((r) => {
              const ws = websites.find((w) => w.client_id === c.id)
              return ws
            })
            const lastRun = clientRuns.sort((a, b) => b.created_at?.localeCompare(a.created_at))[0]
            return (
              <Link
                key={c.id}
                to={`/clients/${c.id}`}
                className="block bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition"
              >
                <h3 className="font-semibold text-lg">{c.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{siteCount} website{siteCount !== 1 ? 's' : ''}</p>
                {lastRun && (
                  <p className="text-xs text-gray-400 mt-2">Last run: {new Date(lastRun.created_at).toLocaleDateString()}</p>
                )}
              </Link>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">New Client</h2>
            <input
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
              placeholder="Client name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={handleAdd} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
