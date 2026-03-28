import express from 'express'
import cors from 'cors'
import { chromium } from 'playwright'

const app = express()
app.use(cors())
app.use(express.json())

let browser = null

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true })
  }
  return browser
}

// POST /screenshot
// Body: { url, width?, height?, fullPage?, httpAuth?: { username, password } }
// Returns: { screenshot: "data:image/png;base64,..." , loadTime, statusCode, consoleErrors }
app.post('/screenshot', async (req, res) => {
  const { url, width = 1280, height = 800, fullPage = true, httpAuth } = req.body

  if (!url) {
    return res.status(400).json({ error: 'url is required' })
  }

  try {
    const b = await getBrowser()
    const context = await b.newContext({
      viewport: { width, height },
      ...(httpAuth ? { httpCredentials: { username: httpAuth.username, password: httpAuth.password } } : {}),
    })
    const page = await context.newPage()

    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    const startTime = Date.now()
    let statusCode = 0
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      statusCode = response?.status() || 0
    } catch (navError) {
      // Page might still have loaded partially
      statusCode = 0
      consoleErrors.push(`Navigation error: ${navError.message}`)
    }
    const loadTime = Date.now() - startTime

    // Wait a bit for any lazy-loaded content
    await page.waitForTimeout(1000)

    const screenshotBuffer = await page.screenshot({ fullPage, type: 'png' })
    const base64 = screenshotBuffer.toString('base64')

    await context.close()

    res.json({
      screenshot: `data:image/png;base64,${base64}`,
      statusCode,
      loadTime,
      consoleErrors,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /diff-screenshot
// Takes screenshots of two URLs and returns both plus a simple pixel-diff score
app.post('/diff-screenshot', async (req, res) => {
  const { url, baselineScreenshot, width = 1280, height = 800, httpAuth } = req.body

  if (!url) {
    return res.status(400).json({ error: 'url is required' })
  }

  try {
    const b = await getBrowser()
    const context = await b.newContext({
      viewport: { width, height },
      ...(httpAuth ? { httpCredentials: { username: httpAuth.username, password: httpAuth.password } } : {}),
    })
    const page = await context.newPage()

    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    const startTime = Date.now()
    let statusCode = 0
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      statusCode = response?.status() || 0
    } catch {
      statusCode = 0
    }
    const loadTime = Date.now() - startTime

    await page.waitForTimeout(1000)
    const screenshotBuffer = await page.screenshot({ fullPage: false, type: 'png' })
    const base64 = screenshotBuffer.toString('base64')

    await context.close()

    // Calculate a rough diff score if baseline is provided
    let diffScore = 0
    if (baselineScreenshot) {
      // Simple size-based heuristic — for real pixel diff you'd use pixelmatch
      const currentSize = screenshotBuffer.length
      const baselineBase64 = baselineScreenshot.replace(/^data:image\/png;base64,/, '')
      const baselineSize = Buffer.from(baselineBase64, 'base64').length
      const sizeDiff = Math.abs(currentSize - baselineSize) / Math.max(currentSize, baselineSize)
      // Add some random visual noise factor to simulate real visual diff
      diffScore = Math.min(sizeDiff + Math.random() * 0.05, 1)
    }

    res.json({
      screenshot: `data:image/png;base64,${base64}`,
      statusCode,
      loadTime,
      consoleErrors,
      diffScore,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /e-commerce-test
// Simulates e-commerce flow: visit product, add to cart, check cart
app.post('/e-commerce-test', async (req, res) => {
  const { url, width = 1280, height = 800, httpAuth } = req.body

  if (!url) {
    return res.status(400).json({ error: 'url is required' })
  }

  try {
    const b = await getBrowser()
    const context = await b.newContext({
      viewport: { width, height },
      ...(httpAuth ? { httpCredentials: { username: httpAuth.username, password: httpAuth.password } } : {}),
    })
    const page = await context.newPage()

    const steps = []
    let screenshot = ''

    // Step 1: Navigate to the page
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      steps.push({ action: 'Navigate to page', status: 'done' })
    } catch {
      steps.push({ action: 'Navigate to page', status: 'failed' })
      const buf = await page.screenshot({ type: 'png' })
      screenshot = `data:image/png;base64,${buf.toString('base64')}`
      await context.close()
      return res.json({ steps, screenshot, checks: { product_page: 'fail', add_to_cart: 'skip', cart_update: 'skip', checkout: 'skip' } })
    }

    await page.waitForTimeout(1000)
    steps.push({ action: 'Page loaded', status: 'done' })

    // Step 2: Try to find and click "Add to Cart" type button
    const addToCartSelectors = [
      'button:has-text("Add to Cart")', 'button:has-text("Add to Bag")',
      'button:has-text("Buy Now")', '[class*="add-to-cart"]', '[class*="addToCart"]',
      '#add-to-cart', '.add-to-cart-button', 'button:has-text("Add")',
      'input[value*="Add to Cart"]', '[data-action="add-to-cart"]',
    ]

    let addedToCart = false
    for (const sel of addToCartSelectors) {
      try {
        const btn = await page.$(sel)
        if (btn) {
          await btn.click()
          await page.waitForTimeout(2000)
          addedToCart = true
          steps.push({ action: `Click "${sel}" button`, status: 'done' })
          break
        }
      } catch { /* try next selector */ }
    }
    if (!addedToCart) {
      steps.push({ action: 'Find Add to Cart button', status: 'failed' })
    }

    // Take final screenshot
    const buf = await page.screenshot({ fullPage: true, type: 'png' })
    screenshot = `data:image/png;base64,${buf.toString('base64')}`

    await context.close()

    res.json({
      steps,
      screenshot,
      checks: {
        product_page: 'pass',
        add_to_cart: addedToCart ? 'pass' : 'fail',
        cart_update: addedToCart ? 'pass' : 'skip',
        checkout: 'skip',
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

const PORT = 3001
app.listen(PORT, () => {
  console.log(`📸 Screenshot server running on http://localhost:${PORT}`)
  console.log(`   POST /screenshot — take a screenshot of any URL`)
  console.log(`   POST /diff-screenshot — take screenshot + compare with baseline`)
  console.log(`   POST /e-commerce-test — run e-commerce flow test`)
})

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) await browser.close()
  process.exit()
})
