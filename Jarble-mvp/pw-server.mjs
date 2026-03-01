import { chromium } from '@playwright/test';
import http from 'http';

const browser = await chromium.launch({
  headless: false,
  channel: 'chrome',
  args: [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
  ],
  ignoreDefaultArgs: ['--enable-automation'],
});
const context = await browser.newContext({
  viewport: null,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
});
const page = await context.newPage();
await page.goto('http://localhost:3000');

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { action, args } = JSON.parse(body);
      let result;
      switch (action) {
        case 'goto': result = await page.goto(args.url, { waitUntil: 'networkidle', timeout: 30000 }); result = page.url(); break;
        case 'url': result = page.url(); break;
        case 'title': result = await page.title(); break;
        case 'screenshot': await page.screenshot({ path: args.path || 'pw-screenshot.png', fullPage: args.fullPage || false }); result = args.path || 'pw-screenshot.png'; break;
        case 'click': await page.click(args.selector, { timeout: 10000 }); result = 'clicked'; break;
        case 'fill': await page.fill(args.selector, args.value, { timeout: 10000 }); result = 'filled'; break;
        case 'type': await page.type(args.selector, args.value, { timeout: 10000 }); result = 'typed'; break;
        case 'text': result = await page.textContent(args.selector, { timeout: 10000 }); break;
        case 'innerHTML': result = await page.innerHTML(args.selector, { timeout: 10000 }); break;
        case 'eval': result = await page.evaluate(args.code); break;
        case 'wait': await page.waitForSelector(args.selector, { timeout: args.timeout || 10000 }); result = 'found'; break;
        case 'waitForURL': await page.waitForURL(args.pattern, { timeout: args.timeout || 30000 }); result = page.url(); break;
        case 'count': result = await page.locator(args.selector).count(); break;
        case 'allText': result = await page.locator(args.selector).allTextContents(); break;
        case 'press': await page.press(args.selector || 'body', args.key); result = 'pressed'; break;
        case 'selectAll': {
          const els = await page.locator(args.selector).all();
          result = [];
          for (const el of els) {
            result.push({ text: await el.textContent(), visible: await el.isVisible() });
          }
          break;
        }
        case 'close': await browser.close(); server.close(); process.exit(0); break;
        default: result = 'unknown action';
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});

server.listen(9222, () => console.log('PW_READY on :9222'));
