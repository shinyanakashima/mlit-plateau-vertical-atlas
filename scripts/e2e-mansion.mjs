// End-to-end check of the LT11 prototype "東京は何階建て？" (lt11-mansion branch).
//   npm run build && npx vite preview --port 4173 &
//   node scripts/e2e-mansion.mjs http://localhost:4173/
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? process.env.E2E_URL ?? 'http://localhost:4173/'
const shots = process.env.E2E_SHOTS ?? 'test-results'
mkdirSync(shots, { recursive: true })
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
let browser
try { browser = await chromium.launch({ args }) } catch (e) {
  const p = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', process.env.CHROMIUM_PATH].find((x) => x && existsSync(x))
  if (!p) throw e
  browser = await chromium.launch({ args, executablePath: p })
}
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && /Rendering has stopped|failed/.test(m.text())) errors.push(m.text().slice(0, 300)) })
page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/data/')) errors.push(`HTTP ${r.status()} ${r.url()}`) })

let failed = 0
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`) } catch (e) {
    failed++
    console.log(`  ✗ ${name}\n    ${String(e).split('\n')[0]}`)
    await page.screenshot({ path: `${shots}/fail-${name.replace(/\W+/g, '_')}.png` })
  }
}
const vac = async (i) => parseFloat(await page.locator('.mn-vacancy .v').nth(i).innerText())

console.log(`E2E mansion: ${base}`)
await page.goto(`${base}?floor=8`)

await check('both areas load and the floor guide fills (all Zarr levels)', async () => {
  await page.locator('.mn-plan').nth(1).waitFor({ timeout: 30000 })
  await page.locator('.mn-dir-loading').waitFor({ state: 'detached', timeout: 45000 })
})
await check('8F: Tama is underground (vacancy 0%), Minato mostly vacant', async () => {
  await page.waitForFunction(() => document.querySelectorAll('.mn-vacancy .v').length === 2 && !document.querySelector('.mn-vacancy .v')?.textContent?.includes('—'), null, { timeout: 20000 })
  const l = await vac(0)
  const r = await vac(1)
  if (!(r === 0 && l > 80)) throw new Error(`unexpected vacancy L=${l} R=${r}`)
  await page.locator('.mn-story.ground').waitFor({ timeout: 5000 })
})
await check('elevator ▲ goes to 9F and the ground floor of Tama appears', async () => {
  await page.click('button[aria-label="1つ上の階へ"]')
  await page.locator('.mn-elev-floor:has-text("9F")').waitFor({ timeout: 5000 })
  await page.waitForFunction(() => parseFloat(document.querySelectorAll('.mn-vacancy .v')[1]?.textContent ?? '0') > 0, null, { timeout: 10000 })
})
await check('floor directory click jumps to 1F', async () => {
  await page.click('.mn-row:has-text("1F") >> nth=-1')
  await page.locator('.mn-led:has-text("1F")').waitFor({ timeout: 5000 })
})
await check('clicking the floor plan shows the spot information', async () => {
  const c = page.locator('.mn-canvas').nth(1)
  const b = await c.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.locator('.mn-cell:not(.hint) .h').nth(0).waitFor({ timeout: 5000 })
})
await check('LT demo advances with the keyboard', async () => {
  await page.click('button:has-text("LTデモ")')
  await page.locator('.mn-demo').waitFor({ timeout: 5000 })
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.locator('.mn-led:has-text("8F")').waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')
})
await check('sound button cycles なし → チャイム → アナウンス', async () => {
  const b = page.locator('button:has-text("音：")')
  const seen = new Set()
  for (let i = 0; i < 3; i++) { seen.add((await b.innerText()).trim()); await b.click() }
  for (const t of ['音：なし', '音：チャイム', '音：アナウンス']) if (!seen.has(t)) throw new Error(`missing state ${t}: ${[...seen]}`)
})
await check('definitions dialog states it is not a real vacancy rate', async () => {
  await page.click('button:has-text("物件概要")')
  await page.locator('.mn-about:has-text("実際の住宅の空室率ではありません")').waitFor({ timeout: 5000 })
  await page.keyboard.press('Escape')
})
await check('Vertical Atlas is still available (?app=atlas)', async () => {
  await page.goto(`${base}?app=atlas&demo`)
  await page.locator('.elev-hud').waitFor({ timeout: 30000 })
})

await page.screenshot({ path: `${shots}/e2e-mansion-final.png` })
await browser.close()
if (errors.length) { failed++; console.log('  ✗ page errors:\n    ' + errors.slice(0, 10).join('\n    ')) }
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
