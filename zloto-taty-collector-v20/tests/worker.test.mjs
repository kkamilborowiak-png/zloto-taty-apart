import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../zloto-taty-v20-deploy/_worker.js';

function dateKeyInPoland() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`;
}

function harness() {
  const kv = new Map();
  globalThis.caches = { default: { match: async()=>null, put: async()=>{} } };
  const env = {
    ADMIN_TOKEN: 'test-secret',
    PRICES_KV: {
      get: async(key) => kv.get(key) ? JSON.parse(kv.get(key)) : null,
      put: async(key, value) => kv.set(key, value),
    },
  };
  return { env, kv };
}

const quote = () => ({
  sourceUpdatedAt: dateKeyInPoland(),
  products: { cHafner1oz: 15735, cHafner25g: 12431 },
});

test('endpoint kolektora autoryzuje i udostępnia najnowszy odczyt obu telefonom', async () => {
  const { env } = harness();
  const url = 'https://example.pages.dev/api/collector-prices';
  const withoutToken = await worker.fetch(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quote()),
  }),env);
  assert.equal(withoutToken.status,401);

  const published = await worker.fetch(new Request(url, {
    method: 'POST', headers: { 'Content-Type':'application/json', 'X-Admin-Token':'test-secret' }, body: JSON.stringify(quote()),
  }),env);
  assert.equal(published.status,200,await published.text());

  for (const phone of ['iphone', 'desktop']) {
    const res = await worker.fetch(new Request(`https://example.pages.dev/api/prices?refresh=${phone}`),env);
    const data = await res.json();
    assert.equal(res.status,200);
    assert.equal(data.provider,'github-collector-apart');
    assert.equal(data.stale,false);
    assert.equal(data.products.cHafner1oz,15735);
  }

  const health = await worker.fetch(new Request('https://example.pages.dev/api/feed-status'),env);
  assert.equal((await health.json()).collector.found,true);
});
