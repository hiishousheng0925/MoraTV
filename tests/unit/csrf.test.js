import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csrfReject } from '../../src/lib/server/csrf.js';

const self = 'http://127.0.0.1:4791';
const r = (o) => csrfReject({ method: 'POST', pathname: '/api/settings', origin: null, contentType: 'application/json', selfOrigin: self, ...o });

test('跨站 no-cors POST（不带 Content-Type）被拒', () => {
  assert.ok(r({ origin: 'https://evil.example', contentType: null }));
  assert.ok(r({ origin: 'https://evil.example', contentType: 'text/plain' }));
  assert.ok(r({ origin: 'null', contentType: null }), 'sandbox iframe 的 Origin: null');
});

test('跨站即使是 application/json 也拒（不靠预检兜底）', () => {
  assert.ok(r({ origin: 'https://evil.example' }));
  assert.ok(r({ method: 'DELETE', pathname: '/api/progress', origin: 'https://evil.example', contentType: null }));
});

test('同源 JSON 放行；同源但不是 JSON 的写请求拒', () => {
  assert.equal(r({ origin: self }), null);
  assert.equal(r({ origin: self, contentType: 'application/json; charset=utf-8' }), null);
  assert.ok(r({ origin: self, contentType: 'text/plain' }));
  assert.equal(r({ method: 'DELETE', pathname: '/api/sites', origin: self, contentType: null }), null);
});

test('没有 Origin：只放行 application/json', () => {
  assert.equal(r({ origin: null }), null);
  assert.ok(r({ origin: null, contentType: null }));
  assert.ok(r({ method: 'PATCH', pathname: '/api/sites', origin: null, contentType: 'application/x-www-form-urlencoded' }));
});

test('GET 和非 /api 路径不管', () => {
  assert.equal(r({ method: 'GET', origin: 'https://evil.example', contentType: null }), null);
  assert.equal(r({ pathname: '/settings', origin: 'https://evil.example', contentType: null }), null);
});
