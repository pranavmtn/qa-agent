import { useState } from 'react'
import useStore from '../store'
import toast from 'react-hot-toast'

export default function Settings() {
  const { apiKey, setApiKey } = useStore()
  const [key, setKey] = useState(apiKey)

  const save = () => {
    setApiKey(key.trim())
    toast.success('API key saved')
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 max-w-lg">
        <label className="block text-sm font-medium mb-1">Anthropic Claude API Key</label>
        <p className="text-xs text-gray-400 mb-2">Used to generate AI-powered QA summaries. Stored in localStorage only.</p>
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm mb-4 font-mono"
          placeholder="sk-ant-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          type="password"
        />
        <button onClick={save} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">Save</button>
      </div>
    </div>
  )
}
