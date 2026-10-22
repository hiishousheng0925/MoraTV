/**
 * 剧情搜索（设计文档 §5.3）：把剧情描述发给 OpenAI 兼容的 LLM，拿最多 5 个候选，
 * 再逐个走 searchTitles 校验（查不到的丢掉）。
 */
import { fetchWithTimeout, readTextCapped } from '../net.js';
import { getSetting as realGetSetting } from '../settings.js';
import { searchTitles as realSearchTitles } from './aggregate.js';

export const DEFAULT_BASE = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
const LLM_TIMEOUT = 30000;
const MAX_GUESSES = 5;

const SYSTEM = '你是影视百科助手。用户只记得剧情，请推测最可能的作品。'
  + '只输出一个 JSON 数组，最多 5 项，按可能性从高到低，不要任何解释或 markdown。'
  + '每项格式：{"name":"简体中文片名（内地通用译名）","year":首播或上映年份(数字),"region":"国家或地区","reason":"一句话理由"}。'
  + '片名必须是真实存在的作品，不确定就少给，不要编造。';

/** 真实的 LLM 调用：POST {base}/chat/completions，返回 assistant 文本 */
async function realCallLLM({ base, key, model, prompt }) {
  const res = await fetchWithTimeout(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 800,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
    }),
  }, LLM_TIMEOUT);
  const text = await readTextCapped(res);
  if (!res.ok) {
    const e = new Error(`LLM ${res.status}`);
    /** @type {any} */ (e).status = 502;
    throw e;
  }
  return JSON.parse(text)?.choices?.[0]?.message?.content || '';
}

const DEFAULT_DEPS = { getSetting: realGetSetting, callLLM: realCallLLM, searchTitles: realSearchTitles };
let deps = DEFAULT_DEPS;
/** 测试钩子：注入假的 getSetting / callLLM / searchTitles；传 null 恢复。 */
export function _setDeps(d) { deps = d ? { ...DEFAULT_DEPS, ...d } : DEFAULT_DEPS; }

/** 从 LLM 文本里取候选数组：先整体 parse（去围栏），不行再抓第一个 [...] */
export function parseGuesses(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  let arr = null;
  try { arr = JSON.parse(s.trim()); } catch { /* 走正则 */ }
  if (!Array.isArray(arr)) {
    const m = s.match(/\[[\s\S]*\]/);
    if (m) { try { arr = JSON.parse(m[0]); } catch { arr = null; } }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    const name = typeof it?.name === 'string' ? it.name.trim() : '';
    if (!name) continue;
    const year = Number(it.year);
    out.push({
      name,
      year: Number.isFinite(year) && year > 1900 ? year : null,
      region: typeof it.region === 'string' ? it.region : '',
      reason: typeof it.reason === 'string' ? it.reason : '',
    });
    if (out.length >= MAX_GUESSES) break;
  }
  return out;
}

/** 候选里挑年份最接近的；没给年份取第一个 */
function pickClosest(works, year) {
  if (!works?.length) return null;
  if (year == null) return works[0];
  const d = (w) => (w.year == null ? 999 : Math.abs(w.year - year));
  return works.reduce((a, b) => (d(b) < d(a) ? b : a));
}

/** @param {string} desc @returns {Promise<{works: any[], guesses: {name:string, year:number|null, region:string, reason:string}[]}>} */
export async function searchPlot(desc) {
  const key = deps.getSetting('llm_key');
  if (!key) throw Object.assign(new Error('NO_LLM_KEY'), { status: 400, code: 'NO_LLM_KEY' });
  const base = (deps.getSetting('llm_base') || DEFAULT_BASE).replace(/\/+$/, '');
  const model = deps.getSetting('llm_model') || DEFAULT_MODEL;
  const text = await deps.callLLM({ base, key, model, prompt: String(desc).slice(0, 1000) });
  const guesses = parseGuesses(text);
  const picked = await Promise.all(guesses.map(async (g) => {
    try { return pickClosest(await deps.searchTitles(g.name), g.year); } catch { return null; }
  }));
  const seen = new Set();
  const works = picked.filter((w) => w && !seen.has(w.key) && seen.add(w.key));
  return { works, guesses };
}
