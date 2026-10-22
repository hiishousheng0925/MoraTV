import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MORA_HOME = mkdtempSync(join(tmpdir(), 'moratv-test-'));

const plot = await import('../../src/lib/server/search/plot.js');

const work = (o) => ({ key: 'tv-1', type: 'tv', name: '', year: null, ...o });
let settings;
let sent;
let titleCalls;

function setup({ llm, titles = {} } = {}) {
  sent = [];
  titleCalls = [];
  plot._setDeps({
    getSetting: (k, d) => settings[k] ?? d,
    callLLM: async (req) => { sent.push(req); return typeof llm === 'function' ? llm(req) : llm; },
    searchTitles: async (n) => { titleCalls.push(n); return titles[n] || []; },
  });
}

beforeEach(() => { settings = { llm_key: 'k' }; });

test('解析带 markdown 围栏的 JSON，并按年份挑最接近的作品', async () => {
  setup({
    llm: '好的：\n```json\n[{"name":"黑暗荣耀","year":2022,"region":"韩国","reason":"复仇"},{"name":"重生之门","year":2010,"region":"中国","reason":"x"}]\n```',
    titles: {
      黑暗荣耀: [work({ key: 'tv-a', name: '黑暗荣耀', year: 2019 }), work({ key: 'tv-b', name: '黑暗荣耀', year: 2022 })],
    },
  });
  const r = await plot.searchPlot('一个被霸凌的女人复仇');
  assert.equal(r.guesses.length, 2);
  assert.equal(r.guesses[0].name, '黑暗荣耀');
  assert.deepEqual(r.works.map((w) => w.key), ['tv-b']);
  assert.deepEqual(titleCalls, ['黑暗荣耀', '重生之门']);
  assert.equal(sent[0].key, 'k');
  assert.equal(sent[0].base, 'https://integrate.api.nvidia.com/v1');
  assert.ok(sent[0].model);
});

test('正则兜底：文字夹着数组；最多 5 项；候选作品去重', async () => {
  const arr = Array.from({ length: 7 }, (_, i) => ({ name: `片${i}`, year: 2000 + i }));
  const titles = Object.fromEntries(arr.map((a) => [a.name, [work({ key: 'same', year: a.year })]]));
  setup({ llm: `结果如下 ${JSON.stringify(arr)} 以上`, titles });
  const r = await plot.searchPlot('x');
  assert.equal(r.guesses.length, 5);
  assert.equal(r.works.length, 1);
});

test('返回垃圾：works 为空、不抛', async () => {
  setup({ llm: '我不知道' });
  assert.deepEqual(await plot.searchPlot('x'), { works: [], guesses: [] });
  setup({ llm: '[{坏json' });
  assert.deepEqual(await plot.searchPlot('x'), { works: [], guesses: [] });
});

test('某个候选搜索失败不影响其他候选', async () => {
  setup({ llm: '[{"name":"甲"},{"name":"乙","year":2020}]' });
  plot._setDeps({
    getSetting: (k, d) => settings[k] ?? d,
    callLLM: async () => '[{"name":"甲"},{"name":"乙","year":2020}]',
    searchTitles: async (n) => { if (n === '甲') throw new Error('boom'); return [work({ key: 'tv-y', year: 2020 })]; },
  });
  const r = await plot.searchPlot('x');
  assert.deepEqual(r.works.map((w) => w.key), ['tv-y']);
});

test('无 key：抛 NO_LLM_KEY / 400，且不发请求', async () => {
  settings = {};
  setup({ llm: '[]' });
  await assert.rejects(plot.searchPlot('x'), (e) => e.status === 400 && e.code === 'NO_LLM_KEY');
  assert.equal(sent.length, 0);
});

test('设置里的 base / model 生效，base 去尾斜杠', async () => {
  settings = { llm_key: 'k', llm_base: 'https://api.example.com/v1/', llm_model: 'm-1' };
  setup({ llm: '[]' });
  await plot.searchPlot('x');
  assert.equal(sent[0].base, 'https://api.example.com/v1');
  assert.equal(sent[0].model, 'm-1');
});
