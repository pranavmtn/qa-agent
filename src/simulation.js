import useStore from './store'

// In production the frontend is served by the same Express server,
// so API calls use relative URLs (empty string = same origin).
// In local dev, Vite runs on a different port so we use localhost:3001.
const SCREENSHOT_SERVER = import.meta.env.VITE_SCREENSHOT_SERVER ||
  (import.meta.env.PROD ? '' : 'http://localhost:3001')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

async function isServerUp() {
  try {
    const r = await fetch(`${SCREENSHOT_SERVER}/health`, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch { return false }
}

function fallbackSvg(pageUrl) {
  const label = pageUrl.replace(/https?:\/\/[^/]+/, '').slice(0, 40) || '/'
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">
      <rect fill="#f1f5f9" width="400" height="260" rx="8"/>
      <rect fill="#e2e8f0" width="400" height="40" rx="8"/>
      <text x="200" y="140" font-family="sans-serif" font-size="12" fill="#94a3b8" text-anchor="middle">Screenshot server offline</text>
      <text x="200" y="160" font-family="monospace" font-size="10" fill="#cbd5e1" text-anchor="middle">${label}</text>
    </svg>`
  )}`
}

// ── Server API calls ──────────────────────────────────────────────

async function takeScreenshot(url, httpAuth, storageState) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, fullPage: true, ...(httpAuth ? { httpAuth } : {}), ...(storageState ? { storageState } : {}) }),
    })
    if (!resp.ok) throw new Error(`Server ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { screenshot: fallbackSvg(url), statusCode: 0, loadTime: 0, consoleErrors: [`Screenshot failed: ${err.message}`] }
  }
}

async function takeDiffScreenshot(url, baselineScreenshot, httpAuth, storageState) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/diff-screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, baselineScreenshot, ...(httpAuth ? { httpAuth } : {}), ...(storageState ? { storageState } : {}) }),
    })
    if (!resp.ok) throw new Error(`Server ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { screenshot: fallbackSvg(url), statusCode: 0, loadTime: 0, consoleErrors: [`Diff failed: ${err.message}`], diffScore: 0, diffImage: null }
  }
}

async function takeMultiViewport(url, httpAuth, storageState) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/multi-viewport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...(httpAuth ? { httpAuth } : {}), ...(storageState ? { storageState } : {}) }),
    })
    if (!resp.ok) throw new Error(`Server ${resp.status}`)
    return await resp.json()
  } catch {
    return { viewports: {} }
  }
}

async function runFormTest(url, httpAuth, storageState) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/form-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...(httpAuth ? { httpAuth } : {}), ...(storageState ? { storageState } : {}) }),
    })
    if (!resp.ok) throw new Error(`Server ${resp.status}`)
    return await resp.json()
  } catch {
    return { form_count: 0, forms: [] }
  }
}

async function runEcommerceTest(url, httpAuth, storageState, variationSelectors = []) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/e-commerce-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, variationSelectors, ...(httpAuth ? { httpAuth } : {}), ...(storageState ? { storageState } : {}) }),
    })
    if (!resp.ok) throw new Error(`Server ${resp.status}`)
    return await resp.json()
  } catch {
    return { steps: [{ action: 'E-commerce test', status: 'failed' }], screenshot: '', checks: { product_page: 'fail', add_to_cart: 'skip', cart_update: 'skip', checkout: 'skip' } }
  }
}

async function runLoginFlow(website, onLog) {
  const { login_url, login_username, login_password, login_user_selector, login_pass_selector, login_submit_selector, http_auth_enabled, http_auth_user, http_auth_pass } = website
  const httpAuth = http_auth_enabled ? { username: http_auth_user, password: http_auth_pass } : null

  onLog(`🔐 Running login flow on ${login_url} ...`)
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/login-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginUrl: login_url,
        username: login_username,
        password: login_password,
        ...(login_user_selector ? { usernameSelector: login_user_selector } : {}),
        ...(login_pass_selector ? { passwordSelector: login_pass_selector } : {}),
        ...(login_submit_selector ? { submitSelector: login_submit_selector } : {}),
        ...(httpAuth ? { httpAuth } : {}),
      }),
    })
    const data = await resp.json()
    if (data.success) {
      onLog(`✅ Login successful — session captured, all pages will run as authenticated user`)
    } else {
      onLog(`⚠ Login may have failed: ${data.message}`)
    }
    return data.storageState || null
  } catch (err) {
    onLog(`❌ Login flow error: ${err.message}`)
    return null
  }
}

