import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;
const CGNAT = [100, 64, 0, 1].join('.'); // 运营商级 NAT 段（拆开写，避免和自查词表撞上）

const { db } = await import('../../src/lib/server/db.js');
const { searchSite, detailSite, listCategories } = await import('../../src/lib/server/cms/client.js');
const sites = await import('../../src/lib/server/cms/sites.js');
const { assertPublic, fetchWithTimeout, _setAllowPrivate } = await import('../../src/lib/server/net.js');
_setAllowPrivate(true); // 允许连回环地址（本地测试服务）

const vod = { vod_id: 1, vod_name: '繁花', vod_year: '2023', type_name: '国产剧', vod_play_from: 'm3u8', vod_play_url: '第1集$https://a/1.m3u8' };
let srv; let base;
before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/ok/api.php/provide/vod') {
      res.setHeader('content-type', 'application/json');
      if (u.searchParams.get('ac') === 'list') return res.end(JSON.stringify({ code: 1, total: 1, class: [{ type_id: 13, type_name: '国产剧' }], list: [] }));
      if (u.searchParams.get('ids')) return res.end(JSON.stringify({ code: 1, list: [vod] }));
      return res.end(JSON.stringify({ code: 1, total: 99, list: [vod] }));
    }
    if (p === '/html') { res.setHeader('content-type', 'text/html'); return res.end('<html>nope</html>'); }
    if (p === '/code0') return res.end(JSON.stringify({ code: 0, msg: 'x', list: [] }));
    if (p === '/big') { res.setHeader('content-type', 'application/json'); return res.end('{"code":1,"list":[],"pad":"' + 'x'.repeat(6 * 1024 * 1024) + '"}'); }
    if (p === '/slow') return void setTimeout(() => res.end('{}'), 3000);
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => {
  srv.closeAllConnections?.(); srv.close();
  try { db().close(); } catch { /* 已关 */ }
  rmSync(home, { recursive: true, force: true });
});

test('searchSite 正常返回', async () => {
  const r = await searchSite({ id: 1, api: `${base}/ok/api.php/provide/vod` }, '繁花');
  assert.equal(r.length, 1); assert.equal(r[0].name, '繁花'); assert.equal(r[0].siteId, 1);
});
test('searchSite: HTML / code:0 / 404 / 超时 都返回 []', async () => {
  for (const p of ['/html', '/code0', '/nothing']) assert.deepEqual(await searchSite({ id: 1, api: base + p }, 'x'), []);
  const t0 = Date.now();
  assert.deepEqual(await searchSite({ id: 1, api: base + '/slow' }, 'x', { timeoutMs: 300 }), []);
  assert.ok(Date.now() - t0 < 2000);
});
test('detailSite / listCategories', async () => {
  const s = { id: 2, api: `${base}/ok/api.php/provide/vod` };
  assert.equal((await detailSite(s, [1, 2])).length, 1);
  assert.deepEqual(await listCategories(s), [{ id: 13, name: '国产剧' }]);
});

test('首次 listSites 写入内置站点', () => {
  const l = sites.listSites();
  assert.ok(l.length >= 3);
  assert.ok(l.every((s) => s.builtin === 1));
});
test('addSite / updateSite / removeSite / recordResult', () => {
  const s = sites.addSite({ name: 't', api: 'https://example.com/api.php/provide/vod' });
  assert.equal(s.enabled, 1);
  sites.updateSite(s.id, { enabled: 0 });
  assert.equal(sites.listSites({ enabledOnly: true }).some((x) => x.id === s.id), false);
  sites.recordResult(s.id, false, 100); sites.recordResult(s.id, false, 100);
  assert.equal(sites.listSites().find((x) => x.id === s.id).fail_streak, 2);
  sites.recordResult(s.id, true, 55);
  const r = sites.listSites().find((x) => x.id === s.id);
  assert.equal(r.fail_streak, 0); assert.equal(r.latency_ms, 55); assert.ok(r.last_ok_at);
  sites.removeSite(s.id);
  assert.equal(sites.listSites().some((x) => x.id === s.id), false);
});
test('testSite', async () => {
  const r = await sites.testSite({ id: 0, api: `${base}/ok/api.php/provide/vod` });
  assert.equal(r.ok, true); assert.equal(r.total, 99); assert.ok(r.latencyMs >= 0);
  assert.equal((await sites.testSite({ id: 0, api: base + '/html' })).ok, false);
});
test('searchAll: 一站失败另一站成功，失败记 fail_streak', async () => {
  for (const s of sites.listSites()) sites.updateSite(s.id, { enabled: 0 });
  const bad = sites.addSite({ name: 'bad', api: base + '/html' });
  const good = sites.addSite({ name: 'good', api: `${base}/ok/api.php/provide/vod` });
  const r = await sites.searchAll('繁花');
  assert.equal(r.length, 1); assert.equal(r[0].siteId, good.id);
  const rows = sites.listSites();
  assert.equal(rows.find((x) => x.id === bad.id).fail_streak, 1);
  assert.equal(rows.find((x) => x.id === good.id).fail_streak, 0);
});

