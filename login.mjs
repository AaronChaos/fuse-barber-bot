import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import readline from 'node:readline';

const SHOP = 'CTHP44';
const SERVICE = '6X0JOL';
const TODAY = new Date().toISOString().slice(0, 10);
const TARGET_URL = `https://www.fusebarbersandco.co.uk/book/shops/${SHOP}/date/${TODAY}?service_options%5B%5D=${SERVICE}`;
const OUT = 'session.json';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();

console.log(`\n→ Opening: ${TARGET_URL}`);
console.log('   (you should be redirected to /users/sign_in)\n');
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

console.log('────────────────────────────────────────────────────────────');
console.log('Log in in the browser window.');
console.log('Once you see the booking calendar (or any signed-in page),');
console.log('come back here and press Enter to save the session.');
console.log('────────────────────────────────────────────────────────────\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await new Promise((resolve) => rl.question('', () => { rl.close(); resolve(); }));

await ctx.storageState({ path: OUT });
const cookies = (await ctx.cookies()).filter(c => c.name === '_nearcut_session');
if (cookies.length === 0) {
  console.log('\n!! No _nearcut_session cookie found. Did you finish logging in?');
} else {
  const c = cookies[0];
  const expires = c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session-only';
  console.log(`\n✓ Saved → ${OUT}`);
  console.log(`  cookie expires: ${expires}`);
}

await browser.close();
