import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostReject } from '../../src/lib/server/hostguard.js';

const ORIGIN = 'http://127.0.0.1:4791';

test('设了 ORIGIN：只放行 127.0.0.1 / localhost 加正确端口', () => {
  assert.equal(hostReject('127.0.0.1:4791', ORIGIN), null);
  assert.equal(hostReject('localhost:4791', ORIGIN), null);
  assert.equal(hostReject('LocalHost:4791', ORIGIN), null);
  assert.ok(hostReject('127.0.0.1:4792', ORIGIN), '端口不对');
  assert.ok(hostReject('attacker.example:4791', ORIGIN), 'DNS 重绑定');
  assert.ok(hostReject('127.0.0.1.attacker.example:4791', ORIGIN));
  assert.ok(hostReject('192.168.1.5:4791', ORIGIN));
  assert.ok(hostReject(null, ORIGIN));
  assert.ok(hostReject('', ORIGIN));
});

test('没设 ORIGIN（dev / 测试）：回环名任意端口，其余仍拒', () => {
  assert.equal(hostReject('127.0.0.1:5173', undefined), null);
  assert.equal(hostReject('localhost:3000', ''), null);
  assert.ok(hostReject('attacker.example:5173', undefined));
});

test('重绑定场景：GET /api/settings 带外来 Host 被拒，正确 Host 放行（hooks.server.js 对 hostReject 的结果回 403）', () => {
  const host = (h) => hostReject(h, ORIGIN);
  assert.ok(host('rebind.attacker.example:4791'));
  assert.equal(host('127.0.0.1:4791'), null);
});