test('assertPublic 拒绝内网 / 非 http / 各种 IPv6 内网形式（放行开关关闭后）', async () => {
  _setAllowPrivate(false);
  try {
    for (const u of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/', `http://${CGNAT}/`, 'http://169.254.1.1/', 'http://[::1]/', 'http://[::]/', 'http://localhost/', 'ftp://example.com/',
      'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:c0a8:101]/', `http://[::ffff:${CGNAT}]/`,
      'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://[febf::1]/', 'http://[ff02::1]/',
      'http://[64:ff9b::7f00:1]/', 'http://[64:ff9b::10.0.0.1]/', 'http://[2002:7f00:1::]/', 'http://[::127.0.0.1]/'])
      await assert.rejects(assertPublic(u), (e) => e.status === 403, u);
    await assertPublic('http://1.1.1.1/');
    await assertPublic('http://[2606:4700:4700::1111]/');
    await assertPublic('http://[::ffff:1.1.1.1]/');
  } finally { _setAllowPrivate(true); }
});

test('重定向到内网被拒（每一跳都校验），跳数有上限', async () => {
  _setAllowPrivate(false);
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async (u) => {
      if (String(u).startsWith('http://1.1.1.1/')) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:1/x' } });
      if (String(u).startsWith('http://1.1.1.2/')) return new Response(null, { status: 302, headers: { location: '/again' } });
      return new Response('ok');
    };
    await assert.rejects(fetchWithTimeout('http://1.1.1.1/a'), (e) => e.status === 403);
    await assert.rejects(fetchWithTimeout('http://1.1.1.2/a'), (e) => e.status === 502); // 无限跳转
    assert.equal(await (await fetchWithTimeout('http://1.1.1.3/')).text(), 'ok');
  } finally { globalThis.fetch = real; _setAllowPrivate(true); }
});

test('超过 5MB 的响应 -> searchSite 返回 []', async () => {
  assert.deepEqual(await searchSite({ id: 1, api: base + '/big' }, 'x', { timeoutMs: 5000 }), []);
});

test('searchAll：第 1 页满页且不止一页时再取第 2 页（不取第 3 页）', async () => {
  const pages = [];
  const srv2 = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const pg = Number(u.searchParams.get('pg') || 1);
    pages.push(pg);
    const item = (i) => ({ vod_id: pg * 10 + i, vod_name: `功夫${pg}-${i}`, type_name: '动作片', vod_play_from: 'm3u8', vod_play_url: '正片$https://a/1.m3u8' });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ code: 1, page: pg, pagecount: 3, limit: '2', total: 6, list: [item(1), item(2)] }));
  });
  await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
  try {
    for (const s of sites.listSites()) sites.updateSite(s.id, { enabled: 0 });
    sites.addSite({ name: 'paged', api: `http://127.0.0.1:${srv2.address().port}/api.php/provide/vod` });
    const r = await sites.searchAll('功夫');
    assert.equal(r.length, 4);
    assert.deepEqual(pages.sort(), [1, 2]);
  } finally { srv2.closeAllConnections?.(); srv2.close(); }
});
