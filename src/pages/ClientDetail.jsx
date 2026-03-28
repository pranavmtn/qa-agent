import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import useStore from '../store'
import toast from 'react-hot-toast'

export default function ClientDetail() {
  const { id } = useParams()
  const { clients, updateClient, addWebsite } = useStore()
  const websites = useStore((s) => s.websites.filter((w) => w.client_id === id))
  const client = clients.find((c) => c.id === id)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [showPanel, setShowPanel] = useState(false)
  const [form, setForm] = useState({
    name: '', staging_url: '', live_url: '',
    http_auth_enabled: false, http_auth_user: '', http_auth_pass: '',
    is_ecommerce: false, product_url: '',
  })

  if (!client) return <p className="text-gray-400">Client not found.</p>

  const handleSaveEdit = () => {
    if (editName.trim()) updateClient(id, editName.trim())
    setEditing(false)
    toast.success('Client updated')
  }

  const handleAddWebsite = () => {
    if (!form.name.trim() || !form.staging_url.trim()) {
      toast.error('Name and Staging URL are required')
      return
    }
    try {
      addWebsite({ client_id: id, ...form })
      setForm({ name: '', staging_url: '', live_url: '', http_auth_enabled: false, http_auth_user: '', http_auth_pass: '', is_ecommerce: false, product_url: '' })
      setShowPanel(false)
      toast.success('Website added')
    } catch (err) {
      toast.error('Failed to add website')
    }
  }

  const f = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  return (
    <div>
      <Link to="/" className="text-sm text-indigo-600 hover:underline">← Clients</Link>
      <div className="flex items-center gap-3 mt-2 mb-6">
        {editing ? (
          <>
            <input autoFocus className="border rounded-lg px-3 py-1 text-xl font-bold" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()} />
            <button onClick={handleSaveEdit} className="text-sm text-indigo-600">Save</button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">{client.name}</h1>
            <button onClick={() => { setEditing(true); setEditName(client.name) }} className="text-sm text-gray-400 hover:text-indigo-600">✏️</button>
          </>
        )}
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Websites</h2>
        <button onClick={() => setShowPanel(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">+ Add Website</button>
      </div>

      {websites.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">🌐</p>
          <p>No websites yet — add one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {websites.map((w) => (
            <Link key={w.id} to={`/clients/${id}/websites/${w.id}`} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition block">
              <h3 className="font-semibold">{w.name}</h3>
              <p className="text-xs text-gray-500 mt-1 truncate">{w.staging_url}</p>
              {w.live_url && <p className="text-xs text-gray-400 truncate">{w.live_url}</p>}
              <div className="flex gap-2 mt-3">
                {w.http_auth_enabled && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">HTTP Auth</span>}
                {w.is_ecommerce && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">E-commerce</span>}
                {w.product_url && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full truncate max-w-[180px]" title={w.product_url}>🛒 {w.product_url.replace(/https?:\/\/[^/]+/, '').slice(0, 25)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Slide-out panel */}
      {showPanel && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setShowPanel(false)}>
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Add Website</h2>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-3" value={form.name} onChange={(e) => f('name', e.target.value)} />
            <label className="block text-sm font-medium mb-1">Staging URL *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="https://staging.example.com" value={form.staging_url} onChange={(e) => f('staging_url', e.target.value)} />
            <label className="block text-sm font-medium mb-1">Live URL</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="https://example.com" value={form.live_url} onChange={(e) => f('live_url', e.target.value)} />

            <div className="flex items-center gap-2 mb-3">
              <input type="checkbox" id="auth" checked={form.http_auth_enabled} onChange={(e) => f('http_auth_enabled', e.target.checked)} />
              <label htmlFor="auth" className="text-sm">HTTP password protected</label>
            </div>
            {form.http_auth_enabled && (
              <div className="ml-5 mb-3 space-y-2">
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Username" value={form.http_auth_user} onChange={(e) => f('http_auth_user', e.target.value)} />
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Password" type="password" value={form.http_auth_pass} onChange={(e) => f('http_auth_pass', e.target.value)} />
              </div>
            )}

            <div className="flex items-center gap-2 mb-3">
              <input type="checkbox" id="ecom" checked={form.is_ecommerce} onChange={(e) => f('is_ecommerce', e.target.checked)} />
              <label htmlFor="ecom" className="text-sm">E-commerce site</label>
            </div>
            {form.is_ecommerce && (
              <div className="ml-5 mb-3">
                <label className="block text-sm font-medium mb-1">Product URL (for cart/checkout testing)</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://example.com/products/sample-item" value={form.product_url} onChange={(e) => f('product_url', e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">Specific product page URL to test add-to-cart & checkout flow</p>
              </div>
            )}


            <div className="flex gap-2">
              <button onClick={() => setShowPanel(false)} className="flex-1 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleAddWebsite} className="flex-1 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