// ── Link discovery ────────────────────────────────────────────────

async function discoverRealLinks(siteUrl, onLog) {
  const base = siteUrl.replace(/\/$/, '')
  try {
    onLog(`Fetching ${base} ...`)
    const resp = await fetch(base, { mode: 'cors', redirect: 'follow', signal: AbortSignal.timeout(8000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const html = await resp.text()

    const doc = new DOMParser().parseFromString(html, 'text/html')
    const origin = new URL(base).origin
    const seen = new Set()
    const links = []
    const navLinks = []

    doc.querySelectorAll('nav a, header a, [role="navigation"] a, .menu a, .nav a').forEach((a) => {
      try {
        const href = new URL(a.getAttribute('href'), base).href
        if (href.startsWith(origin) && !seen.has(href)) {
          seen.add(href)
          navLinks.push({ url: href, label: (a.textContent || '').trim().slice(0, 50) || href.replace(origin, ''), source: 'menu' })
        }
      } catch { /* skip */ }
    })

    doc.querySelectorAll('a[href]').forEach((a) => {
      try {
        const href = new URL(a.getAttribute('href'), base).href
        if (href.startsWith(origin) && !seen.has(href)) {
          seen.add(href)
          links.push({ url: href, label: (a.textContent || '').trim().slice(0, 50) || href.replace(origin, '') || '/', source: 'nav' })
        }
      } catch { /* skip */ }
    })

    onLog(`✓ Fetched HTML — ${links.length + navLinks.length} unique links (${navLinks.length} menu)`)
    return { links, navLinks, fetched: true }
  } catch (err) {
    onLog(`⚠ Could not fetch directly (${err.message}) — using AI discovery`)
    return { links: [], navLinks: [], fetched: false }
  }
}

async function aiDiscoverLinks(apiKey, siteUrl, isEcommerce, onLog) {
  if (!apiKey) {
    onLog('No API key — generating typical site structure')
    return generateFallbackLinks(siteUrl, isEcommerce)
  }
  try {
    onLog('Asking Claude to analyze site structure...')
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{ role: 'user', content: `You are a QA crawler analyzing ${siteUrl}. ${isEcommerce ? 'This is an e-commerce site.' : ''} List the most likely pages as a JSON array of objects with "url" and "label". Include 8-15 pages. ${isEcommerce ? 'Include product listing, product detail, cart, checkout.' : ''} Return ONLY the JSON array.` }],
      }),
    })
    const data = await resp.json()
    const text = data.content?.[0]?.text || ''
    const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    onLog(`✓ AI discovered ${parsed.length} pages`)
    return parsed.map((p) => ({ ...p, source: 'ai' }))
  } catch {
    onLog('AI discovery failed — using fallback')
    return generateFallbackLinks(siteUrl, isEcommerce)
  }
}

function generateFallbackLinks(siteUrl, isEcommerce) {
  const base = siteUrl.replace(/\/$/, '')
  const pages = [
    { url: base + '/', label: 'Home' }, { url: base + '/about', label: 'About' },
    { url: base + '/contact', label: 'Contact' }, { url: base + '/services', label: 'Services' },
    { url: base + '/blog', label: 'Blog' }, { url: base + '/pricing', label: 'Pricing' },
    { url: base + '/faq', label: 'FAQ' },
  ]
  if (isEcommerce) {
    pages.push(
      { url: base + '/products', label: 'All Products' },
      { url: base + '/products/sample-product', label: 'Product Detail' },
      { url: base + '/cart', label: 'Shopping Cart' },
      { url: base + '/checkout', label: 'Checkout' },
    )
  }
  return pages.map((p) => ({ ...p, source: 'fallback' }))
}

