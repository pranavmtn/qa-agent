import express from 'express'
import cors from 'cors'
import { chromium } from 'playwright'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
// In production the React build is at ../dist (one level up from server/)
const DIST_DIR = join(__dirname, '..', 'dist')

const app = express()
app.use(cors())
app.use(express.json({ limit: '100mb' }))

let browser = null

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true })
  }
  return browser
}

// ── Pixel-perfect diff ────────────────────────────────────────────
function runPixelDiff(buf1, buf2) {
  const img1 = PNG.sync.read(buf1)
  const img2 = PNG.sync.read(buf2)

  // Use MAX dimensions and pad the shorter image with white —
  // this ensures footers and bottom-of-page changes are always detected.
  const width  = Math.max(img1.width,  img2.width)
  const height = Math.max(img1.height, img2.height)

  // Pad image to (width × height), filling missing pixels with white (255,255,255,255)
  const padData = (img, w, h) => {
    if (img.width === w && img.height === h) return img.data
    const out = Buffer.alloc(w * h * 4, 255) // fill with white
    for (let y = 0; y < img.height && y < h; y++) {
      for (let x = 0; x < img.width && x < w; x++) {
        const si = (y * img.width + x) * 4
        const di = (y * w + x) * 4
        out[di]     = img.data[si]
        out[di + 1] = img.data[si + 1]
        out[di + 2] = img.data[si + 2]
        out[di + 3] = img.data[si + 3]
      }
    }
    return out
  }

  const data1 = padData(img1, width, height)
  const data2 = padData(img2, width, height)
  const diffImg = new PNG({ width, height })

  const changedPixels = pixelmatch(data1, data2, diffImg.data, width, height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.3,
    diffColor: [255, 0, 0],
    aaColor: [255, 255, 0],
  })

  const totalPixels = width * height
  const diffBuf = PNG.sync.write(diffImg)

  return {
    diffImage: `data:image/png;base64,${diffBuf.toString('base64')}`,
    diffScore: changedPixels / totalPixels,
    changedPixels,
    totalPixels,
  }
}

