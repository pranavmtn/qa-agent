import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const uid = () => crypto.randomUUID()

const useStore = create(
  persist(
    (set, get) => ({
      clients: [],
      websites: [],
      tasks: [],
      runs: [],
      reports: [],
      apiKey: '',

      // Settings
      setApiKey: (key) => set({ apiKey: key }),

      // Clients
      addClient: (name) => {
        const c = { id: uid(), name, created_at: new Date().toISOString() }
        set((s) => ({ clients: [...s.clients, c] }))
        return c
      },
      updateClient: (id, name) =>
        set((s) => ({
          clients: s.clients.map((c) => (c.id === id ? { ...c, name } : c)),
        })),
      deleteClient: (id) =>
        set((s) => ({
          clients: s.clients.filter((c) => c.id !== id),
          websites: s.websites.filter((w) => w.client_id !== id),
        })),

      // Websites
      addWebsite: (data) => {
        const w = { id: uid(), ...data }
        set((s) => ({ websites: [...s.websites, w] }))
        return w
      },
      updateWebsite: (id, patch) =>
        set((s) => ({
          websites: s.websites.map((w) => (w.id === id ? { ...w, ...patch } : w)),
        })),
      getWebsitesForClient: (cid) => get().websites.filter((w) => w.client_id === cid),

      // Tasks
      addTask: (data) => {
        const t = { id: uid(), baseline_run_id: null, ...data }
        set((s) => ({ tasks: [...s.tasks, t] }))
        return t
      },
      getTasksForWebsite: (wid) => get().tasks.filter((t) => t.website_id === wid),
      setBaseline: (taskId, runId) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, baseline_run_id: runId } : t)),
        })),

      // Runs
      addRun: (data) => {
        const r = {
          id: uid(),
          status: 'pending',
          created_at: new Date().toISOString(),
          completed_at: null,
          pages: [],
          summary: '',
          ...data,
        }
        set((s) => ({ runs: [...s.runs, r] }))
        return r
      },
      getRunsForTask: (tid) => get().runs.filter((r) => r.task_id === tid),
      updateRun: (id, patch) =>
        set((s) => ({
          runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),

      // Reports
      addReport: (data) => {
        const r = { id: uid(), created_at: new Date().toISOString(), ...data }
        set((s) => ({ reports: [...s.reports, r] }))
        return r
      },
      deleteReport: (id) =>
        set((s) => ({ reports: s.reports.filter((r) => r.id !== id) })),
    }),
    {
      name: 'qa-dashboard-storage',
      partialize: (state) => ({
        ...state,
        // Strip base64 screenshot data from runs before persisting to localStorage
        // (base64 images can be 500KB+ each, easily exceeding the ~5MB limit)
        runs: state.runs.map((r) => ({
          ...r,
          pages: r.pages.map((p) => ({
            ...p,
            screenshot_url: (p.screenshot_url && p.screenshot_url.startsWith('data:')) ? '[screenshot]' : p.screenshot_url,
            diff_image_url: (p.diff_image_url && p.diff_image_url.startsWith('data:')) ? '[screenshot]' : p.diff_image_url,
          })),
        })),
      }),
    }
  )
)

export default useStore
