// End-to-end smoke test of the built app in a real browser (Playwright + Chromium).
//
//   npm run build && npx vite preview --port 4173 &
//   npm run test:e2e                      # or: node scripts/e2e.mjs http://localhost:4173/
//
// Checks: data loads from Zarr, the slice/HUD react to the keyboard, analysis modes switch,
// the 2-point connectivity resolves, the LT demo advances, and no page errors are thrown.
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? process.env.E2E_URL ?? 'http://localhost:4173/'
const shots = process.env.E2E_SHOTS ?? 'test-results'
mkdirSync(shots, { recursive: true })

const launch = async () => {
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  try {
    return await chromium.launch({ args })
  } catch (e) {
    // pre-installed browser in some CI/cloud images
    for (const p of ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', process.env.CHROMIUM_PATH]) {
      if (p && existsSync(p)) return chromium.launch({ args, executablePath: p })
    }
    throw e
  }
}

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().includes('/data/')) errors.push(`HTTP ${r.status()} ${r.url()}`)
})

let failed = 0
const check = async (name, fn) => {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✗ ${name}\n    ${String(e).split('\n')[0]}`)
    await page.screenshot({ path: `${shots}/fail-${name.replace(/\W+/g, '_')}.png` })
  }
}
const hud = () => page.locator('.elev-hud .v').innerText()

console.log(`E2E: ${base}`)
await page.goto(`${base}?demo`)

await check('atlas loads (HUD + all Zarr levels)', async () => {
  await page.locator('.elev-hud').waitFor({ timeout: 30000 })
  await page.waitForFunction(() => {
    const t = document.querySelector('.chunk-chip')?.textContent ?? ''
    const m = t.match(/(\d+)\/(\d+)/)
    return m && m[1] === m[2]
  }, null, { timeout: 30000 })
})

await check('real PLATEAU data badge', async () => {
  await page.locator('.badge.real').waitFor({ timeout: 5000 })
})

await check('keyboard moves the slice by one level (3 m)', async () => {
  const before = parseFloat(await hud())
  await page.locator('.cesium-host').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.keyboard.press('ArrowUp')
  await page.waitForTimeout(300)
  const after = parseFloat(await hud())
  if (!(after > before)) throw new Error(`elevation did not increase: ${before} -> ${after}`)
})

await check('occupancy metric is a percentage', async () => {
  const v = await page.locator('.metric .v').first().innerText()
  const n = parseFloat(v)
  if (!(n >= 0 && n <= 100)) throw new Error(`bad occupancy: ${v}`)
})

await check('analysis modes switch the legend', async () => {
  await page.click('.seg.full button:has-text("連結")')
  await page.locator('.legend:has-text("連結領域")').waitFor({ timeout: 3000 })
  await page.click('.seg.full button:has-text("離隔")')
  await page.locator('.legend:has-text("離隔距離")').waitFor({ timeout: 3000 })
})

await check('profile charts render', async () => {
  await page.locator('.chart .recharts-surface').first().waitFor({ timeout: 15000 })
})

await check('2-point connectivity resolves', async () => {
  await page.click('.tabs button:has-text("2地点")')
  await page.click('button:has-text("例：")')
  await page.locator('.result .big').waitFor({ timeout: 20000 })
  const t = await page.locator('.result .big').innerText()
  if (!/T\.P\.|つながりません/.test(t)) throw new Error(`unexpected result: ${t}`)
})

await check('LT demo advances', async () => {
  await page.click('button:has-text("LTデモ")')
  await page.locator('.demo-bar').waitFor({ timeout: 5000 })
  await page.keyboard.press('ArrowRight')
  await page.locator('.demo-count:has-text("2 /")').waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')
})

await check('synthetic dataset is labelled', async () => {
  await page.goto(`${base}?demo&area=synthetic`)
  await page.locator('.badge.warn').first().waitFor({ timeout: 30000 })
})

await page.screenshot({ path: `${shots}/e2e-final.png` })
await browser.close()

if (errors.length) {
  failed++
  console.log('  ✗ page errors:\n    ' + errors.slice(0, 10).join('\n    '))
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