// ── Shared context factory ────────────────────────────────────────
async function createContext(b, { width = 1280, height = 800, httpAuth, storageState } = {}) {
  const context = await b.newContext({
    viewport: { width, height },
    ...(httpAuth ? { httpCredentials: { username: httpAuth.username, password: httpAuth.password } } : {}),
    ...(storageState ? { storageState } : {}),
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  return { context, page, consoleErrors }
}

// ── POST /screenshot ──────────────────────────────────────────────
app.post('/screenshot', async (req, res) => {
  const { url, width = 1280, height = 800, fullPage = true, httpAuth, storageState } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  try {
    const b = await getBrowser()
    const { context, page, consoleErrors } = await createContext(b, { width, height, httpAuth, storageState })

    const startTime = Date.now()
    let statusCode = 0
    try {
      const r = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      statusCode = r?.status() || 0
    } catch (e) {
      consoleErrors.push(`Navigation error: ${e.message}`)
    }
    const loadTime = Date.now() - startTime

    await page.waitForTimeout(5000) // wait 5s for JS/animations to settle
    const buf = await page.screenshot({ fullPage, type: 'png' })
    await context.close()

    res.json({
      screenshot: `data:image/png;base64,${buf.toString('base64')}`,
      statusCode,
      loadTime,
      consoleErrors,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /diff-image — pixel diff two already-captured screenshots ──
// Used to diff cart/checkout screenshots captured during e-commerce flow
app.post('/diff-image', (req, res) => {
  const { baseline, current } = req.body
  if (!baseline || !current) return res.status(400).json({ error: 'baseline and current are required' })
  try {
    const baselineBuf = Buffer.from(baseline.replace(/^data:image\/[^;]+;base64,/, ''), 'base64')
    const currentBuf  = Buffer.from(current.replace(/^data:image\/[^;]+;base64,/, ''), 'base64')
    const result = runPixelDiff(baselineBuf, currentBuf)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /diff-screenshot — real pixel diff via pixelmatch ────────
app.post('/diff-screenshot', async (req, res) => {
  const { url, baselineScreenshot, width = 1280, height = 800, httpAuth, storageState } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  try {
    const b = await getBrowser()
    const { context, page, consoleErrors } = await createContext(b, { width, height, httpAuth, storageState })

    const startTime = Date.now()
    let statusCode = 0
    try {
      const r = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      statusCode = r?.status() || 0
    } catch { /* partial load */ }
    const loadTime = Date.now() - startTime

    await page.waitForTimeout(5000) // wait 5s for JS/animations to settle
    const currentBuf = await page.screenshot({ fullPage: true, type: 'png' })
    await context.close()

    let diffResult = { diffImage: null, diffScore: 0, changedPixels: 0, totalPixels: 0 }

    if (baselineScreenshot) {
      try {
        const baselineBase64 = baselineScreenshot.replace(/^data:image\/png;base64,/, '')
        const baselineBuf = Buffer.from(baselineBase64, 'base64')
        diffResult = runPixelDiff(baselineBuf, currentBuf)
      } catch (e) {
        console.error('Pixel diff error:', e.message)
      }
    }

    res.json({
      screenshot: `data:image/png;base64,${currentBuf.toString('base64')}`,
      statusCode,
      loadTime,
      consoleErrors,
      diffScore: +diffResult.diffScore.toFixed(5),
      diffImage: diffResult.diffImage,
      changedPixels: diffResult.changedPixels,
      totalPixels: diffResult.totalPixels,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /multi-viewport — mobile / tablet / desktop ─────────────
app.post('/multi-viewport', async (req, res) => {
  const { url, httpAuth, storageState } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  const VIEWPORTS = [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 800 },
  ]

  const results = {}
  try {
    const b = await getBrowser()
    for (const vp of VIEWPORTS) {
      try {
        const { context, page } = await createContext(b, { width: vp.width, height: vp.height, httpAuth, storageState })
        const startTime = Date.now()
        const r = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
        const loadTime = Date.now() - startTime
        await page.waitForTimeout(5000) // wait 5s for JS/animations to settle
        const buf = await page.screenshot({ fullPage: false, type: 'png' })
        await context.close()
        results[vp.name] = {
          width: vp.width, height: vp.height,
          screenshot: `data:image/png;base64,${buf.toString('base64')}`,
          statusCode: r?.status() || 0,
          loadTime,
        }
      } catch (err) {
        results[vp.name] = { width: vp.width, height: vp.height, error: err.message }
      }
    }
    res.json({ viewports: results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /form-test — discover, fill, and submit forms ───────────
app.post('/form-test', async (req, res) => {
  const { url, httpAuth, storageState } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  try {
    const b = await getBrowser()
    const { context, page } = await createContext(b, { width: 1280, height: 800, httpAuth, storageState })

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1000)

    const formCount = await page.evaluate(() => document.querySelectorAll('form').length)

    const formResults = []

    for (let fi = 0; fi < Math.min(formCount, 3); fi++) {
      if (fi > 0) {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(800)
      }

      const steps = []
      const formHandle = await page.$(`form:nth-of-type(${fi + 1})`)
      if (!formHandle) {
        formResults.push({ form_index: fi, steps: [{ action: 'Locate form', status: 'fail' }] })
        continue
      }

      const formInfo = await formHandle.evaluate((f, idx) => ({
        id: f.id || f.name || `form-${idx}`,
        action: f.action || '',
        method: f.method || 'get',
      }), fi)

      steps.push({ action: `Located form: "${formInfo.id}"`, status: 'pass' })

      // Fill inputs
      const inputs = await formHandle.$$(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, select'
      )

      for (const input of inputs) {
        const [type, name, id, tagName] = await Promise.all([
          input.getAttribute('type').catch(() => 'text'),
          input.getAttribute('name').catch(() => ''),
          input.getAttribute('id').catch(() => ''),
          input.evaluate(el => el.tagName.toLowerCase()),
        ])
        const key = (name || id || '').toLowerCase()

        let value = 'Test Input'
        if (type === 'email' || key.includes('email')) value = 'qa-test@example.com'
        else if (type === 'tel' || key.includes('phone') || key.includes('tel')) value = '+1-555-0100'
        else if (key.includes('firstname') || key.includes('first_name') || key === 'first') value = 'QA'
        else if (key.includes('lastname') || key.includes('last_name') || key === 'last') value = 'Tester'
        else if (key.includes('name')) value = 'QA Tester'
        else if (type === 'number' || key.includes('age') || key.includes('qty') || key.includes('amount')) value = '1'
        else if (type === 'url' || key.includes('website') || key.includes('url')) value = 'https://qa-test.example.com'
        else if (type === 'date') value = '2025-01-01'
        else if (tagName === 'textarea' || key.includes('message') || key.includes('comment') || key.includes('body')) value = 'This is a QA test submission. Please ignore.'

        try {
          if (tagName === 'select') {
            const options = await input.$$('option')
            if (options.length > 1) {
              const val = await options[1].getAttribute('value')
              if (val) await input.selectOption(val)
            }
          } else {
            await input.fill(value)
          }
          steps.push({ action: `Fill "${name || id || type}": "${value.slice(0, 40)}"`, status: 'pass' })
        } catch {
          steps.push({ action: `Fill "${name || id || type}"`, status: 'fail' })
        }
      }

      if (inputs.length === 0) {
        steps.push({ action: 'No fillable inputs found', status: 'skip' })
        formResults.push({ form_id: formInfo.id, input_count: 0, steps })
        continue
      }

      const beforeBuf = await page.screenshot({ type: 'png' })

      // Submit
      try {
        const submitBtn = await formHandle.$('button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])')
        if (submitBtn) {
          const urlBefore = page.url()
          await Promise.race([
            page.waitForNavigation({ timeout: 5000 }).catch(() => {}),
            submitBtn.click(),
          ])
          await page.waitForTimeout(2000)
          const urlAfter = page.url()
          steps.push({
            action: 'Submit form',
            status: 'pass',
            detail: urlAfter !== urlBefore ? `Navigated to: ${urlAfter}` : 'Submitted in-place',
          })

          const hasError = await page.evaluate(() =>
            !!document.querySelector('.error, .alert-danger, [class*="error"], [aria-invalid="true"], .invalid-feedback, .field-error')
          ).catch(() => false)
          steps.push({ action: 'Check for validation errors', status: hasError ? 'fail' : 'pass' })
        } else {
          steps.push({ action: 'Find submit button', status: 'fail' })
        }
      } catch (err) {
        steps.push({ action: 'Submit form', status: 'fail', detail: err.message })
      }

      const afterBuf = await page.screenshot({ type: 'png' })

      formResults.push({
        form_id: formInfo.id,
        form_action: formInfo.action,
        input_count: inputs.length,
        steps,
        screenshot_before: `data:image/png;base64,${beforeBuf.toString('base64')}`,
        screenshot_after: `data:image/png;base64,${afterBuf.toString('base64')}`,
      })
    }

    await context.close()
    res.json({ form_count: formCount, forms: formResults })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /login-flow — form login → return storageState ──────────
app.post('/login-flow', async (req, res) => {
  const { loginUrl, username, password, usernameSelector, passwordSelector, submitSelector, httpAuth } = req.body
  if (!loginUrl || !username || !password) {
    return res.status(400).json({ error: 'loginUrl, username, password required' })
  }

  try {
    const b = await getBrowser()
    const { context, page } = await createContext(b, { width: 1280, height: 800, httpAuth })

    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(500)

    // Find and fill username field
    const userSelectors = usernameSelector
      ? [usernameSelector]
      : ['input[type="email"]', 'input[name="email"]', 'input[name="username"]', 'input[name="user"]', 'input[name="login"]', '#username', '#email', 'input[autocomplete="username"]', 'input[autocomplete="email"]']

    let filledUser = false
    for (const sel of userSelectors) {
      try {
        const el = await page.$(sel)
        if (el) { await el.fill(username); filledUser = true; break }
      } catch { /* try next */ }
    }
    if (!filledUser) {
      await context.close()
      return res.status(400).json({ error: 'Could not find username/email field. Try providing usernameSelector.' })
    }

    // Find and fill password field
    const passSelectors = passwordSelector
      ? [passwordSelector]
      : ['input[type="password"]', '#password', 'input[name="password"]', 'input[name="pass"]', 'input[autocomplete="current-password"]']

    let filledPass = false
    for (const sel of passSelectors) {
      try {
        const el = await page.$(sel)
        if (el) { await el.fill(password); filledPass = true; break }
      } catch { /* try next */ }
    }
    if (!filledPass) {
      await context.close()
      return res.status(400).json({ error: 'Could not find password field. Try providing passwordSelector.' })
    }

    // Submit
    const submitSelectors = submitSelector
      ? [submitSelector]
      : ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Login")', 'button:has-text("Log In")', 'button:has-text("Sign In")', 'button:has-text("Sign in")', '.login-btn', '#login-btn']

    let submitted = false
    for (const sel of submitSelectors) {
      try {
        const el = await page.$(sel)
        if (el) {
          await Promise.race([
            page.waitForNavigation({ timeout: 5000 }).catch(() => {}),
            el.click(),
          ])
          await page.waitForTimeout(3000)
          submitted = true
          break
        }
      } catch { /* try next */ }
    }

    if (!submitted) {
      // Fallback: press Enter on password field
      const passEl = await page.$('input[type="password"]')
      if (passEl) { await passEl.press('Enter'); await page.waitForTimeout(3000); submitted = true }
    }

    const currentUrl = page.url()
    const success = submitted && currentUrl !== loginUrl
    const storageState = await context.storageState()
    const screenshot = await page.screenshot({ type: 'png' })
    await context.close()

    res.json({
      success,
      currentUrl,
      storageState,
      screenshot: `data:image/png;base64,${screenshot.toString('base64')}`,
      message: success ? 'Login successful' : 'Login may have failed — URL did not change after submit',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /e-commerce-test ─────────────────────────────────────────
app.post('/e-commerce-test', async (req, res) => {
  const { url, width = 1280, height = 800, httpAuth, storageState, variationSelectors = [] } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  // Derive base URL (e.g. https://example.com) from product URL
  const baseUrl = new URL(url).origin

  try {
    const b = await getBrowser()
    const { context, page } = await createContext(b, { width, height, httpAuth, storageState })

    const steps = []
    const screenshots = {}
    const checks = { product_page: 'fail', add_to_cart: 'fail', cart_update: 'fail', checkout: 'fail' }

    // ── 1. Navigate to product page ──────────────────────────────
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      steps.push({ action: 'Navigate to product page', status: 'done' })
      checks.product_page = 'pass'
    } catch {
      steps.push({ action: 'Navigate to product page', status: 'failed' })
      screenshots.product = `data:image/png;base64,${(await page.screenshot({ type: 'png' })).toString('base64')}`
      await context.close()
      return res.json({ steps, screenshot: screenshots.product, screenshots, checks })
    }

    await page.waitForTimeout(1200)
    screenshots.product = `data:image/png;base64,${(await page.screenshot({ fullPage: true, type: 'png' })).toString('base64')}`

    // ── 2. Handle required product variations (size, color, etc.) ──
    // WooCommerce variable products require all attributes to be selected
    // before the Add to Cart button becomes enabled.
    let variationsSelected = 0
    try {
      // --- Custom selectors provided by the user (highest priority) ---
      if (variationSelectors.length > 0) {
        for (const sel of variationSelectors) {
          try {
            const el = await page.$(sel)
            if (!el) { steps.push({ action: `Custom selector not found: ${sel}`, status: 'failed' }); continue }
            const tag = await el.evaluate(n => n.tagName.toLowerCase())
            if (tag === 'select') {
              const firstOpt = await el.$('option:not([value=""]):not([disabled])')
              if (firstOpt) {
                const val = await firstOpt.getAttribute('value')
                await el.selectOption(val)
                await el.dispatchEvent('change')
              }
            } else {
              await el.scrollIntoViewIfNeeded()
              await el.click()
            }
            await page.waitForTimeout(600)
            variationsSelected++
            steps.push({ action: `Custom variation selector applied: ${sel}`, status: 'done' })
          } catch (e) {
            steps.push({ action: `Custom selector failed: ${sel} — ${e.message}`, status: 'failed' })
          }
        }
        // Wait for button to enable after custom selections
        await Promise.race([
          page.waitForFunction(() => {
            const btn = document.querySelector('button.single_add_to_cart_button')
            return btn && !btn.disabled && !btn.classList.contains('disabled')
          }, { timeout: 3000 }).catch(() => {}),
          page.waitForTimeout(1500),
        ])
      } else {
      // --- Auto-detect: Native <select> dropdowns (most common WooCommerce setup) ---
      const variationSelects = await page.$$('table.variations select, .variations_form select, form.cart .variations select')
      for (const sel of variationSelects) {
        // Skip if already has a real value selected
        const current = await sel.inputValue().catch(() => '')
        if (current && current !== '') continue
        // Pick the first non-placeholder, non-disabled option
        const firstOpt = await sel.$('option:not([value=""]):not([disabled])')
        if (firstOpt) {
          const val = await firstOpt.getAttribute('value')
          await sel.selectOption(val)
          // Trigger WooCommerce AJAX variation lookup
          await sel.dispatchEvent('change')
          await page.waitForTimeout(700)
          variationsSelected++
          steps.push({ action: `Select variation option (${val})`, status: 'done' })
        }
      }

      // --- Radio button swatches (hidden inputs with visible labels) ---
      // Group by name so we only select one per attribute
      const radioGroups = {}
      const radios = await page.$$('form.cart input[type="radio"][name], .variations input[type="radio"][name]')
      for (const r of radios) {
        const name = await r.getAttribute('name')
        if (name && !radioGroups[name]) radioGroups[name] = r
      }
      for (const [, radio] of Object.entries(radioGroups)) {
        const checked = await radio.isChecked().catch(() => false)
        if (!checked) {
          // Try clicking the visible label/swatch instead of the hidden input
          const id = await radio.getAttribute('id')
          const label = id ? await page.$(`label[for="${id}"]`) : null
          if (label && await label.isVisible()) {
            await label.click()
          } else {
            await radio.click({ force: true })
          }
          await page.waitForTimeout(700)
          variationsSelected++
          const val = await radio.getAttribute('value') || 'option'
          steps.push({ action: `Select variation radio (${val})`, status: 'done' })
        }
      }

      // --- WooCommerce Variation Swatches plugin (wvs-style-squared, radio-variable-items) ---
      // These use a hidden <select> + visible <ul><li data-value="..."> structure.
      // We must BOTH click the <li> AND programmatically set the hidden <select> so WooCommerce JS registers it.
      const wvsLists = await page.$$('ul.variable-items-wrapper[data-attribute_name], ul[data-attribute_name].radio-variable-items-wrapper')
      for (const list of wvsLists) {
        const attrName = await list.getAttribute('data-attribute_name')
        // Find first non-out-of-stock li with a data-value
        const li = await list.$('li[data-value]:not([data-wvstooltip-out-of-stock]):not(.out-of-stock)')
          || await list.$('li[data-value]')
        if (!li) continue
        const val = await li.getAttribute('data-value')
        // Click the swatch li
        await li.scrollIntoViewIfNeeded()
        await li.click()
        await page.waitForTimeout(400)
        // Also sync the hidden <select> so WooCommerce's variation script fires
        if (attrName && val) {
          await page.evaluate(({ attrName, val }) => {
            const sel = document.querySelector(`select[name="${attrName}"], select[data-attribute_name="${attrName}"]`)
            if (sel) { sel.value = val; sel.dispatchEvent(new Event('change', { bubbles: true })) }
          }, { attrName, val })
        }
        await page.waitForTimeout(500)
        variationsSelected++
        steps.push({ action: `WVS swatch selected: ${attrName}=${val}`, status: 'done' })
      }

      // --- Generic visual swatch buttons (other themes/plugins) ---
      const swatchContainers = await page.$$('[class*="swatch-wrapper"]:not([class*="variable-items-wrapper"]), [class*="tawcvs"]')
      for (const container of swatchContainers) {
        const swatch = await container.$('[data-value]:not(.selected):not(.active):not(.chosen):not([disabled])')
        if (swatch && await swatch.isVisible()) {
          await swatch.click()
          await page.waitForTimeout(600)
          variationsSelected++
          steps.push({ action: 'Select variation swatch', status: 'done' })
        }
      }

      if (variationsSelected > 0) {
        // Wait for WooCommerce to re-evaluate the variation and enable the button
        await Promise.race([
          page.waitForFunction(() => {
            const btn = document.querySelector('button.single_add_to_cart_button')
            return btn && !btn.disabled && !btn.classList.contains('disabled')
          }, { timeout: 4000 }).catch(() => {}),
          page.waitForTimeout(2000),
        ])
        steps.push({ action: `${variationsSelected} variation(s) selected — button ready`, status: 'done' })
      }
      } // end else (auto-detect)
    } catch (e) {
      steps.push({ action: `Variation selection error: ${e.message}`, status: 'failed' })
    }

    // ── 3. Click Add to Cart ──────────────────────────────────────
    const addToCartSelectors = [
      'button.single_add_to_cart_button',          // WooCommerce product page
      'button[name="add-to-cart"]',
      'input[name="add-to-cart"]',
      'button:has-text("Add to cart")',
      'button:has-text("Add to Cart")',
      'button:has-text("Add to Bag")',
      'button:has-text("Buy Now")',
      '[class*="add-to-cart"]:not(a)',
      '[class*="addToCart"]:not(a)',
      '#add-to-cart',
      '.add-to-cart-button',
      'input[value*="Add to cart"]',
      '[data-action="add-to-cart"]',
    ]

    let addedToCart = false
    for (const sel of addToCartSelectors) {
      try {
        const btn = await page.$(sel)
        if (!btn) continue
        const visible = await btn.isVisible().catch(() => false)
        if (!visible) continue
        // Skip if button is disabled (variation not fully selected yet)
        const disabled = await btn.isDisabled().catch(() => false)
        if (disabled) {
          steps.push({ action: `Add to Cart button found but disabled — check variation selection`, status: 'failed' })
          break
        }
        await btn.scrollIntoViewIfNeeded()
        await btn.click()
        // Wait for success indicator or page update
        await Promise.race([
          page.waitForSelector(
            '.woocommerce-message, .added_to_cart, .wc-forward, [class*="cart-updated"], [class*="success"]',
            { timeout: 5000 }
          ).catch(() => {}),
          page.waitForTimeout(3000),
        ])
        addedToCart = true
        steps.push({ action: `Add to Cart clicked`, status: 'done' })
        break
      } catch { /* try next selector */ }
    }

    if (!addedToCart) {
      steps.push({ action: 'Add to Cart button not found or could not be clicked', status: 'failed' })
      checks.add_to_cart = 'fail'
    } else {
      checks.add_to_cart = 'pass'
    }

    screenshots.after_add = `data:image/png;base64,${(await page.screenshot({ fullPage: true, type: 'png' })).toString('base64')}`

    // ── 4. Navigate to Cart page ──────────────────────────────────
    let cartVerified = false
    if (addedToCart) {
      try {
        // Try clicking "View Cart" link first (WooCommerce shows this after add)
        const viewCartLink = await page.$('a.added_to_cart, .woocommerce-message a[href*="cart"], a:has-text("View cart"), a:has-text("View Cart")')
        if (viewCartLink) {
          await viewCartLink.click()
        } else {
          await page.goto(`${baseUrl}/cart`, { waitUntil: 'networkidle', timeout: 30000 })
        }
        await page.waitForTimeout(1500)

        // Verify cart has items
        const cartItem = await page.$('.cart_item, .woocommerce-cart-form .cart_item, tr.cart_item, .cart-item')
        cartVerified = !!cartItem
        checks.cart_update = cartVerified ? 'pass' : 'fail'
        steps.push({ action: 'Verify item in cart', status: cartVerified ? 'done' : 'failed' })
        screenshots.cart = `data:image/png;base64,${(await page.screenshot({ fullPage: true, type: 'png' })).toString('base64')}`
      } catch (e) {
        steps.push({ action: 'Navigate to cart', status: 'failed' })
        checks.cart_update = 'fail'
      }
    } else {
      checks.cart_update = 'skip'
    }

    // ── 5. Proceed to Checkout ────────────────────────────────────
    if (cartVerified) {
      try {
        // Try "Proceed to Checkout" button on cart page first
        const checkoutBtn = await page.$('a.checkout-button, .checkout-button, a[href*="checkout"]:has-text("Checkout"), a:has-text("Proceed to checkout"), a:has-text("Proceed to Checkout")')
        if (checkoutBtn) {
          await checkoutBtn.click()
        } else {
          await page.goto(`${baseUrl}/checkout`, { waitUntil: 'networkidle', timeout: 30000 })
        }
        await page.waitForTimeout(1500)

        // Verify checkout page loaded (has billing fields or order summary)
        const checkoutEl = await page.$('#billing_first_name, .woocommerce-checkout, form[name="checkout"], #checkout, .checkout-form, [class*="checkout"]')
        const checkoutOk = !!checkoutEl
        checks.checkout = checkoutOk ? 'pass' : 'fail'
        steps.push({ action: 'Load checkout page', status: checkoutOk ? 'done' : 'failed' })
        screenshots.checkout = `data:image/png;base64,${(await page.screenshot({ fullPage: true, type: 'png' })).toString('base64')}`
      } catch (e) {
        steps.push({ action: 'Navigate to checkout', status: 'failed' })
        checks.checkout = 'fail'
      }
    } else {
      steps.push({ action: 'Skip checkout (cart empty or add-to-cart failed)', status: 'skipped' })
      checks.checkout = 'skip'
    }

    await context.close()

    res.json({
      steps,
      screenshot: screenshots.checkout || screenshots.cart || screenshots.after_add || screenshots.product,
      screenshots,
      checks,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Health ────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// ── Serve React frontend (production) ────────────────────────────
// In production, Express serves the Vite build from /dist.
// In local dev, the Vite dev server handles the frontend separately.
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // React Router — send all non-API routes to index.html
  app.get('*', (req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'))
  })
}

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`QA server on http://0.0.0.0:${PORT}`)
  if (existsSync(DIST_DIR)) {
    console.log('  Serving React frontend from /dist')
  } else {
    console.log('  API only mode (run "npm run build" to include frontend)')
  }
  console.log('  /screenshot  /diff-screenshot  /multi-viewport  /form-test  /login-flow')
})

process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit() })