async function callClaude(apiKey, pages, runType) {
  if (!apiKey) {
    const issues = pages.filter((p) => p.status_code !== 200 || (p.diff_score && p.diff_score > 0.05)).length
    return `QA ${runType} complete. ${pages.length} pages crawled. ${issues} issue(s) detected.${runType === 'rerun' ? ` ${pages.filter((p) => p.diff_score > 0.05).length} pages with pixel differences.` : ' Baseline snapshots saved.'}`
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: `You are a QA automation tool. Summarize this ${runType} run in 3-4 sentences. Mention specific pages with issues, pixel diff scores, form test results, and e-commerce results. Pages: ${JSON.stringify(pages.map((p) => ({ url: p.url, label: p.label, status: p.status_code, loadMs: p.load_time_ms, pixelDiff: p.diff_score, changedPx: p.pixel_changed, errors: p.console_errors.length, ecom: p.ecommerce_checks, forms: p.form_tests?.length })))}` }],
      }),
    })
    const data = await resp.json()
    return data.content?.[0]?.text || 'Summary unavailable.'
  } catch {
    return 'Could not generate AI summary — check your API key.'
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main run
// ═══════════════════════════════════════════════════════════════════
export async function runSimulation({ taskId, runType, environment, onStep, onLog, onProgress }) {
  const store = useStore.getState()
  const task = store.tasks.find((t) => t.id === taskId)
  const website = store.websites.find((w) => w.id === task.website_id)
  const siteUrl = website.staging_url
  const isRerun = runType === 'rerun'
  const isEcommerce = website.is_ecommerce
  const productUrl = website.product_url?.trim() || null
  const categoryUrl = website.category_url?.trim() || null
  const variationSelectors = website.variation_selectors
    ? website.variation_selectors.split('\n').map(s => s.trim()).filter(Boolean)
    : []
  const multiViewport = website.multi_viewport_enabled ?? false
  const testForms = website.test_forms_enabled ?? false
  const loginEnabled = website.login_enabled ?? false
  const httpAuth = website.http_auth_enabled
    ? { username: website.http_auth_user, password: website.http_auth_pass }
    : null

  const run = store.addRun({ task_id: taskId, run_type: runType, environment })
  store.updateRun(run.id, { status: 'running' })

  const serverUp = await isServerUp()
  onLog(serverUp ? '✅ Screenshot server connected (Playwright)' : '⚠ Server offline — start with: cd server && npm start')

  // ── Step 0: Login flow ──────────────────────────────────────────
  let storageState = null
  if (loginEnabled && website.login_url && website.login_username && serverUp) {
    onStep('Login Flow')
    onProgress(1)
    storageState = await runLoginFlow(website, onLog)
    store.updateRun(run.id, { login_used: !!storageState })
  }

  // ── Step 1: Discover / reuse Links ─────────────────────────────
  onStep('Discovering Links')
  onProgress(3)

  // Helper: turn a raw URL string into a link object
  const toLink = (u, source = 'manual') => {
    try {
      const path = new URL(u).pathname
      const label = path === '/' ? 'Home' : path.replace(/^\/|\/$/g, '').replace(/[-_/]/g, ' ').trim() || u
      return { url: u, label, source }
    } catch { return null }
  }

  // Parse manual URLs from the website setting
  const manualLinks = (website.manual_urls || '')
    .split('\n').map(s => s.trim()).filter(s => s.startsWith('http'))
    .map(u => toLink(u, 'manual')).filter(Boolean)

  // Parse extra URLs added directly on this task
  const taskExtraLinks = (task.extra_urls || '')
    .split('\n').map(s => s.trim()).filter(s => s.startsWith('http'))
    .map(u => toLink(u, 'task')).filter(Boolean)

  // Combined: website manual URLs + task extra URLs (deduplicated by URL)
  const combinedManualLinks = [
    ...manualLinks,
    ...taskExtraLinks.filter(tl => !manualLinks.some(ml => ml.url === tl.url)),
  ]

  let allLinks = []
  let baselinePages = []

  if (isRerun && task.baseline_run_id) {
    // ── RERUN: use exact same pages as baseline — no re-crawl needed ──
    const baselineRun = store.runs.find((r) => r.id === task.baseline_run_id)
    if (baselineRun?.pages.length > 0) {
      baselinePages = baselineRun.pages
      allLinks = baselineRun.pages.map((p) => ({ url: p.url, label: p.label, source: p.source || 'baseline' }))
      onLog(`📋 Reusing ${allLinks.length} pages from baseline — no re-crawl needed`)

      // Append any NEW task extra URLs that weren't in the baseline
      const newExtraLinks = combinedManualLinks.filter(
        (tl) => !allLinks.some((al) => al.url === tl.url)
      )
      if (newExtraLinks.length > 0) {
        allLinks = [...allLinks, ...newExtraLinks]
        onLog(`➕ ${newExtraLinks.length} new URL(s) from task added to this rerun:`)
        for (const l of newExtraLinks) onLog(`   ➕ ${l.label} → ${l.url}`)
      }
      onProgress(13)
    }
  }

  if (allLinks.length === 0 && combinedManualLinks.length > 0) {
    // ── MANUAL URL LIST: skip all discovery, use website + task URLs ──
    allLinks = combinedManualLinks
    onLog(`📋 Using ${allLinks.length} URL(s) — ${manualLinks.length} from website, ${taskExtraLinks.length} extra from task`)
    for (const l of allLinks) onLog(`  📌 ${l.source === 'task' ? '➕' : '📌'} ${l.label} → ${l.url}`)
    store.saveDiscoveredLinks(website.id, allLinks)
    onProgress(13)
  }

  if (allLinks.length === 0) {
    // ── BASELINE: discover links fresh, merge with any previously saved ──
    onLog(`🔍 Scanning ${siteUrl} ...`)

    // Start from previously saved links for this website
    const savedLinks = website.discovered_links || []
    if (savedLinks.length > 0) {
      onLog(`📂 ${savedLinks.length} previously saved links — checking for new ones...`)
    }

    const { links, navLinks, fetched } = await discoverRealLinks(siteUrl, onLog)

    if (fetched && (links.length + navLinks.length) > 0) {
      const seen = new Set(savedLinks.map((l) => l.url))
      // Existing saved links first (preserve ordering), then new ones
      const merged = [...savedLinks]
      for (const l of [...navLinks, ...links]) {
        if (!seen.has(l.url)) { seen.add(l.url); merged.push(l) }
      }
      allLinks = merged.slice(0, 20)
      if (!allLinks.find((l) => l.url === siteUrl || l.url === siteUrl + '/')) {
        allLinks.unshift({ url: siteUrl, label: 'Home', source: 'nav' })
      }
      const newCount = allLinks.length - savedLinks.length
      onLog(`✓ ${allLinks.length} pages total${newCount > 0 ? ` (${newCount} new)` : ' (no new pages found)'}`)
    } else {
      allLinks = savedLinks.length > 0
        ? savedLinks
        : await aiDiscoverLinks(store.apiKey, siteUrl, isEcommerce, onLog)
    }

    // Save updated link list to website for future reruns
    store.saveDiscoveredLinks(website.id, allLinks.map((l) => ({ url: l.url, label: l.label, source: l.source })))
    onLog(`💾 Link list saved to website (${allLinks.length} pages)`)

    for (let i = 0; i < allLinks.length; i++) {
      await wait(60)
      onProgress(5 + (i / allLinks.length) * 8)
      const src = allLinks[i].source === 'menu' ? '📌' : allLinks[i].source === 'nav' ? '🔗' : '📄'
      onLog(`  ${src} ${allLinks[i].label} → ${allLinks[i].url}`)
    }
    onLog(`Total: ${allLinks.length} pages to screenshot`)
    onProgress(13)
  }

  // ── Step 2: Screenshot each page ───────────────────────────────
  onStep('Screenshotting Pages')
  const pages = []

  // Cart and checkout are tested via e-commerce flow (with items in cart),
  // not as plain screenshots — skip them here to avoid empty-cart screenshots
  const ecomSkipUrls = new Set()
  if (productUrl) {
    try {
      const base = new URL(productUrl).origin
      ecomSkipUrls.add(base + '/cart')
      ecomSkipUrls.add(base + '/cart/')
      ecomSkipUrls.add(base + '/checkout')
      ecomSkipUrls.add(base + '/checkout/')
    } catch { /* invalid URL */ }
  }

  for (let i = 0; i < allLinks.length; i++) {
    const link = allLinks[i]

    if (ecomSkipUrls.has(link.url)) {
      onLog(`  ⏭ ${link.label} (${link.url}) — tested via e-commerce flow`)
      onProgress(13 + ((i + 1) / allLinks.length) * 40)
      continue
    }

    onLog(`📸 ${link.label} (${link.url})`)

    let pageResult

    if (serverUp) {
      if (isRerun) {
        const baselinePage = baselinePages.find((bp) => bp.url === link.url)
        // baseline screenshot is only available if it wasn't stripped from localStorage
        const baselineAvailable = baselinePage?.screenshot_url &&
          !baselinePage.screenshot_url.startsWith('[') &&
          !baselinePage.screenshot_url.startsWith('data:image/svg')
        const result = baselineAvailable
          ? await takeDiffScreenshot(link.url, baselinePage.screenshot_url, httpAuth, storageState)
          : await takeScreenshot(link.url, httpAuth, storageState)
        if (!baselineAvailable && baselinePage) {
          onLog(`  ⚠ Baseline screenshot not in memory — taking fresh screenshot only (no pixel diff)`)
        }
        pageResult = {
          url: link.url, label: link.label || link.url, source: link.source || 'discovered',
          status_code: result.statusCode, load_time_ms: result.loadTime,
          screenshot_url: result.screenshot,
          console_errors: result.consoleErrors || [],
          diff_score: baselineAvailable && result.diffScore != null ? +result.diffScore.toFixed(5) : null,
          diff_image_url: baselineAvailable ? (baselinePage?.screenshot_url || null) : null,
          pixel_diff_url: baselineAvailable ? (result.diffImage || null) : null,
          pixel_changed: baselineAvailable ? (result.changedPixels ?? null) : null,
          pixel_total: baselineAvailable ? (result.totalPixels ?? null) : null,
          ecommerce_checks: null, interactions: [], viewports: null, form_tests: [],
        }
      } else {
        const result = await takeScreenshot(link.url, httpAuth, storageState)
        pageResult = {
          url: link.url, label: link.label || link.url, source: link.source || 'discovered',
          status_code: result.statusCode, load_time_ms: result.loadTime,
          screenshot_url: result.screenshot,
          console_errors: result.consoleErrors || [],
          diff_score: null, diff_image_url: null, pixel_diff_url: null,
          pixel_changed: null, pixel_total: null,
          ecommerce_checks: null, interactions: [], viewports: null, form_tests: [],
        }
      }

      // Multi-viewport screenshots
      if (multiViewport) {
        onLog(`  📱 Taking mobile/tablet/desktop screenshots...`)
        const vpResult = await takeMultiViewport(link.url, httpAuth, storageState)
        pageResult.viewports = vpResult.viewports || null
        if (vpResult.viewports) {
          const names = Object.keys(vpResult.viewports)
          onLog(`  ✓ Viewports: ${names.join(', ')}`)
        }
      }

      // Form testing
      if (testForms) {
        onLog(`  🧪 Testing forms on ${link.label}...`)
        const ftResult = await runFormTest(link.url, httpAuth, storageState)
        pageResult.form_tests = ftResult.forms || []
        if (ftResult.form_count > 0) {
          onLog(`  ✓ Found ${ftResult.form_count} form(s), tested ${ftResult.forms.length}`)
        }
      }
    } else {
      // Simulated fallback
      const statusCode = Math.random() > 0.92 ? (Math.random() > 0.5 ? 404 : 500) : 200
      const consoleErrors = []
      for (let j = 0; j < rand(0, 2); j++) {
        consoleErrors.push(['TypeError: Cannot read undefined', 'Failed to load resource', 'Mixed content warning'][rand(0, 2)])
      }
      pageResult = {
        url: link.url, label: link.label || link.url, source: link.source || 'discovered',
        status_code: statusCode, load_time_ms: rand(200, 3500),
        screenshot_url: fallbackSvg(link.url), console_errors: consoleErrors,
        diff_score: isRerun ? +(Math.random() * (Math.random() > 0.7 ? 0.4 : 0.06)).toFixed(5) : null,
        diff_image_url: null, pixel_diff_url: null, pixel_changed: null, pixel_total: null,
        ecommerce_checks: null, interactions: [], viewports: null, form_tests: [],
      }
    }

    pages.push(pageResult)
    const icon = pageResult.status_code === 200 ? '✅' : pageResult.status_code === 0 ? '⚠️' : '❌'
    const diffStr = pageResult.diff_score != null ? ` | diff: ${(pageResult.diff_score * 100).toFixed(2)}%${pageResult.pixel_changed != null ? ` (${pageResult.pixel_changed.toLocaleString()} px)` : ''}` : ''
    onLog(`  ${icon} [${pageResult.status_code}] ${pageResult.load_time_ms}ms${diffStr}`)
    onProgress(13 + ((i + 1) / allLinks.length) * 40)
  }

  // ── Step 3: E-commerce flow ─────────────────────────────────────
  // Runs whenever product_url is set, regardless of manual URLs or is_ecommerce flag
  if (productUrl && serverUp) {
    onStep('E-commerce Testing')
    if (variationSelectors.length > 0) {
      onLog(`🔀 Variable product: ${variationSelectors.length} custom selector(s) configured`)
    }
    onLog(`🛒 E-commerce flow: ${productUrl}`)

    const ecomResult = await runEcommerceTest(productUrl, httpAuth, storageState, variationSelectors)
    const baseUrl = new URL(productUrl).origin
    const cartUrl   = baseUrl + '/cart'
    const checkoutUrl = baseUrl + '/checkout'

    // ── Helper to upsert a page entry ──────────────────────────
    const upsertPage = (url, label, screenshotKey, statusPass) => {
      const src = ecomResult.screenshots?.[screenshotKey] || null
      let entry = pages.find((p) => p.url === url)
      if (!entry) {
        entry = {
          url, label, source: 'ecommerce',
          status_code: statusPass ? 200 : 0,
          load_time_ms: 0,
          screenshot_url: src,
          console_errors: [], diff_score: null, diff_image_url: null,
          pixel_diff_url: null, pixel_changed: null, pixel_total: null,
          ecommerce_checks: null, interactions: [], viewports: null,
          form_tests: [], ecommerce_screenshots: null,
        }
        pages.push(entry)
        onLog(`  ➕ Added "${label}" page to run results`)
      } else if (src) {
        entry.screenshot_url = src
      }
      return entry
    }

    // Product page entry
    const productEntry = upsertPage(productUrl, 'Product', 'product', ecomResult.checks.product_page === 'pass')
    productEntry.ecommerce_checks = ecomResult.checks
    productEntry.interactions = ecomResult.steps
    productEntry.ecommerce_screenshots = ecomResult.screenshots || null
    if (ecomResult.screenshots?.after_add) productEntry.screenshot_url = ecomResult.screenshots.after_add

    // Cart page entry — always add so it's visually compared in reruns
    if (ecomResult.checks.cart_update === 'pass' || ecomResult.screenshots?.cart) {
      const cartEntry = upsertPage(cartUrl, 'Cart', 'cart', ecomResult.checks.cart_update === 'pass')
      // On rerun: pixel-diff against baseline cart screenshot
      if (isRerun) {
        const baselineCartPage = baselinePages.find((p) => p.url === cartUrl)
        const baselineAvail = baselineCartPage?.screenshot_url &&
          !baselineCartPage.screenshot_url.startsWith('[') &&
          !baselineCartPage.screenshot_url.startsWith('data:image/svg')
        if (baselineAvail && ecomResult.screenshots?.cart) {
          try {
            const diffResp = await fetch(`${SCREENSHOT_SERVER}/diff-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseline: baselineCartPage.screenshot_url, current: ecomResult.screenshots.cart }),
            })
            if (diffResp.ok) {
              const diffData = await diffResp.json()
              cartEntry.diff_score = diffData.diffScore != null ? +diffData.diffScore.toFixed(5) : null
              cartEntry.pixel_diff_url = diffData.diffImage || null
              cartEntry.pixel_changed = diffData.changedPixels ?? null
              cartEntry.pixel_total = diffData.totalPixels ?? null
              cartEntry.diff_image_url = baselineCartPage.screenshot_url
            }
          } catch { /* diff failed, leave as null */ }
        }
      }
    }

    // Checkout page entry — always add so it's visually compared in reruns
    if (ecomResult.checks.checkout === 'pass' || ecomResult.screenshots?.checkout) {
      const checkoutEntry = upsertPage(checkoutUrl, 'Checkout', 'checkout', ecomResult.checks.checkout === 'pass')
      // On rerun: pixel-diff against baseline checkout screenshot
      if (isRerun) {
        const baselineCheckoutPage = baselinePages.find((p) => p.url === checkoutUrl)
        const baselineAvail = baselineCheckoutPage?.screenshot_url &&
          !baselineCheckoutPage.screenshot_url.startsWith('[') &&
          !baselineCheckoutPage.screenshot_url.startsWith('data:image/svg')
        if (baselineAvail && ecomResult.screenshots?.checkout) {
          try {
            const diffResp = await fetch(`${SCREENSHOT_SERVER}/diff-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseline: baselineCheckoutPage.screenshot_url, current: ecomResult.screenshots.checkout }),
            })
            if (diffResp.ok) {
              const diffData = await diffResp.json()
              checkoutEntry.diff_score = diffData.diffScore != null ? +diffData.diffScore.toFixed(5) : null
              checkoutEntry.pixel_diff_url = diffData.diffImage || null
              checkoutEntry.pixel_changed = diffData.changedPixels ?? null
              checkoutEntry.pixel_total = diffData.totalPixels ?? null
              checkoutEntry.diff_image_url = baselineCheckoutPage.screenshot_url
            }
          } catch { /* diff failed, leave as null */ }
        }
      }
    }

    for (const s of ecomResult.steps) {
      const icon = s.status === 'done' ? '✅' : s.status === 'skipped' ? '⏭' : '❌'
      onLog(`    ${icon} ${s.action}`)
    }
    const c = ecomResult.checks || {}
    const allPass = Object.values(c).every(v => v === 'pass' || v === 'skip')
    onLog(`    ${allPass ? '✅' : '❌'} product_page:${c.product_page} | add_to_cart:${c.add_to_cart} | cart:${c.cart_update} | checkout:${c.checkout}`)

  } else if (productUrl && !serverUp) {
    onLog(`⚠ Server offline — skipping e-commerce flow (start server to test cart & checkout)`)
  } else if (isEcommerce && !productUrl) {
    onLog(`⚠ No product URL set — add one in E-commerce settings to enable cart/checkout testing`)
  }
  onProgress(58)

  // ── Step 4: Compare analysis ────────────────────────────────────
  if (isRerun) {
    onStep('Analysing Diffs')
    const baselineRun = store.runs.find((r) => r.id === task.baseline_run_id)
    if (baselineRun) onLog(`📊 Comparing vs baseline from ${new Date(baselineRun.created_at).toLocaleString()}`)

    let regressed = 0
    for (const p of pages) {
      if (p.diff_score != null) {
        const icon = p.diff_score < 0.01 ? '🟢' : p.diff_score < 0.05 ? '🟡' : '🔴'
        const detail = p.pixel_changed != null ? ` (${p.pixel_changed.toLocaleString()} changed pixels)` : ''
        onLog(`  ${icon} ${p.label}: ${(p.diff_score * 100).toFixed(2)}% diff${detail}`)
        if (p.diff_score > 0.05) regressed++
      }
    }
    onLog(`📋 ${regressed} page(s) with >5% pixel difference`)
  } else {
    onLog('💾 Saving baseline snapshots...')
    await wait(200)
    onLog(`✓ ${pages.length} baseline snapshots saved`)
  }
  onProgress(82)

  // ── Step 5: Report ──────────────────────────────────────────────
  onStep('Generating Report')
  onLog('🤖 Generating AI summary...')
  const summary = await callClaude(store.apiKey, pages, runType)
  onProgress(100)
  onLog('✅ Report ready!')

  store.updateRun(run.id, { status: 'completed', completed_at: new Date().toISOString(), pages, summary })

  if (!isRerun) store.setBaseline(taskId, run.id)

  store.addReport({
    run_id: run.id, task_id: taskId, website_id: website.id, client_id: website.client_id,
    website_name: website.name, run_type: runType, environment,
    page_count: pages.length,
    error_count: pages.reduce((n, p) => n + p.console_errors.length, 0),
    regression_count: pages.filter((p) => p.diff_score > 0.05).length,
    ecom_fail_count: pages.filter((p) => p.ecommerce_checks && Object.values(p.ecommerce_checks).includes('fail')).length,
    summary,
  })

  return run.id
}
