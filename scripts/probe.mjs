// Evaluates an arbitrary expression in the app page and prints the result.
import { launch, DEFAULT_URL } from './lib/cdp.mjs'

const expr = process.argv[2]
if (!expr) {
  console.error("usage: npm run probe '<js expression>'")
  process.exit(64)
}

const page = await launch({ port: 9334, url: DEFAULT_URL, wait: Number(process.argv[3] ?? 8000) })
const value = await page.evalJs(expr, { awaitPromise: true })
console.log(JSON.stringify(value ?? null, null, 2))
await page.close(0)
