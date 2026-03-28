import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import ClientsList from './pages/ClientsList'
import ClientDetail from './pages/ClientDetail'
import WebsiteDetail from './pages/WebsiteDetail'
import TaskDetail from './pages/TaskDetail'
import RunDetail from './pages/RunDetail'
import Settings from './pages/Settings'
import Reports from './pages/Reports'

const NAV = [
  { to: '/', label: 'Clients', icon: '👥' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function App() {
  const loc = useLocation()
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <Toaster position="top-right" />
      {/* Sidebar */}
      <nav className="md:w-56 bg-white border-r border-gray-200 md:min-h-screen">
        <div className="p-4 font-bold text-lg text-indigo-600 border-b border-gray-100">
          QA Dashboard
        </div>
        <ul className="flex md:flex-col gap-1 p-2">
          {NAV.map((n) => (
            <li key={n.to}>
              <Link
                to={n.to}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  (n.to === '/' ? (loc.pathname === '/' || loc.pathname.startsWith('/clients')) : loc.pathname === n.to)
                    ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{n.icon}</span> {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* Main */}
      <main className="flex-1 p-4 md:p-8 max-w-6xl">
        <Routes>
          <Route path="/" element={<ClientsList />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/clients/:cid/websites/:wid" element={<WebsiteDetail />} />
          <Route path="/clients/:cid/websites/:wid/tasks/:tid" element={<TaskDetail />} />
          <Route path="/clients/:cid/websites/:wid/tasks/:tid/runs/:rid" element={<RunDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/reports" element={<Reports />} />
        </Routes>
      </main>
    </div>
  )
}
