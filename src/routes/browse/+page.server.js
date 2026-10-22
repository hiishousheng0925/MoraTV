import * as tmdb from '$lib/server/tmdb.js';
import { regionOfCountry } from '$lib/server/search/normalize.js';

/** 形态 -> TMDB discover 参数 */
const KINDS = {
  tv: { type: 'tv', kind: 'tv' },
  movie: { type: 'movie' },
  variety: { type: 'tv', kind: 'variety' },
  doc: { type: 'tv', kind: 'doc' },
};
const REGIONS = new Set(['cn', 'hk', 'tw', 'kr', 'jp', 'th', 'west']);

export async function load({ url }) {
  const kind = KINDS[url.searchParams.get('kind')] ? url.searchParams.get('kind') : 'tv';
  const region = REGIONS.has(url.searchParams.get('region')) ? url.searchParams.get('region') : '';
  const page = Math.min(500, Math.max(1, Number(url.searchParams.get('p')) || 1));
  if (!tmdb.hasKey()) return { hasKey: false, kind, region, page, items: [], error: false };
  const k = KINDS[kind];
  try {
    const list = await tmdb.discover(k.type, { region: region || undefined, kind: k.kind, page });
    const items = list.map((t) => ({ key: `${t.type}-${t.id}`, name: t.name, poster: t.poster, year: t.year,
      region: regionOfCountry(t.region), kind: kind === 'variety' || kind === 'doc' ? kind : t.type, available: null }));
    return { hasKey: true, kind, region, page, items, error: false };
  } catch (e) {
    console.warn('[browse] TMDB', e?.message || e);
    return { hasKey: true, kind, region, page, items: [], error: true };
  }
}
