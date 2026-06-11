import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseDatePage, matchesTimeRule } from './lib/parse.mjs';

const STATE_FILE = '.state.json';
const SESSION_FILE = 'session.json';
const CRITERIA_FILE = 'criteria.json';

const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_URL = process.env.NTFY_URL || 'https://ntfy.sh';
const SESSION_COOKIE_ENV = process.env.NEARCUT_SESSION;

const criteria = JSON.parse(readFileSync(CRITERIA_FILE, 'utf8'));
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { notified: [] };

function getSessionCookie() {
  if (SESSION_COOKIE_ENV) return SESSION_COOKIE_ENV;
  if (!existsSync(SESSION_FILE)) {
    throw new Error(`No session. Run \`node login.mjs\` first, or set NEARCUT_SESSION env var.`);
  }
  const storage = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  const c = storage.cookies.find(c => c.name === '_nearcut_session');
  if (!c) throw new Error('session.json has no _nearcut_session cookie');
  return c.value;
}

function* dateRange(from, to) {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield d.toISOString().slice(0, 10);
  }
}

async function fetchDatePage({ shop, date, cookie }) {
  const url = `https://www.fusebarbersandco.co.uk/book/shops/${shop}/date/${date}?service_options%5B%5D=${criteria.service}`;
  const res = await fetch(url, {
    redirect: 'manual',
    headers: {
      'Cookie': `_nearcut_session=${cookie}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (res.status === 302 || res.status === 301) {
    const loc = res.headers.get('location') || '';
    if (loc.includes('/users/sign_in')) {
      throw new Error('SESSION_EXPIRED');
    }
    throw new Error(`Unexpected redirect to ${loc}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function ntfyPush(title, body, clickUrl) {
  if (!NTFY_TOPIC) { console.log(`[no NTFY_TOPIC set]  ${title} — ${body}`); return; }
  await fetch(`${NTFY_URL}/${NTFY_TOPIC}`, {
    method: 'POST',
    headers: {
      'Title': title,
      'Priority': 'high',
      'Tags': 'scissors',
      ...(clickUrl ? { 'Click': clickUrl } : {}),
    },
    body,
  });
}

const cookie = getSessionCookie();
const dates = [...dateRange(criteria.targetWindow.from, criteria.targetWindow.to)];
const today = new Date().toISOString().slice(0, 10);
const activeDates = dates.filter(d => d >= today);

if (activeDates.length === 0) {
  console.log(`No active dates (window ${criteria.targetWindow.from}..${criteria.targetWindow.to} is in the past). Idle.`);
  process.exit(0);
}

const seen = new Set(state.notified);
const newMatches = [];
let sessionExpired = false;

for (const shop of criteria.shops) {
  for (const date of activeDates) {
    let html;
    try {
      html = await fetchDatePage({ shop, date, cookie });
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') { sessionExpired = true; break; }
      if (e.message.startsWith('HTTP 404')) {
        console.log(`  ${shop} ${date}  not published yet (404)`);
        continue;
      }
      console.error(`  ${shop} ${date} fetch failed: ${e.message}`);
      continue;
    }
    const parsed = parseDatePage(html, { date, shop });
    if (parsed.unavailable) {
      console.log(`  ${shop} ${date}  shop unavailable (closed)`);
      continue;
    }
    const otherBarbers = parsed.barbers.map(b => b.name).filter(n => n.toLowerCase() !== criteria.barberName.toLowerCase());
    const reece = parsed.barbers.find(b => b.name.toLowerCase() === criteria.barberName.toLowerCase());
    if (!reece) {
      const ctx = otherBarbers.length ? `working today: ${otherBarbers.join(', ')}` : 'no barbers on rota';
      console.log(`  ${shop} ${date}  ${criteria.barberName} not on rota (${ctx})`);
      continue;
    }
    if (reece.notice) {
      console.log(`  ${shop} ${date}  Reece notice: "${reece.notice}"`);
    }
    const matching = reece.slots.filter(s => matchesTimeRule(s.time, date, criteria.timeRules));
    console.log(`  ${shop} ${date}  Reece slots=${reece.slots.length}  matching=${matching.length}`);
    for (const slot of matching) {
      const key = `${shop}|${date}|${slot.time}`;
      if (seen.has(key)) continue;
      newMatches.push({ key, shop, date, time: slot.time, href: slot.href });
    }
  }
  if (sessionExpired) break;
}

if (sessionExpired) {
  console.error('\n!! Session expired. Re-run `node login.mjs` and update the NEARCUT_SESSION secret.');
  await ntfyPush('Fuse bot: session expired', 'Re-run login.mjs and update the GitHub secret.');
  process.exit(2);
}

if (newMatches.length === 0) {
  console.log('\nNo new matching slots.');
  process.exit(0);
}

console.log(`\n→ ${newMatches.length} new slot(s):`);
for (const m of newMatches) console.log(`  ${m.shop}  ${m.date}  ${m.time}`);

const title = `Reece slot${newMatches.length > 1 ? 's' : ''} open`;
const lines = newMatches.map(m => `${m.date} ${m.time} (${m.shop})`).join('\n');
await ntfyPush(title, lines, newMatches[0].href || undefined);

for (const m of newMatches) seen.add(m.key);
writeFileSync(STATE_FILE, JSON.stringify({ notified: [...seen] }, null, 2));
console.log('\nState updated. Notification sent.');
