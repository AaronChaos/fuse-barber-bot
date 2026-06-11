import * as cheerio from 'cheerio';

export function parseDatePage(html, { date, shop }) {
  const $ = cheerio.load(html);
  const barbers = [];
  const unavailable = $('#calendar-data > h2.text-center').text().trim().toLowerCase() === 'unavailable';

  $('#calendar-data > [id^="collapse-top-"]').each((_, panel) => {
    const $panel = $(panel);
    const id = $panel.attr('id').replace('collapse-top-', '');
    const name = $panel.find('h2.barber-booking-header').text().replace(/\s+/g, ' ').trim();
    const noticeText = $panel.find('.well .title').text().trim();
    const slots = [];

    $panel.find('.daytimecolumn.time-available a.day-time').each((_, a) => {
      const $a = $(a);
      const time = $a.find('span').text().trim();
      const href = $a.attr('href');
      const slugMatch = href && href.match(/\/barbers\/([A-Z0-9]+)\//);
      slots.push({
        time,
        href: href ? `https://www.fusebarbersandco.co.uk${href}` : null,
        barberSlug: slugMatch ? slugMatch[1] : null,
      });
    });

    barbers.push({ id, name, notice: noticeText || null, slots });
  });

  return { date, shop, barbers, unavailable };
}

const TIME_RE = /^\d{2}:\d{2}$/;
export function matchesTimeRule(timeStr, dateStr, rules) {
  if (!TIME_RE.test(timeStr)) return false;
  const [h, m] = timeStr.split(':').map(Number);
  const minutes = h * 60 + m;
  const dow = new Date(`${dateStr}T12:00:00`).getUTCDay();
  const rule = rules[String(dow)];
  if (!rule || rule.skip) return false;
  if (rule.afterMinutes !== undefined && minutes < rule.afterMinutes) return false;
  if (rule.beforeMinutes !== undefined && minutes > rule.beforeMinutes) return false;
  return true;
}
