export default function RunProgress({ step, pct, logs }) {
  const steps = ['Discovering Links', 'Visiting & Screenshotting', 'E-commerce Testing', 'Comparing Snapshots', 'Generating Report']
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
      <h3 className="font-semibold mb-3">Run in Progress</h3>
      {/* Step indicator */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {steps.map((s) => {
          const isActive = s === step
          const passed = steps.indexOf(s) < steps.indexOf(step)
          return (
            <span
              key={s}
              className={`text-xs px-2 py-1 rounded-full transition-all ${
                isActive ? 'bg-indigo-600 text-white' : passed ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {passed ? '✓ ' : ''}{s}
            </span>
          )
        })}
      </div>
      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2.5 mb-3">
        <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-500 mb-2">{Math.round(pct)}% complete</p>
      {/* Log */}
      <div className="bg-gray-900 text-green-400 text-xs font-mono rounded-lg p-3 h-44 overflow-y-auto" ref={(el) => el && (el.scrollTop = el.scrollHeight)}>
        {logs.map((l, i) => (
          <div key={i} className="leading-5">{'>'} {l}</div>
        ))}
      </div>
    </div>
  )
}
