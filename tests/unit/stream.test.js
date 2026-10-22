import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const { handleStream, proxyPlaylist } = await import('../../src/lib/server/stream/proxy.js');
const { _setAllowPrivate } = await import('../../src/lib/server/net.js');

const call = (params) => handleStream(new URLSearchParams(params));

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\nhls/index.m3u8\n';
const MEDIA = [
  '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6',
  '#EXT-X-KEY:METHOD=AES-128,URI="key.key",IV=0x00000000000000000000000000000001',
  '#EXTINF:4.166667,', 'a0.ts',
  '#EXTINF:4.166667,', '/abs/a1.ts',
  ...Array.from({ length: 30 }, (_, i) => ['#EXTINF:4.166667,', `b${i}.ts`]).flat(),
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:5,', '/video/adjump/x.ts',
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:4.166667,', 'https://cdn.example.org/a2.ts',
  '#EXT-X-ENDLIST', '',
].join('\n');
const KEY = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255, 128, 129, 130, 0xc3, 0x28, 0x0a]);

let srv; let base;
before(async () => {
  srv = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/v/index.m3u8') return res.end(MASTER);
    if (p === '/v/hls/index.m3u8') return res.end(MEDIA);
    if (p === '/v/hls/key.key') { res.setHeader('content-type', 'application/octet-stream'); return res.end(KEY); }
    if (p === '/redir.m3u8') { res.statusCode = 302; res.setHeader('location', '/v/hls/index.m3u8'); return res.end(); }
    if (p === '/html.m3u8') return res.end('<html>blocked</html>');
    if (p === '/bigkey') return res.end(Buffer.alloc(200 * 1024));
    res.statusCode = 500; res.end('boom');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { _setAllowPrivate(false); srv.closeAllConnections?.(); srv.close(); });

for (const u of ['http://127.0.0.1/x.m3u8', 'http://192.168.1.1/x', `http://${['100', '100', '1', '1'].join('.')}/x`, 'http://[::ffff:10.0.0.1]/x', 'http://localhost/x.m3u8']) {
  test(`内网地址 403：${u}`, async () => {
    _setAllowPrivate(false);
    const r = await call({ u });
    assert.equal(r.status, 403);
  });
}

test('密钥地址也做内网拦截', async () => {
  _setAllowPrivate(false);
  assert.equal((await call({ u: 'http://10.1.2.3/k.key', kind: 'key' })).status, 403);
});

test('缺 u / 非 http 地址 -> 400 / 403', async () => {
  _setAllowPrivate(false);
  assert.equal((await call({})).status, 400);
  assert.ok([400, 403].includes((await call({ u: 'file:///etc/passwd' })).status));
});

test('master：子 playlist 改写成 /api/stream?u=<绝对地址>', async () => {
  _setAllowPrivate(true);
  const r = await call({ u: `${base}/v/index.m3u8` });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.apple.mpegurl');
  assert.equal(r.headers.get('x-ads-removed'), '0');
  const text = await r.text();
  const child = text.split('\n').find((l) => l && !l.startsWith('#'));
  assert.equal(child, `/api/stream?u=${encodeURIComponent(`${base}/v/hls/index.m3u8`)}`);
});

test('media：去广告、相对分片转绝对、KEY 走代理、X-Ads-Removed', async () => {
  _setAllowPrivate(true);
  const r = await call({ u: `${base}/v/hls/index.m3u8` });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-ads-removed'), '1');
  const text = await r.text();
  const ls = text.split('\n');
  assert.ok(ls.includes(`${base}/v/hls/a0.ts`));
  assert.ok(ls.includes(`${base}/abs/a1.ts`));
  assert.ok(ls.includes('https://cdn.example.org/a2.ts'));
  assert.ok(!/adjump/.test(text));
  const keyLine = ls.find((l) => l.startsWith('#EXT-X-KEY'));
  assert.equal(keyLine, `#EXT-X-KEY:METHOD=AES-128,URI="/api/stream?u=${encodeURIComponent(`${base}/v/hls/key.key`)}&kind=key",IV=0x00000000000000000000000000000001`);
  assert.equal(ls.filter((l) => l === '#EXT-X-DISCONTINUITY').length, 1);
});

test('proxyPlaylist 返回改写后的文本；重定向后以最终地址为基准', async () => {
  _setAllowPrivate(true);
  const text = await proxyPlaylist(`${base}/redir.m3u8`);
  assert.ok(text.split('\n').includes(`${base}/v/hls/a0.ts`));
});

test('密钥：二进制原样返回', async () => {
  _setAllowPrivate(true);
  const r = await call({ u: `${base}/v/hls/key.key`, kind: 'key' });
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), KEY);
});

test('密钥过大 -> 502', async () => {
  _setAllowPrivate(true);
  assert.equal((await call({ u: `${base}/bigkey`, kind: 'key' })).status, 502);
});

test('上游失败 / 不是 m3u8 -> 502', async () => {
  _setAllowPrivate(true);
  assert.equal((await call({ u: `${base}/nope.m3u8` })).status, 502);
  assert.equal((await call({ u: `${base}/html.m3u8` })).status, 502);
});
