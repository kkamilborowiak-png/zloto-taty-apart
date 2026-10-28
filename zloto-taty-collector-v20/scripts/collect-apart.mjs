import { pathToFileURL } from 'node:url';

const SOURCE_URL = 'https://mennica.apart.pl/skup';
const TARGET_URL = process.env.GOLD_API_URL || 'https://tata-zloto.pages.dev/api/collector-prices';

function plainText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/\r/g, '\n');
}

function parsePrice(raw) {
  const normalized = raw.replace(/[\s\u00a0]/g, '').replace(/(\d)\.(?=\d{3}(?:[.,]|$))/g, '$1').replace(',', '.');
  const price = Number(normalized);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Błędny zapis ceny: ${raw}`);
  return price;
}

export function parseApartPrices(input) {
  const text = /<\s*(?:html|body|table|tr)\b/i.test(input) ? plainText(input) : input;
  const timeMatch = text.match(/Data\s+aktualizacji\s+kursu\s*:\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/i);
  if (!timeMatch) throw new Error('Brak daty kursu Mennicy Apart');
  const sourceUpdatedAt = `${timeMatch[1]}T${timeMatch[2].padStart(5, '0')}:00`;

  // Szukamy wyłącznie w sekcji skupu, NIE w produktach polecanych
  // (tam są ceny sprzedaży, nie skupu).
  const tableAt = text.search(/Tabela\s+cen\s+skupu/i);
  if (tableAt < 0) throw new Error('Brak sekcji Tabela cen skupu');
  const afterHeader = text.slice(tableAt);
  const barsAt = afterHeader.search(/(?:^|\n)\s*ZŁOTE\s+SZTABKI\s*(?:\n|$)/im);
  if (barsAt < 0) throw new Error('Brak sekcji ZŁOTE SZTABKI w tabeli skupu');
  const bars = afterHeader.slice(barsAt);
  const silverAt = bars.search(/(?:^|\n)\s*SREBRNE\s+SZTABKI\s*(?:\n|$)/im);
  const scoped = silverAt >= 0 ? bars.slice(0, silverAt) : bars;

  const find = (label, min, max) => {
    // Markdown: Nazwa | Cena, HTML innerText: Nazwa \t Cena lub nowa linia.
    // Po "1 oz" musi od razu następować cena; nie pasuje "1 oz - odlewana".
    const pattern = new RegExp(`(?:^|\\n)\\s*C-Hafner\\s+Sztabka\\s+${label}\\s*(?:\\|\\s*)?([0-9][0-9\\s.,]{1,16})\\s*(?:zł|PLN)`, 'im');
    const match = scoped.match(pattern);
    if (!match) throw new Error(`Brak ceny skupu C-Hafner ${label}`);
    const amount = parsePrice(match[1]);
    if (amount < min || amount > max) throw new Error(`Niewiarygodna cena skupu ${label}: ${amount}`);
    return amount;
  };
  const cHafner1oz = find('1\\s*oz', 5000, 100000);
  const cHafner25g = find('25\\s*g', 4000, 100000);
  const ratio = cHafner25g / cHafner1oz;
  if (ratio < 0.68 || ratio > 0.90) throw new Error(`Nieprawidłowa proporcja cen skupu: ${ratio}`);
  return { sourceUpdatedAt, products: { cHafner1oz, cHafner25g } };
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithBrowser() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
    const response = await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const code = response?.status() ?? 0;
    if (code !== 200) throw new Error(`Apart: HTTP ${code} z przeglądarki Chromium`);
    await page.locator('body').waitFor({ timeout: 15000 });
    let content = await page.locator('body').innerText();
    if (!/Tabela\s+cen\s+skupu/i.test(content)) {
      await page.waitForTimeout(2500);
      content = await page.locator('body').innerText();
    }
    return parseApartPrices(content);
  } finally {
    await browser.close();
  }
}

async function fetchWithHttp() {
  const response = await fetch(SOURCE_URL, {
    headers: { 'Accept-Language': 'pl-PL,pl;q=0.9', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Apart: HTTP ${response.status} z fetch`);
  return parseApartPrices(await response.text());
}

function verifyFeedTime(quote) {
  // Porównanie w czasie polskim; nie publikujemy wyników z przyszłości.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/Warsaw', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date());
  const now = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const nowLocal = Date.UTC(+now.year, +now.month - 1, +now.day, +now.hour, +now.minute);
  const match = quote.sourceUpdatedAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00$/);
  if (!match) throw new Error('Nieprawidłowa data źródłowa');
  const source = Date.UTC(+match[1], +match[2]-1, +match[3], +match[4], +match[5]);
  const ageMin = Math.round((nowLocal-source)/60000);
  if (ageMin < -15 || ageMin > 5760) throw new Error(`Wykryto nieaktualny odczyt Apartu (${ageMin} min)`);
  return ageMin;
}

async function main() {
  if (!process.env.ADMIN_TOKEN) throw new Error('Brak sekretu ADMIN_TOKEN w GitHub Actions');
  let quote;
  try {
    quote = await fetchWithHttp();
    console.log('Sukces zwykłego HTTP.');
  } catch (error) {
    console.warn(`Zwykłe HTTP nie działa: ${describeError(error)}. Próbuję Chromium…`);
    quote = await fetchWithBrowser();
  }
  const age = verifyFeedTime(quote);
  console.log(`Cennik Apart: ${quote.sourceUpdatedAt}, 1oz ${quote.products.cHafner1oz}, 25g ${quote.products.cHafner25g}; wiek ${age} min.`);
  if (!/^https:\/\//.test(TARGET_URL)) throw new Error('GOLD_API_URL musi zaczynać się od https://');
  const response = await fetch(TARGET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': process.env.ADMIN_TOKEN },
    body: JSON.stringify(quote),
    signal: AbortSignal.timeout(15000),
  });
  const reply = await response.text();
  if (response.status === 409) {
    console.log(`Pominięto starszą wycenę: ${reply.slice(0, 350)}`);
    return;
  }
  if (!response.ok) throw new Error(`Cloudflare: HTTP ${response.status} ${reply.slice(0, 350)}`);
  console.log(`Wspólny cennik został zaktualizowany: ${reply.slice(0, 350)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(describeError(error)); process.exitCode = 1; });
}
