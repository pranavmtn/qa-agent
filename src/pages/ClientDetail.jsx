import { useState, useCallback, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import useStore from '../store'
import toast from 'react-hot-toast'

export default function ClientDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { clients, updateClient, updateClientNotes, deleteClient, addWebsite } = useStore()
  const websites = useStore((s) => s.websites.filter((w) => w.client_id === id))
  const client = clients.find((c) => c.id === id)
  const [notesDraft, setNotesDraft] = useState(null) // null = use client.notes
  const saveTimer = useRef(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [showPanel, setShowPanel] = useState(false)
  const [form, setForm] = useState({
    name: '', staging_url: '',
    http_auth_enabled: false, http_auth_user: '', http_auth_pass: '',
    is_ecommerce: false, product_url: '', category_url: '', variation_selectors: '', manual_urls: '',
    login_enabled: false, login_url: '', login_username: '', login_password: '',
    login_user_selector: '', login_pass_selector: '', login_submit_selector: '',
    multi_viewport_enabled: false,
    test_forms_enabled: false,
  })

  if (!client) return <p className="text-gray-400">Client not found.</p>

  const handleSaveEdit = () => {
    if (editName.trim()) updateClient(id, editName.trim())
    setEditing(false)
    toast.success('Client updated')
  }

  const handleDeleteClient = () => {
    deleteClient(id)
    toast.success(`Client "${client.name}" and all its data deleted`)
    nav('/')
  }

  const handleAddWebsite = () => {
    if (!form.name.trim() || !form.staging_url.trim()) {
      toast.error('Name and Staging URL are required')
      return
    }
    try {
      addWebsite({ client_id: id, ...form })
      setForm({ name: '', staging_url: '', http_auth_enabled: false, http_auth_user: '', http_auth_pass: '', is_ecommerce: false, product_url: '', category_url: '', variation_selectors: '', manual_urls: '', login_enabled: false, login_url: '', login_username: '', login_password: '', login_user_selector: '', login_pass_selector: '', login_submit_selector: '', multi_viewport_enabled: false, test_forms_enabled: false })
      setShowPanel(false)
      toast.success('Website added')
    } catch (err) {
      toast.error('Failed to add website')
    }
  }

  const f = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  // Auto-save notes 800ms after last keystroke
  const handleNotesChange = useCallback((val) => {
    setNotesDraft(val)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      updateClientNotes(id, val)
    }, 800)
  }, [id, updateClientNotes])

  const notesValue = notesDraft !== null ? notesDraft : (client.notes || '')

  // Extract URLs from the notes for a quick reference list
  const noteUrls = notesValue
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('http'))

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
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="ml-auto text-xs text-red-400 hover:text-red-600 border border-red-200 hover:border-red-400 px-3 py-1 rounded-lg transition">🗑 Delete Client</button>
            ) : (
              <div className="ml-auto flex items-center gap-2 bg-red-50 border border-red-300 rounded-lg px-3 py-1.5">
                <span className="text-xs text-red-700 font-medium">Delete client + all websites, tasks &amp; runs?</span>
                <button onClick={handleDeleteClient} className="text-xs bg-red-600 text-white px-2 py-0.5 rounded hover:bg-red-700">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Two-column layout: websites (left) + notepad (right) */}
      <div className="flex gap-6 items-start">

        {/* ── Left: Websites ── */}
        <div className="flex-1 min-w-0">
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
                  <div className="flex flex-wrap gap-2 mt-3">
                    {w.http_auth_enabled && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">HTTP Auth</span>}
                    {w.is_ecommerce && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">E-commerce</span>}
                    {w.product_url && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full truncate max-w-[180px]" title={w.product_url}>🛒 {w.product_url.replace(/https?:\/\/[^/]+/, '').slice(0, 25)}</span>}
                    {w.manual_urls && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{w.manual_urls.split('\n').filter(l => l.trim().startsWith('http')).length} URLs</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: Notepad ── */}
        <div className="w-80 shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm sticky top-4">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-amber-50 rounded-t-xl">
              <span className="text-lg">📋</span>
              <h2 className="font-semibold text-sm text-amber-900">Client Notes</h2>
              <span className="ml-auto text-xs text-amber-500 italic">auto-saved</span>
            </div>

            {/* Textarea */}
            <div className="p-3">
              <textarea
                className="w-full text-sm text-gray-700 leading-relaxed resize-none outline-none border-0 bg-transparent placeholder-gray-300"
                rows={14}
                placeholder={"Jot down anything...\n\nTest URLs (one per line):\nhttps://example.com/\nhttps://example.com/shop\nhttps://example.com/contact\n\nLogin:\n  user: admin@example.com\n  pass: ••••••••\n\nNotes:\n  - Footer changed in v2.3\n  - Cart tested with product /t-shirt"}
                value={notesValue}
                onChange={(e) => handleNotesChange(e.target.value)}
              />
            </div>

            {/* URL quick-list (detected URLs from notes) */}
            {noteUrls.length > 0 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <p className="text-xs font-medium text-gray-500 mb-2">🔗 URLs detected in notes ({noteUrls.length})</p>
                <ul className="space-y-1">
                  {noteUrls.map((u, i) => (
                    <li key={i} className="text-xs text-indigo-600 truncate hover:text-indigo-800">
                      <a href={u} target="_blank" rel="noreferrer" title={u}>{u}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Copy-to-manual tip */}
            {noteUrls.length > 0 && (
              <div className="px-4 pb-3">
                <p className="text-xs text-gray-400">
                  💡 To test these URLs, paste them into a website's <span className="font-medium text-gray-500">Manual URLs</span> field or a task's <span className="font-medium text-gray-500">Extra URLs</span> field.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>{/* end two-column */}

      {/* Slide-out panel */}
      {showPanel && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setShowPanel(false)}>
          <div className="bg-white w-full max-w-md h-full overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Add Website</h2>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-3" value={form.name} onChange={(e) => f('name', e.target.value)} />
            <label className="block text-sm font-medium mb-1">URL *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mb-3" placeholder="https://example.com" value={form.staging_url} onChange={(e) => f('staging_url', e.target.value)} />

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
              <div className="ml-5 mb-3 space-y-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
                <p className="text-xs text-purple-700 font-medium">E-commerce test configuration</p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Product URL * <span className="text-gray-400">(for add-to-cart &amp; checkout flow)</span></label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://example.com/product/t-shirt" value={form.product_url} onChange={(e) => f('product_url', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category / Shop URL <span className="text-gray-400">(optional — crawled for product links)</span></label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://example.com/shop" value={form.category_url} onChange={(e) => f('category_url', e.target.value)} />
                </div>
                <details className="text-xs text-purple-500 cursor-pointer">
                  <summary>Variable product selectors <span className="text-gray-400">(optional — if product has size/color options)</span></summary>
                  <div className="mt-2 space-y-1.5">
                    <p className="text-xs text-gray-500">CSS selectors to click/select before adding to cart. One per line.</p>
                    <textarea
                      className="w-full border rounded-lg px-2 py-1.5 text-xs font-mono"
                      rows={3}
                      placeholder={"select[name='pa_size']\nselect[name='pa_color']\n.swatch-size li:first-child"}
                      value={form.variation_selectors}
                      onChange={(e) => f('variation_selectors', e.target.value)}
                    />
                    <p className="text-xs text-gray-400">Each selector will be interacted with in order before clicking Add to Cart.</p>
                  </div>
                </details>
              </div>
            )}


            {/* Manual test URLs */}
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Manual Test URLs <span className="text-xs text-gray-400">(optional)</span></label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-xs font-mono"
                rows={4}
                placeholder={"https://example.com/\nhttps://example.com/shop\nhttps://example.com/product/t-shirt"}
                value={form.manual_urls}
                onChange={(e) => f('manual_urls', e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">One URL per line. When set, only these URLs are tested — auto-discovery is skipped.</p>
            </div>

            {/* Login flow automation */}
            <div className="flex items-center gap-2 mb-3">
              <input type="checkbox" id="login" checked={form.login_enabled} onChange={(e) => f('login_enabled', e.target.checked)} />
              <label htmlFor="login" className="text-sm">Login flow automation</label>
            </div>
            {form.login_enabled && (
              <div className="ml-5 mb-3 space-y-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-xs text-blue-600 font-medium">The QA run will log in before crawling all pages.</p>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Login page URL *" value={form.login_url} onChange={(e) => f('login_url', e.target.value)} />
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Username / Email *" value={form.login_username} onChange={(e) => f('login_username', e.target.value)} />
                <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Password *" type="password" value={form.login_password} onChange={(e) => f('login_password', e.target.value)} />
                <details className="text-xs text-blue-500 cursor-pointer">
                  <summary>Custom selectors (optional)</summary>
                  <div className="mt-2 space-y-1.5">
                    <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Username field CSS selector (e.g. #email)" value={form.login_user_selector} onChange={(e) => f('login_user_selector', e.target.value)} />
                    <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Password field CSS selector" value={form.login_pass_selector} onChange={(e) => f('login_pass_selector', e.target.value)} />
                    <input className="w-full border rounded-lg px-2 py-1 text-xs" placeholder="Submit button CSS selector" value={form.login_submit_selector} onChange={(e) => f('login_submit_selector', e.target.value)} />
                  </div>
                </details>
              </div>
            )}

            {/* QA feature toggles */}
            <p className="text-sm font-medium mb-2 mt-1">QA Features</p>
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="mvp" checked={form.multi_viewport_enabled} onChange={(e) => f('multi_viewport_enabled', e.target.checked)} />
              <label htmlFor="mvp" className="text-sm">Multi-viewport screenshots <span className="text-xs text-gray-400">(mobile / tablet / desktop)</span></label>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <input type="checkbox" id="forms" checked={form.test_forms_enabled} onChange={(e) => f('test_forms_enabled', e.target.checked)} />
              <label htmlFor="forms" className="text-sm">Form submission testing <span className="text-xs text-gray-400">(auto-fill &amp; submit forms)</span></label>
            </div>

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
