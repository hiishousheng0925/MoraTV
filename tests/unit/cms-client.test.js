import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;
process.env.MORA_TEST_HOOKS = '1'; // 允许连回环地址（本地测试服务）

const { db } = await import('../../src/lib/server/db.js');
const { searchSite, detailSite, listCategories } = await import('../../src/lib/server/cms/client.js');
const sites = await import('../../src/lib/server/cms/sites.js');
const { assertPublic } = await import('../../src/lib/server/net.js');

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

test('assertPublic 拒绝内网 / 非 http（放行开关关闭后）', async () => {
  delete process.env.MORA_TEST_HOOKS;
  try {
    for (const u of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://100.64.0.1/', 'http://169.254.1.1/', 'http://[::1]/', 'http://localhost/', 'ftp://example.com/'])
      await assert.rejects(assertPublic(u), (e) => e.status === 403, u);
    await assertPublic('http://1.1.1.1/');
  } finally { process.env.MORA_TEST_HOOKS = '1'; }
});
