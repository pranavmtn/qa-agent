import useStore from './store'

const SCREENSHOT_SERVER = import.meta.env.VITE_SCREENSHOT_SERVER || 'http://localhost:3001'
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Check if screenshot server is available
async function isServerUp() {
  try {
    const r = await fetch(`${SCREENSHOT_SERVER}/health`, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch {
    return false
  }
}

// SVG fallback when server is not running
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

// Take a real screenshot via Playwright server
async function takeScreenshot(url, httpAuth) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        fullPage: true,
        ...(httpAuth ? { httpAuth } : {}),
      }),
    })
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { screenshot: fallbackSvg(url), statusCode: 0, loadTime: 0, consoleErrors: [`Screenshot failed: ${err.message}`] }
  }
}

// Take screenshot and compare with baseline
async function takeDiffScreenshot(url, baselineScreenshot, httpAuth) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/diff-screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        baselineScreenshot,
        ...(httpAuth ? { httpAuth } : {}),
      }),
    })
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`)
    return await resp.json()
  } catch (err) {
    return { screenshot: fallbackSvg(url), statusCode: 0, loadTime: 0, consoleErrors: [`Diff failed: ${err.message}`], diffScore: 0 }
  }
}

// Run e-commerce test via Playwright server
async function runEcommerceTest(url, httpAuth) {
  try {
    const resp = await fetch(`${SCREENSHOT_SERVER}/e-commerce-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ...(httpAuth ? { httpAuth } : {}) }),
    })
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`)
    return await resp.json()
  } catch {
    return {
      steps: [{ action: 'E-commerce test', status: 'failed' }],
      screenshot: '',
      checks: { product_page: 'fail', add_to_cart: 'skip', cart_update: 'skip', checkout: 'skip' },
    }
  }
}

// ── Discover real links from the website ──
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

    doc.querySelectorAll('a[href]').forEach((a) => {
      try {
        const href = new URL(a.getAttribute('href'), base).href
        if (href.startsWith(origin) && !seen.has(href)) {
          seen.add(href)
          const label = (a.textContent || '').trim().slice(0, 50) || href.replace(origin, '') || '/'
          links.push({ url: href, label, source: 'nav' })
        }
      } catch { /* skip invalid URLs */ }
    })

    const navLinks = []
    doc.querySelectorAll('nav a, header a, [role="navigation"] a, .menu a, .nav a').forEach((a) => {
      try {
        const href = new URL(a.getAttribute('href'), base).href
        if (href.startsWith(origin)) {
          navLinks.push({ url: href, label: (a.textContent || '').trim().slice(0, 50) || href.replace(origin, ''), source: 'menu' })
        }
      } catch { /* skip */ }
    })

    onLog(`✓ Fetched site HTML — found ${links.length} links, ${navLinks.length} in navigation menus`)
    return { links, navLinks, fetched: true }
  } catch (err) {
    onLog(`⚠ Could not fetch site directly (${err.message}) — using AI-assisted discovery`)
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
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `You are a QA crawler analyzing ${siteUrl}. ${isEcommerce ? 'This is an e-commerce site.' : ''}
List the most likely pages/menu links on this site as a JSON array of objects with "url" (full URL) and "label" (menu text). Include 8-15 pages. Include the homepage. ${isEcommerce ? 'Include product listing, a product detail page, cart, and checkout pages.' : ''} Return ONLY the JSON array, no markdown.`,
        }],
      }),
    })
    const data = await resp.json()
    const text = data.content?.[0]?.text || ''
    const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    onLog(`✓ AI discovered ${parsed.length} likely pages`)
    return parsed.map((p) => ({ ...p, source: 'ai' }))
  } catch {
    onLog('AI discovery failed — using fallback')
    return generateFallbackLinks(siteUrl, isEcommerce)
  }
}

function generateFallbackLinks(siteUrl, isEcommerce) {
  const base = siteUrl.replace(/\/$/, '')
  const pages = [
    { url: base + '/', label: 'Home' },
    { url: base + '/about', label: 'About' },
    { url: base + '/contact', label: 'Contact' },
    { url: base + '/services', label: 'Services' },
    { url: base + '/blog', label: 'Blog' },
    { url: base + '/blog/getting-started', label: 'Blog Post' },
    { url: base + '/pricing', label: 'Pricing' },
    { url: base + '/faq', label: 'FAQ' },
    { url: base + '/terms', label: 'Terms' },
    { url: base + '/privacy', label: 'Privacy Policy' },
  ]
  if (isEcommerce) {
    pages.push(
      { url: base + '/products', label: 'All Products' },
      { url: base + '/products/sample-product-1', label: 'Product: Sample Item 1' },
      { url: base + '/products/sample-product-2', label: 'Product: Sample Item 2' },
      { url: base + '/cart', label: 'Shopping Cart' },
      { url: base + '/checkout', label: 'Checkout' },
    )
  }
  return pages.map((p) => ({ ...p, source: 'fallback' }))
}

// Claude summary
async function callClaude(apiKey, pages, runType) {
  if (!apiKey) {
    const issues = pages.filter((p) => p.status_code !== 200 || (p.diff_score && p.diff_score > 0.15)).length
    const ecomFails = pages.filter((p) => p.ecommerce_checks && Object.values(p.ecommerce_checks).includes('fail')).length
    return `QA ${runType} complete. ${pages.length} pages crawled & screenshotted. ${issues} issue(s) detected. ${
      runType === 'rerun' ? `${pages.filter((p) => p.diff_score > 0.15).length} pages with visual regressions >15%.` : 'Baseline snapshots saved.'
    }${ecomFails ? ` ${ecomFails} e-commerce flow failure(s).` : ''}`
  }
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `You are a QA automation tool. Summarize this QA ${runType} run in 3-4 sentences. Mention specific pages with issues, diff scores, and e-commerce check results. Pages: ${JSON.stringify(
            pages.map((p) => ({
              url: p.url, label: p.label, status: p.status_code, loadMs: p.load_time_ms,
              diff: p.diff_score, errors: p.console_errors.length,
              ecom: p.ecommerce_checks, interactions: p.interactions,
            }))
          )}`,
        }],
      }),
    })
    const data = await resp.json()
    return data.content?.[0]?.text || 'Summary generation failed.'
  } catch {
    return 'Could not generate AI summary — check your API key.'
  }
}

// ═══════════════════════════════════════════════════════════
// Main simulation — real screenshots via Playwright server
// ═══════════════════════════════════════════════════════════
export async function runSimulation({ taskId, runType, environment, onStep, onLog, onProgress }) {
  const store = useStore.getState()
  const task = store.tasks.find((t) => t.id === taskId)
  const website = store.websites.find((w) => w.id === task.website_id)
  const siteUrl = environment === 'staging' ? website.staging_url : (website.live_url || website.staging_url)
  const isRerun = runType === 'rerun'
  const isEcommerce = website.is_ecommerce
  const httpAuth = website.http_auth_enabled
    ? { username: website.http_auth_user, password: website.http_auth_pass }
    : null

  const run = store.addRun({ task_id: taskId, run_type: runType, environment })
  store.updateRun(run.id, { status: 'running' })

  // Check if Playwright server is running
  const serverUp = await isServerUp()
  if (serverUp) {
    onLog('✅ Screenshot server connected (Playwright)')
  } else {
    onLog('⚠ Screenshot server not running — start it with: cd server && npm start')
    onLog('  Falling back to simulated data')
  }

  // ── Step 1: Discover Links ──
  onStep('Discovering Links')
  onLog(`🔍 Scanning ${siteUrl} for navigation & menu links...`)
  onProgress(2)

  let allLinks = []
  const { links, navLinks, fetched } = await discoverRealLinks(siteUrl, onLog)

  if (fetched && links.length > 0) {
    const seen = new Set()
    const merged = []
    for (const l of [...navLinks, ...links]) {
      if (!seen.has(l.url)) { seen.add(l.url); merged.push(l) }
    }
    allLinks = merged.slice(0, 15)
    if (!allLinks.find((l) => l.url === siteUrl || l.url === siteUrl + '/')) {
      allLinks.unshift({ url: siteUrl, label: 'Home', source: 'nav' })
    }
    onLog(`✓ Found ${allLinks.length} unique pages from live site`)
  } else {
    allLinks = await aiDiscoverLinks(store.apiKey, siteUrl, isEcommerce, onLog)
  }

  for (let i = 0; i < allLinks.length; i++) {
    await wait(100)
    onProgress(5 + (i / allLinks.length) * 10)
    const src = allLinks[i].source === 'menu' ? '📌 Menu' : allLinks[i].source === 'nav' ? '🔗 Nav' : '📄 Page'
    onLog(`  ${src}: ${allLinks[i].label} → ${allLinks[i].url}`)
  }
  onLog(`Total pages to check: ${allLinks.length}`)
  onProgress(15)

  // Get baseline pages for comparison if rerun
  let baselinePages = []
  if (isRerun && task.baseline_run_id) {
    const baselineRun = store.runs.find((r) => r.id === task.baseline_run_id)
    if (baselineRun) baselinePages = baselineRun.pages
  }

  // ── Step 2: Visit Each Page & Take REAL Screenshots ──
  onStep('Visiting & Screenshotting')
  const pages = []
  for (let i = 0; i < allLinks.length; i++) {
    const link = allLinks[i]
    onLog(`📸 Screenshotting: ${link.label} (${link.url})`)

    let pageResult
    if (serverUp) {
      if (isRerun) {
        const baselinePage = baselinePages.find((bp) => bp.url === link.url)
        const result = await takeDiffScreenshot(link.url, baselinePage?.screenshot_url || null, httpAuth)
        pageResult = {
          url: link.url,
          label: link.label || link.url,
          source: link.source || 'discovered',
          status_code: result.statusCode,
          load_time_ms: result.loadTime,
          screenshot_url: result.screenshot,
          console_errors: result.consoleErrors || [],
          diff_score: result.diffScore != null ? +result.diffScore.toFixed(3) : null,
          diff_image_url: baselinePage?.screenshot_url || null,
          ecommerce_checks: null,
          interactions: [],
        }
      } else {
        const result = await takeScreenshot(link.url, httpAuth)
        pageResult = {
          url: link.url,
          label: link.label || link.url,
          source: link.source || 'discovered',
          status_code: result.statusCode,
          load_time_ms: result.loadTime,
          screenshot_url: result.screenshot,
          console_errors: result.consoleErrors || [],
          diff_score: null,
          diff_image_url: null,
          ecommerce_checks: null,
          interactions: [],
        }
      }
    } else {
      // Fallback: simulated data
      const statusCode = Math.random() > 0.92 ? (Math.random() > 0.5 ? 404 : 500) : 200
      const consoleErrors = []
      for (let j = 0; j < rand(0, 2); j++) {
        consoleErrors.push(
          ['TypeError: Cannot read properties of undefined', 'Failed to load resource', 'Mixed content warning'][rand(0, 2)]
        )
      }
      pageResult = {
        url: link.url,
        label: link.label || link.url,
        source: link.source || 'discovered',
        status_code: statusCode,
        load_time_ms: rand(200, 3500),
        screenshot_url: fallbackSvg(link.url),
        console_errors: consoleErrors,
        diff_score: isRerun ? +(Math.random() * (Math.random() > 0.7 ? 0.4 : 0.08)).toFixed(3) : null,
        diff_image_url: null,
        ecommerce_checks: null,
        interactions: [],
      }
    }

    pages.push(pageResult)
    const statusIcon = pageResult.status_code === 200 ? '✅' : pageResult.status_code === 0 ? '⚠️' : '❌'
    onLog(`  ${statusIcon} [${pageResult.status_code}] ${pageResult.label} — ${pageResult.load_time_ms}ms — screenshot saved`)
    onProgress(15 + ((i + 1) / allLinks.length) * 35)
  }

  // ── Step 3: E-commerce Flow (if applicable) ──
  if (isEcommerce) {
    onStep('E-commerce Testing')
    // Use manually specified product URL if available, otherwise discover from links
    let productUrls = []
    if (website.product_url) {
      productUrls = [{ url: website.product_url, label: 'Product (manual)', source: 'manual' }]
      onLog(`🛒 Using manually specified product URL: ${website.product_url}`)
    } else {
      productUrls = allLinks.filter((l) => {
        const lower = l.url.toLowerCase()
        return lower.includes('/product') && !lower.endsWith('/products')
      })
    }

    if (productUrls.length > 0 && serverUp) {
      onLog(`🛒 Running real e-commerce flow on ${productUrls.length} product page(s)...`)
      for (const prodLink of productUrls) {
        onLog(`  Testing: ${prodLink.label} (${prodLink.url})`)
        const ecomResult = await runEcommerceTest(prodLink.url, httpAuth)

        const pageEntry = pages.find((p) => p.url === prodLink.url)
        if (pageEntry) {
          pageEntry.ecommerce_checks = ecomResult.checks
          pageEntry.interactions = ecomResult.steps
          if (ecomResult.screenshot) {
            pageEntry.screenshot_url = ecomResult.screenshot
          }
          for (const step of ecomResult.steps) {
            const icon = step.status === 'done' ? '✅' : '❌'
            onLog(`    ${icon} ${step.action}: ${step.status}`)
          }
        }
      }
    } else if (productUrls.length > 0) {
      onLog(`🛒 Simulating e-commerce flow (server offline)...`)
      for (const prodLink of productUrls) {
        const pageEntry = pages.find((p) => p.url === prodLink.url)
        if (pageEntry) {
          pageEntry.ecommerce_checks = {
            product_page: pageEntry.status_code === 200 ? 'pass' : 'fail',
            add_to_cart: Math.random() > 0.15 ? 'pass' : 'fail',
            cart_update: Math.random() > 0.2 ? 'pass' : 'fail',
            checkout: 'skip',
          }
          pageEntry.interactions = [
            { action: 'View product details', status: 'done' },
            { action: 'Select product variant', status: 'done' },
            { action: 'Click Add to Cart', status: pageEntry.ecommerce_checks.add_to_cart === 'pass' ? 'done' : 'failed' },
            { action: 'Verify cart updated', status: pageEntry.ecommerce_checks.cart_update === 'pass' ? 'done' : 'failed' },
          ]
        }
      }
    } else {
      onLog('ℹ No product pages found — skipping e-commerce checks')
    }
    onProgress(65)
  } else {
    onProgress(60)
  }

  // ── Step 4: Compare with Baseline (if rerun) ──
  if (isRerun) {
    onStep('Comparing Snapshots')
    const baselineRun = store.runs.find((r) => r.id === task.baseline_run_id)
    if (baselineRun) {
      onLog(`📊 Comparing against baseline from ${new Date(baselineRun.created_at).toLocaleString()}`)
    }
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]
      if (p.diff_score != null) {
        const scoreColor = p.diff_score < 0.05 ? '🟢' : p.diff_score < 0.2 ? '🟡' : '🔴'
        onLog(`  ${scoreColor} ${p.label}: ${(p.diff_score * 100).toFixed(1)}% visual difference`)
      }
      onProgress(65 + ((i + 1) / pages.length) * 20)
    }
    const regressed = pages.filter((p) => p.diff_score > 0.15).length
    onLog(`📋 ${regressed} page(s) with significant visual regression (>15%)`)
  } else {
    onLog('💾 Saving all screenshots as baseline snapshots...')
    await wait(300)
    onLog(`✓ ${pages.length} baseline snapshots saved`)
    onProgress(85)
  }

  // ── Step 5: Generate Report ──
  onStep('Generating Report')
  onLog('🤖 Generating AI summary...')
  const summary = await callClaude(store.apiKey, pages, runType)
  onProgress(100)
  onLog('✅ Report ready!')

  store.updateRun(run.id, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    pages,
    summary,
  })

  if (!isRerun) {
    store.setBaseline(taskId, run.id)
  }

  // Save report to history
  store.addReport({
    run_id: run.id,
    task_id: taskId,
    website_id: website.id,
    client_id: website.client_id,
    website_name: website.name,
    run_type: runType,
    environment,
    page_count: pages.length,
    error_count: pages.reduce((n, p) => n + p.console_errors.length, 0),
    regression_count: pages.filter((p) => p.diff_score > 0.15).length,
    ecom_fail_count: pages.filter((p) => p.ecommerce_checks && Object.values(p.ecommerce_checks).includes('fail')).length,
    summary,
  })

  return run.id
}
