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
      taskSummaries: {},  // { [taskId]: { summary, generatedAt, baselineRunId, rerunRunId } }
      apiKey: '',

      // Settings
      setApiKey: (key) => set({ apiKey: key }),

      // Task-level comparison summaries
      setTaskSummary: (taskId, data) =>
        set((s) => ({ taskSummaries: { ...s.taskSummaries, [taskId]: data } })),
      clearTaskSummary: (taskId) =>
        set((s) => {
          const next = { ...s.taskSummaries }
          delete next[taskId]
          return { taskSummaries: next }
        }),

      // Clients
      addClient: (name) => {
        const c = { id: uid(), name, notes: '', created_at: new Date().toISOString() }
        set((s) => ({ clients: [...s.clients, c] }))
        return c
      },
      updateClient: (id, name) =>
        set((s) => ({
          clients: s.clients.map((c) => (c.id === id ? { ...c, name } : c)),
        })),
      updateClientNotes: (id, notes) =>
        set((s) => ({
          clients: s.clients.map((c) => (c.id === id ? { ...c, notes } : c)),
        })),
      deleteClient: (id) =>
        set((s) => {
          const websiteIds = new Set(s.websites.filter((w) => w.client_id === id).map((w) => w.id))
          const taskIds = new Set(s.tasks.filter((t) => websiteIds.has(t.website_id)).map((t) => t.id))
          const next = { ...s }
          next.clients = s.clients.filter((c) => c.id !== id)
          next.websites = s.websites.filter((w) => !websiteIds.has(w.id))
          next.tasks = s.tasks.filter((t) => !taskIds.has(t.id))
          next.runs = s.runs.filter((r) => !taskIds.has(r.task_id))
          next.reports = s.reports.filter((r) => !taskIds.has(r.task_id))
          const ts = { ...s.taskSummaries }
          for (const tid of taskIds) delete ts[tid]
          next.taskSummaries = ts
          return next
        }),

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
      saveDiscoveredLinks: (id, links) =>
        set((s) => ({
          websites: s.websites.map((w) =>
            w.id === id ? { ...w, discovered_links: links, links_updated_at: new Date().toISOString() } : w
          ),
        })),
      getWebsitesForClient: (cid) => get().websites.filter((w) => w.client_id === cid),

      // Tasks
      addTask: (data) => {
        const t = { id: uid(), baseline_run_id: null, extra_urls: '', ...data }
        set((s) => ({ tasks: [...s.tasks, t] }))
        return t
      },
      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      getTasksForWebsite: (wid) => get().tasks.filter((t) => t.website_id === wid),
      setBaseline: (taskId, runId) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, baseline_run_id: runId } : t)),
        })),

      deleteTask: (id) =>
        set((s) => {
          const ts = { ...s.taskSummaries }
          delete ts[id]
          return {
            tasks: s.tasks.filter((t) => t.id !== id),
            runs: s.runs.filter((r) => r.task_id !== id),
            reports: s.reports.filter((r) => r.task_id !== id),
            taskSummaries: ts,
          }
        }),

      // Delete only the run history for a task (keep the task itself, reset baseline)
      deleteTaskHistory: (taskId) =>
        set((s) => {
          const ts = { ...s.taskSummaries }
          delete ts[taskId]
          return {
            tasks: s.tasks.map((t) => t.id === taskId ? { ...t, baseline_run_id: null } : t),
            runs: s.runs.filter((r) => r.task_id !== taskId),
            reports: s.reports.filter((r) => r.task_id !== taskId),
            taskSummaries: ts,
          }
        }),

      deleteRun: (runId) =>
        set((s) => {
          const run = s.runs.find((r) => r.id === runId)
          // If deleting the baseline run, reset the task's baseline_run_id
          const tasks = run
            ? s.tasks.map((t) => t.baseline_run_id === runId ? { ...t, baseline_run_id: null } : t)
            : s.tasks
          return {
            tasks,
            runs: s.runs.filter((r) => r.id !== runId),
            reports: s.reports.filter((r) => r.run_id !== runId),
          }
        }),

      // Runs
      addRun: (data) => {
        const r = {
          id: uid(),
          status: 'pending',
          created_at: new Date().toISOString(),
          completed_at: null,
          pages: [],
          summary: '',
          login_used: false,
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
        taskSummaries: state.taskSummaries,
        // Strip base64 screenshot data from runs before persisting to localStorage
        // (base64 images can be 500KB+ each, easily exceeding the ~5MB limit)
        runs: state.runs.map((r) => ({
          ...r,
          pages: r.pages.map((p) => ({
            ...p,
            screenshot_url: (p.screenshot_url && p.screenshot_url.startsWith('data:')) ? '[screenshot]' : p.screenshot_url,
            diff_image_url: (p.diff_image_url && p.diff_image_url.startsWith('data:')) ? '[screenshot]' : p.diff_image_url,
            pixel_diff_url: (p.pixel_diff_url && p.pixel_diff_url.startsWith('data:')) ? '[screenshot]' : p.pixel_diff_url,
            viewports: p.viewports
              ? Object.fromEntries(
                  Object.entries(p.viewports).map(([k, v]) => [
                    k,
                    { ...v, screenshot: (v.screenshot && v.screenshot.startsWith('data:')) ? '[screenshot]' : v.screenshot },
                  ])
                )
              : null,
            form_tests: p.form_tests
              ? p.form_tests.map((ft) => ({
                  ...ft,
                  screenshot_before: (ft.screenshot_before && ft.screenshot_before.startsWith('data:')) ? '[screenshot]' : ft.screenshot_before,
                  screenshot_after: (ft.screenshot_after && ft.screenshot_after.startsWith('data:')) ? '[screenshot]' : ft.screenshot_after,
                }))
              : [],
            ecommerce_screenshots: p.ecommerce_screenshots
              ? Object.fromEntries(
                  Object.entries(p.ecommerce_screenshots).map(([k, v]) => [
                    k, (v && v.startsWith('data:')) ? '[screenshot]' : v,
                  ])
                )
              : null,
          })),
        })),
      }),
    }
  )
)

export default useStore
