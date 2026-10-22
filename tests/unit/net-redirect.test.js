import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchWithTimeout, _setAllowPrivate } from '../../src/lib/server/net.js';

_setAllowPrivate(true);
after(() => _setAllowPrivate(false));

const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c).toString())); });

async function run(status, method) {
  const seen = [];
  const b = await listen(async (req, res) => {
    seen.push({ method: req.method, headers: req.headers, body: await readBody(req) });
    res.end('ok');
  });
  const a = await listen((req, res) => {
    res.writeHead(status, { location: `http://localhost:${b.address().port}/next` });
    res.end();
  });
  try {
    // A 用 127.0.0.1、B 用 localhost：host 不同即不同源
    const res = await fetchWithTimeout(`http://127.0.0.1:${a.address().port}/start`, {
      method,
      headers: { authorization: 'Bearer secret', cookie: 'k=v', 'proxy-authorization': 'x', 'content-type': 'application/json', 'x-keep': '1' },
      body: method === 'POST' ? '{"a":1}' : undefined,
    });
    assert.equal(await res.text(), 'ok');
    return seen;
  } finally { a.close(); b.close(); }
}

test('跨源重定向：不带 Authorization / Cookie / Proxy-Authorization，302 的 POST 改 GET 且无 body', async () => {
  const seen = await run(302, 'POST');
  assert.equal(seen.length, 1);
  const { method, headers, body } = seen[0];
  assert.equal(method, 'GET');
  assert.equal(body, '');
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers['proxy-authorization'], undefined);
  assert.equal(headers['content-type'], undefined);
  assert.equal(headers['x-keep'], '1');
});

test('303 一律改 GET 并丢 body', async () => {
  const seen = await run(303, 'POST');
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].body, '');
});

test('307 保留 POST 和 body，但跨源仍去凭据', async () => {
  const seen = await run(307, 'POST');
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].body, '{"a":1}');
  assert.equal(seen[0].headers.authorization, undefined);
});

test('同源重定向保留 Authorization', async () => {
  const seen = [];
  const s = await listen((req, res) => {
    seen.push(req.headers.authorization);
    if (req.url === '/a') { res.writeHead(302, { location: '/b' }); res.end(); } else res.end('ok');
  });
  try {
    await fetchWithTimeout(`http://127.0.0.1:${s.address().port}/a`, { headers: { authorization: 'Bearer secret' } });
    assert.deepEqual(seen, ['Bearer secret', 'Bearer secret']);
  } finally { s.close(); }
});
