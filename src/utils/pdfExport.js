import { jsPDF } from 'jspdf'

// Strip any characters jsPDF's built-in Helvetica font cannot render.
// Covers: markdown bold (**text**), bullet •, dashes –—, smart quotes,
// checkmarks ✓✗, arrows →, and any non-Latin-1 code point.
function sanitize(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/\*\*(.*?)\*\*/g, '$1')          // **bold** → bold
    .replace(/\*(.*?)\*/g, '$1')              // *italic* → italic
    .replace(/[•·‣▪▸]/g, '-')                // bullets → -
    .replace(/[–—]/g, '-')                   // em/en dash → -
    .replace(/[\u201C\u201D\u201E]/g, '"')   // smart double quotes
    .replace(/[\u2018\u2019\u201A]/g, "'")   // smart single quotes
    .replace(/[✓✔☑]/g, '[PASS]')
    .replace(/[✗✘☓]/g, '[FAIL]')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[^\x00-\xFF]/g, '?')           // anything above Latin-1 → ?
}

// Sanitize and split text to lines, safe to feed to doc.text()
function splitText(doc, str, maxW) {
  return doc.splitTextToSize(sanitize(str), maxW)
}

// Compress a data URL to JPEG at reduced size for embedding in PDF
async function compressToJpeg(dataUrl, maxWidth = 1000, quality = 0.75) {
  if (!dataUrl || dataUrl.startsWith('[') || dataUrl.startsWith('data:image/svg')) return null
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (!img.width || !img.height) return resolve(null)
      const scale = Math.min(1, maxWidth / img.width)
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      const out = canvas.toDataURL('image/jpeg', quality)
      if (!out || out === 'data:,') return resolve(null)
      resolve({ dataUrl: out, w, h })
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

// Add a compressed image to the PDF, return actual height used in mm
function addImg(doc, compressed, x, y, maxW, maxH) {
  if (!compressed || !compressed.dataUrl || compressed.w <= 0 || compressed.h <= 0) return 0
  try {
    const ratio = compressed.h / compressed.w
    const dispW = Math.min(maxW, Math.max(1, compressed.w / 3.78)) // px → mm
    const dispH = Math.min(maxH, Math.max(1, dispW * ratio))
    if (!isFinite(dispW) || !isFinite(dispH) || dispW <= 0 || dispH <= 0) return 0
    // Pass full data URL — jsPDF handles format detection
    doc.addImage(compressed.dataUrl, 'JPEG', x, y, dispW, dispH)
    return dispH
  } catch (e) {
    console.warn('addImg skipped:', e.message)
    return 0
  }
}

export async function generateQAReportPDF(run, task, website, baselineRun) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()   // 210mm
  const PH = doc.internal.pageSize.getHeight()  // 297mm
  const M = 14
  const CW = PW - M * 2  // 182mm

  const isRerun = run.run_type === 'rerun'

  // Colour constants [r, g, b]
  const INDIGO = [79, 70, 229]
  const GRAY   = [107, 114, 128]
  const RED    = [239, 68, 68]
  const GREEN  = [16, 185, 129]
  const AMBER  = [245, 158, 11]
  const WHITE  = [255, 255, 255]
  const BLACK  = [17, 24, 39]
  const LIGHTBG = [248, 250, 252]

  const newPage = () => { doc.addPage(); return M }

  // ── Cover page ───────────────────────────────────────────────────
  doc.setFillColor(...INDIGO)
  doc.rect(0, 0, PW, 58, 'F')

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.text('QA Report', M, 28)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(14)
  doc.text(sanitize(website?.name || task?.name || 'QA Run'), M, 40)
  doc.setFontSize(9)
  doc.text(sanitize(`Generated ${new Date().toLocaleString()}`), M, 49)
  doc.text(sanitize(`Run started ${new Date(run.created_at).toLocaleString()}`), M, 55)

  let y = 70
  doc.setTextColor(...BLACK)

  // Run type badge
  const badgeBg = isRerun ? [207, 250, 254] : [220, 252, 231]
  const badgeFg = isRerun ? [14, 116, 144] : [6, 95, 70]
  doc.setFillColor(...badgeBg)
  doc.roundedRect(M, y, 40, 8, 2, 2, 'F')
  doc.setTextColor(...badgeFg)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text(isRerun ? 'RERUN & COMPARE' : 'BASELINE RUN', M + 20, y + 5.5, { align: 'center' })

  if (run.login_used) {
    doc.setFillColor(238, 242, 255)
    doc.roundedRect(M + 44, y, 32, 8, 2, 2, 'F')
    doc.setTextColor(...INDIGO)
    doc.text('AUTHENTICATED', M + 60, y + 5.5, { align: 'center' })
  }
  y += 14

  // Stats grid
  const errorCount = run.pages.reduce((n, p) => n + (p.console_errors?.length || 0), 0)
  const regressedCount = run.pages.filter((p) => p.diff_score > 0.05).length
  const ecomFailCount = run.pages.filter((p) => p.ecommerce_checks && Object.values(p.ecommerce_checks).includes('fail')).length
  const duration = run.completed_at ? Math.round((new Date(run.completed_at) - new Date(run.created_at)) / 1000) : 0
  const vpCount = run.pages.filter((p) => p.viewports && Object.keys(p.viewports).length > 0).length
  const formTestedCount = run.pages.filter((p) => p.form_tests?.length > 0).length

  const statsData = [
    { label: 'Pages', value: String(run.pages.length) },
    { label: 'Console Errors', value: String(errorCount), alert: errorCount > 0 },
    ...(isRerun ? [{ label: 'Regressions', value: String(regressedCount), alert: regressedCount > 0 }] : []),
    ...(ecomFailCount > 0 ? [{ label: 'E-com Fails', value: String(ecomFailCount), alert: true }] : []),
    { label: 'Duration', value: duration ? `${duration}s` : '-' },
    ...(vpCount > 0 ? [{ label: 'Viewports', value: `${vpCount} pages` }] : []),
    ...(formTestedCount > 0 ? [{ label: 'Forms Tested', value: String(formTestedCount) }] : []),
  ]

  const colW = (CW - 12) / 4
  for (let i = 0; i < statsData.length; i++) {
    const col = i % 4
    const row = Math.floor(i / 4)
    const sx = M + col * (colW + 4)
    const sy = y + row * 22

    doc.setFillColor(...LIGHTBG)
    doc.roundedRect(sx, sy, colW, 18, 2, 2, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(...(statsData[i].alert ? RED : BLACK))
    doc.text(statsData[i].value, sx + colW / 2, sy + 10, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(statsData[i].label, sx + colW / 2, sy + 15, { align: 'center' })
  }
  y += Math.ceil(statsData.length / 4) * 22 + 4

  // Baseline reference
  if (isRerun && baselineRun) {
    doc.setFillColor(240, 249, 255)
    doc.rect(M, y, CW, 7, 'F')
    doc.setFontSize(7.5)
    doc.setTextColor(3, 105, 161)
    doc.text(sanitize(`Compared against baseline: ${new Date(baselineRun.created_at).toLocaleString()}`), M + 3, y + 4.5)
    y += 11
  }

  // AI Summary
  if (run.summary) {
    doc.setFillColor(238, 242, 255)
    const lines = splitText(doc, run.summary, CW - 8)
    const bH = lines.length * 4.5 + 10
    if (y + bH > PH - M) y = newPage()
    doc.roundedRect(M, y, CW, bH, 3, 3, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INDIGO)
    doc.text('AI Summary', M + 4, y + 6)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(lines, M + 4, y + 11)
    y += bH + 6
  }

  // Page index table
  if (y > PH - 70) y = newPage()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text('Page Index', M, y)
  y += 6

  doc.setFillColor(...INDIGO)
  doc.rect(M, y, CW, 6, 'F')
  doc.setTextColor(...WHITE)
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.text('#', M + 2, y + 4)
  doc.text('Page', M + 9, y + 4)
  doc.text('HTTP', M + 112, y + 4)
  doc.text('Load', M + 128, y + 4)
  doc.text('Errors', M + 147, y + 4)
  if (isRerun) doc.text('Pixel Diff', M + 164, y + 4)
  y += 6

  for (let pi = 0; pi < run.pages.length; pi++) {
    const p = run.pages[pi]
    if (y > PH - 12) y = newPage()
    doc.setFillColor(...(pi % 2 === 0 ? WHITE : LIGHTBG))
    doc.rect(M, y, CW, 5.5, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(String(pi + 1), M + 2, y + 3.8)

    doc.setTextColor(...BLACK)
    doc.text(sanitize((p.label || p.url).slice(0, 58)), M + 9, y + 3.8)

    doc.setTextColor(...(p.status_code === 200 ? GREEN : RED))
    doc.text(sanitize(String(p.status_code || '-')), M + 112, y + 3.8)

    doc.setTextColor(...GRAY)
    doc.text(sanitize(`${p.load_time_ms}ms`), M + 128, y + 3.8)

    doc.setTextColor(...(p.console_errors?.length > 0 ? RED : GRAY))
    doc.text(String(p.console_errors?.length || 0), M + 147, y + 3.8)

    if (isRerun && p.diff_score != null) {
      const dc = p.diff_score < 0.01 ? GREEN : p.diff_score < 0.05 ? AMBER : RED
      doc.setTextColor(...dc)
      doc.text(sanitize(`${(p.diff_score * 100).toFixed(2)}%`), M + 164, y + 3.8)
    }
    y += 5.5
  }

  // ── Per-page detail sections ─────────────────────────────────────
  for (let pi = 0; pi < run.pages.length; pi++) {
    const p = run.pages[pi]
    y = newPage()

    // Page header bar
    const headerClr = p.status_code !== 200 ? RED : (isRerun && p.diff_score > 0.05 ? AMBER : INDIGO)
    doc.setFillColor(...headerClr)
    doc.rect(0, 0, PW, 17, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(sanitize(`Page ${pi + 1}/${run.pages.length}: ${(p.label || p.url).slice(0, 58)}`), M, 10)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(sanitize(p.url.slice(0, 90)), M, 15)
    y = 23

    // Metrics row
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...(p.status_code === 200 ? GREEN : RED))
    doc.text(sanitize(`HTTP ${p.status_code || '-'}`), M, y)

    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'normal')
    doc.text(sanitize(`Load: ${p.load_time_ms}ms`), M + 28, y)

    if (p.console_errors?.length > 0) {
      doc.setTextColor(...RED)
      doc.text(sanitize(`${p.console_errors.length} console error(s)`), M + 62, y)
    }

    if (isRerun && p.diff_score != null) {
      const dc = p.diff_score < 0.01 ? GREEN : p.diff_score < 0.05 ? AMBER : RED
      doc.setTextColor(...dc)
      doc.setFont('helvetica', 'bold')
      doc.text(sanitize(`Pixel diff: ${(p.diff_score * 100).toFixed(3)}%`), M + 112, y)
      if (p.pixel_changed != null) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(...GRAY)
        doc.text(sanitize(`${p.pixel_changed.toLocaleString()} / ${p.pixel_total?.toLocaleString()} px`), M + 112, y + 4)
      }
    }
    y += 9

    // ── Current screenshot
    const curImg = await compressToJpeg(p.screenshot_url, 1400)
    if (curImg) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...BLACK)
      doc.text(isRerun ? 'Current Screenshot' : 'Baseline Screenshot', M, y)
      y += 4
      const h = addImg(doc, curImg, M, y, CW, 90)
      y += h + 6
    }

    // ── Baseline + pixel diff (rerun only)
    if (isRerun) {
      const hasBase = p.diff_image_url && !p.diff_image_url.startsWith('[') && !p.diff_image_url.startsWith('data:image/svg')
      const hasDiff = p.pixel_diff_url && !p.pixel_diff_url.startsWith('[') && !p.pixel_diff_url.startsWith('data:image/svg')

      if (hasBase || hasDiff) {
        if (y > PH - 75) y = newPage()

        const halfW = (CW - 5) / 2

        if (hasBase) {
          const baseImg = await compressToJpeg(p.diff_image_url, 900)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(8)
          doc.setTextColor(...GRAY)
          doc.text('Baseline (previous)', M, y)
          const bh = addImg(doc, baseImg, M, y + 3, halfW, 80)

          if (hasDiff) {
            const diffImg = await compressToJpeg(p.pixel_diff_url, 900)
            doc.setTextColor(...RED)
            doc.text('Pixel Diff  (red = changed pixels)', M + halfW + 5, y)
            addImg(doc, diffImg, M + halfW + 5, y + 3, halfW, 80)
          }
          y += bh + 8
        }
      }
    }

    // ── Viewport screenshots
    if (p.viewports && Object.keys(p.viewports).length > 0) {
      if (y > PH - 65) y = newPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text('Viewport Comparison', M, y)
      y += 5

      const vpList = Object.entries(p.viewports)
      const vpW = (CW - (vpList.length - 1) * 4) / vpList.length
      let maxH = 0

      for (let vi = 0; vi < vpList.length; vi++) {
        const [vpName, vpData] = vpList[vi]
        const x = M + vi * (vpW + 4)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...GRAY)
        doc.text(sanitize(`${vpName}  ${vpData.width}x${vpData.height}px`), x, y)

        if (vpData.screenshot && !vpData.screenshot.startsWith('[')) {
          const vpImg = await compressToJpeg(vpData.screenshot, 700)
          const h = addImg(doc, vpImg, x, y + 3, vpW, 55)
          maxH = Math.max(maxH, h)
        }
      }
      y += maxH + 9
    }

    // ── Form tests
    if (p.form_tests?.length > 0) {
      if (y > PH - 45) y = newPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text(sanitize(`Form Tests (${p.form_tests.length} form${p.form_tests.length !== 1 ? 's' : ''})`), M, y)
      y += 5

      for (const ft of p.form_tests) {
        if (y > PH - 20) y = newPage()
        doc.setFillColor(245, 243, 255)
        doc.rect(M, y, CW, 6, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(109, 40, 217)
        doc.text(sanitize(`Form: "${ft.form_id}"  -  ${ft.input_count || 0} input(s)`), M + 3, y + 4)
        y += 8

        for (const step of ft.steps || []) {
          if (y > PH - 10) y = newPage()
          const sc = step.status === 'pass' ? GREEN : step.status === 'fail' ? RED : GRAY
          doc.setTextColor(...sc)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          const icon = step.status === 'pass' ? '[✓]' : step.status === 'fail' ? '[✗]' : '[ ]'
          const detail = step.detail ? `  — ${step.detail}` : ''
          doc.text(sanitize(`  ${icon} ${step.action}${detail}`), M + 4, y)
          y += 4
        }

        // Form after-submission screenshot
        if (ft.screenshot_after && !ft.screenshot_after.startsWith('[')) {
          if (y > PH - 55) y = newPage()
          doc.setFontSize(7)
          doc.setTextColor(...GRAY)
          doc.text('  After submission:', M + 4, y)
          y += 3
          const ftImg = await compressToJpeg(ft.screenshot_after, 1000)
          const h = addImg(doc, ftImg, M + 4, y, CW - 8, 55)
          y += h + 5
        }
        y += 3
      }
    }

    // ── E-commerce checks
    if (p.ecommerce_checks) {
      if (y > PH - 35) y = newPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text('E-commerce Flow', M, y)
      y += 5

      for (const [k, v] of Object.entries(p.ecommerce_checks)) {
        if (y > PH - 10) y = newPage()
        const vc = v === 'pass' ? GREEN : v === 'fail' ? RED : GRAY
        doc.setTextColor(...vc)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.text(sanitize(`  ${v === 'pass' ? '[PASS]' : v === 'fail' ? '[FAIL]' : '[-]'} ${k.replace(/_/g, ' ')}: ${v}`), M + 3, y)
        y += 4.5
      }
      y += 3
    }

    // ── Console errors
    if (p.console_errors?.length > 0) {
      if (y > PH - 28) y = newPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...RED)
      doc.text(sanitize(`Console Errors  (${p.console_errors.length})`), M, y)
      y += 4

      const errLines = p.console_errors
        .slice(0, 8)
        .flatMap((e) => splitText(doc, `• ${sanitize(e)}`, CW - 8))
      const bH = errLines.length * 3.8 + 6
      if (y + bH > PH - M) y = newPage()
      doc.setFillColor(254, 242, 242)
      doc.rect(M, y, CW, bH, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(185, 28, 28)
      doc.text(errLines, M + 4, y + 4.5)
      y += bH + 4
    }

    // ── Automated interactions
    if (p.interactions?.length > 0) {
      if (y > PH - 25) y = newPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...BLACK)
      doc.text('Automated Interactions', M, y)
      y += 4
      for (const step of p.interactions) {
        if (y > PH - 8) y = newPage()
        const sc = step.status === 'done' ? GREEN : RED
        doc.setTextColor(...sc)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.text(sanitize(`  ${step.status === 'done' ? '[PASS]' : '[FAIL]'} ${step.action}`), M + 3, y)
        y += 4
      }
    }
  }

  // ── Footer on every page ─────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  const footerText = sanitize(`${website?.name || 'QA Report'}  .  ${isRerun ? 'Rerun & Compare' : 'Baseline'}  .  ${new Date(run.created_at).toLocaleDateString()}`)
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFillColor(...LIGHTBG)
    doc.rect(0, PH - 8, PW, 8, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(footerText, M, PH - 3)
    doc.text(sanitize(`Page ${i} of ${totalPages}`), PW - M, PH - 3, { align: 'right' })
  }

  return doc
}

// ═══════════════════════════════════════════════════════════════════
// Task comparison PDF — baseline vs rerun, focused on differences
// ═══════════════════════════════════════════════════════════════════
export async function generateTaskComparisonPDF({ task, website, client, baselineRun, rerunRun, comparison, aiSummary }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 14
  const CW = PW - M * 2

  const INDIGO = [79, 70, 229]
  const GRAY   = [107, 114, 128]
  const RED    = [239, 68, 68]
  const GREEN  = [16, 185, 129]
  const AMBER  = [245, 158, 11]
  const WHITE  = [255, 255, 255]
  const BLACK  = [17, 24, 39]
  const LIGHTBG = [248, 250, 252]

  const newPage = () => { doc.addPage(); return M }

  const { regressions, newErrorPages, resolvedErrorPages } = comparison
  const totalNewErrors = newErrorPages.reduce((n, p) => n + p.errors.length, 0)
  const totalResolved = resolvedErrorPages.reduce((n, p) => n + p.errors.length, 0)
  const isClean = regressions.length === 0 && totalNewErrors === 0
  const verdict = isClean ? 'PASS' : 'FAIL'

  // ── Cover page ───────────────────────────────────────────────────
  const headerClr = isClean ? [16, 185, 129] : (regressions.length > 0 ? [245, 158, 11] : [239, 68, 68])
  doc.setFillColor(...headerClr)
  doc.rect(0, 0, PW, 58, 'F')

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('QA COMPARISON REPORT', M, 16)

  doc.setFontSize(24)
  doc.text(sanitize(task?.name || 'QA Task'), M, 32)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(sanitize(website?.name || ''), M, 42)
  doc.setFontSize(8.5)
  doc.text(sanitize(`${client?.name ? client.name + '  .  ' : ''}Generated ${new Date().toLocaleString()}`), M, 50)

  // Verdict badge (top right)
  doc.setFillColor(...WHITE)
  doc.roundedRect(PW - M - 26, 10, 26, 14, 3, 3, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...(isClean ? GREEN : RED))
  doc.text(verdict, PW - M - 13, 20, { align: 'center' })
  doc.setFontSize(7)
  doc.setTextColor(isClean ? [6, 95, 70] : [185, 28, 28])
  doc.text(isClean ? 'No issues found' : 'Issues detected', PW - M - 13, 24, { align: 'center' })

  let y = 68

  // ── Baseline vs Rerun comparison grid ───────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text('Run Comparison', M, y)
  y += 6

  const halfW = (CW - 6) / 2

  // Baseline box
  doc.setFillColor(245, 243, 255)
  doc.roundedRect(M, y, halfW, 38, 3, 3, 'F')
  doc.setFillColor(147, 51, 234)
  doc.roundedRect(M, y, halfW, 7, 3, 3, 'F')
  doc.rect(M, y + 4, halfW, 3, 'F')
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('BASELINE', M + halfW / 2, y + 5, { align: 'center' })
  doc.setTextColor(88, 28, 135)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(sanitize(new Date(baselineRun.created_at).toLocaleString()), M + 3, y + 13)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...BLACK)
  doc.text(String(baselineRun.pages.length), M + 3, y + 23)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('pages crawled', M + 3, y + 27)
  const baseErrors = baselineRun.pages.reduce((n, p) => n + p.console_errors.length, 0)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(baseErrors > 0 ? RED[0] : GREEN[0], baseErrors > 0 ? RED[1] : GREEN[1], baseErrors > 0 ? RED[2] : GREEN[2])
  doc.text(String(baseErrors), M + halfW / 2 + 5, y + 23)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('console errors', M + halfW / 2 + 5, y + 27)

  // Rerun box
  const rx = M + halfW + 6
  doc.setFillColor(236, 254, 255)
  doc.roundedRect(rx, y, halfW, 38, 3, 3, 'F')
  doc.setFillColor(8, 145, 178)
  doc.roundedRect(rx, y, halfW, 7, 3, 3, 'F')
  doc.rect(rx, y + 4, halfW, 3, 'F')
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('RERUN', rx + halfW / 2, y + 5, { align: 'center' })
  doc.setTextColor(14, 116, 144)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text(sanitize(new Date(rerunRun.created_at).toLocaleString()), rx + 3, y + 13)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...BLACK)
  doc.text(String(rerunRun.pages.length), rx + 3, y + 23)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('pages crawled', rx + 3, y + 27)
  const rerunErrors = rerunRun.pages.reduce((n, p) => n + p.console_errors.length, 0)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(rerunErrors > 0 ? RED[0] : GREEN[0], rerunErrors > 0 ? RED[1] : GREEN[1], rerunErrors > 0 ? RED[2] : GREEN[2])
  doc.text(String(rerunErrors), rx + halfW / 2 + 5, y + 23)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('console errors', rx + halfW / 2 + 5, y + 27)

  y += 44

  // ── Difference stats row ─────────────────────────────────────────
  const diffStats = [
    { label: 'Visual Regressions', value: String(regressions.length), alert: regressions.length > 0 },
    { label: 'New Console Errors', value: String(totalNewErrors), alert: totalNewErrors > 0 },
    { label: 'Errors Resolved', value: String(totalResolved), good: totalResolved > 0 },
  ]
  const dsW = (CW - 8) / 3
  for (let i = 0; i < diffStats.length; i++) {
    const sx = M + i * (dsW + 4)
    doc.setFillColor(...LIGHTBG)
    doc.roundedRect(sx, y, dsW, 18, 2, 2, 'F')
    const valClr = diffStats[i].alert ? RED : diffStats[i].good ? GREEN : GRAY
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(...valClr)
    doc.text(diffStats[i].value, sx + dsW / 2, y + 11, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(diffStats[i].label, sx + dsW / 2, y + 16, { align: 'center' })
  }
  y += 24

  // ── AI Final Summary ─────────────────────────────────────────────
  if (aiSummary) {
    doc.setFillColor(238, 242, 255)
    const lines = splitText(doc, aiSummary, CW - 8)
    const bH = lines.length * 4.5 + 12
    if (y + bH > PH - M) y = newPage()
    doc.roundedRect(M, y, CW, bH, 3, 3, 'F')
    doc.setFillColor(...INDIGO)
    doc.roundedRect(M, y, CW, 8, 3, 3, 'F')
    doc.rect(M, y + 5, CW, 3, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('AI Final QA Summary', M + 4, y + 5.5)
    doc.setTextColor(67, 56, 202)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(lines, M + 4, y + 13)
    y += bH + 8
  } else {
    doc.setFillColor(238, 242, 255)
    doc.roundedRect(M, y, CW, 10, 2, 2, 'F')
    doc.setFontSize(8)
    doc.setTextColor(107, 114, 128)
    doc.text('Generate AI Summary in the Reports page and re-download for a detailed AI analysis.', M + 4, y + 6.5)
    y += 15
  }

  // ── Visual Regressions section ───────────────────────────────────
  if (regressions.length > 0) {
    y = newPage()

    doc.setFillColor(...AMBER)
    doc.rect(0, 0, PW, 14, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(sanitize(`Visual Regressions  (${regressions.length} page${regressions.length !== 1 ? 's' : ''})`), M, 10)
    y = 22

    for (let ri = 0; ri < regressions.length; ri++) {
      const p = regressions[ri]

      if (y > PH - 60) y = newPage()

      // Regression page header
      const diffClr = p.diff_score < 0.01 ? GREEN : p.diff_score < 0.05 ? AMBER : RED
      doc.setFillColor(...LIGHTBG)
      doc.rect(M, y, CW, 10, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...BLACK)
      doc.text(sanitize(`${ri + 1}. ${(p.label || p.url).slice(0, 65)}`), M + 3, y + 6.5)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...diffClr)
      doc.text(sanitize(`${(p.diff_score * 100).toFixed(2)}%`), PW - M - 3, y + 6.5, { align: 'right' })
      y += 12

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...GRAY)
      doc.text(sanitize(p.url), M + 3, y)
      if (p.pixel_changed != null) doc.text(sanitize(`${p.pixel_changed.toLocaleString()} / ${p.pixel_total?.toLocaleString()} pixels changed`), PW - M - 3, y, { align: 'right' })
      y += 5

      // 3-column: Baseline | Current | Pixel Diff
      const colW = (CW - 8) / 3
      const labels = ['Baseline', 'Current (Rerun)', 'Pixel Diff']
      const imgSrcs = [p.diff_image_url, p.screenshot_url, p.pixel_diff_url]

      let maxH = 0
      const imgResults = await Promise.all(imgSrcs.map((src) => compressToJpeg(src, 700)))

      for (let ci = 0; ci < 3; ci++) {
        const x = M + ci * (colW + 4)
        doc.setFontSize(7)
        doc.setTextColor(ci === 2 ? RED[0] : GRAY[0], ci === 2 ? RED[1] : GRAY[1], ci === 2 ? RED[2] : GRAY[2])
        doc.text(labels[ci], x, y)

        if (imgResults[ci]) {
          const h = addImg(doc, imgResults[ci], x, y + 3, colW, 65)
          maxH = Math.max(maxH, h)
        }
      }
      y += maxH + 10
    }
  }

  // ── Console Error Changes section ────────────────────────────────
  if (newErrorPages.length > 0 || resolvedErrorPages.length > 0) {
    y = newPage()

    doc.setFillColor(...RED)
    doc.rect(0, 0, PW, 14, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text('Console Error Changes', M, 10)
    y = 22

    if (newErrorPages.length > 0) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...RED)
      doc.text(sanitize(`New Errors Introduced  (${totalNewErrors})`), M, y)
      y += 6

      for (const ep of newErrorPages) {
        if (y > PH - 25) y = newPage()
        doc.setFillColor(254, 242, 242)
        const errorLines = ep.errors.flatMap((e) => splitText(doc, `• ${sanitize(e)}`, CW - 12))
        const bH = errorLines.length * 4 + 10
        doc.roundedRect(M, y, CW, bH, 2, 2, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(185, 28, 28)
        doc.text(sanitize(ep.label || ep.url), M + 4, y + 6)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.text(errorLines, M + 4, y + 11)
        y += bH + 4
      }
      y += 4
    }

    if (resolvedErrorPages.length > 0) {
      if (y > PH - 30) y = newPage()
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...GREEN)
      doc.text(sanitize(`Errors Resolved  (${totalResolved})`), M, y)
      y += 6

      for (const ep of resolvedErrorPages) {
        if (y > PH - 20) y = newPage()
        doc.setFillColor(240, 253, 244)
        const errorLines = ep.errors.flatMap((e) => splitText(doc, `• ${sanitize(e)}`, CW - 12))
        const bH = errorLines.length * 4 + 10
        doc.roundedRect(M, y, CW, bH, 2, 2, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(6, 95, 70)
        doc.text(sanitize(ep.label || ep.url), M + 4, y + 6)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.text(errorLines, M + 4, y + 11)
        y += bH + 4
      }
    }
  }

  // ── Footer ───────────────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages()
  const footerLeft = sanitize(`${task?.name || 'QA Report'}  .  ${website?.name || ''}  .  ${new Date().toLocaleDateString()}`)
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFillColor(...LIGHTBG)
    doc.rect(0, PH - 8, PW, 8, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...GRAY)
    doc.text(footerLeft, M, PH - 3)
    doc.text(sanitize(`Page ${i} of ${totalPages}`), PW - M, PH - 3, { align: 'right' })
  }

  return doc
}

