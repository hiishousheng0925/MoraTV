import { history, favorites } from '$lib/server/library.js';

export function load({ url }) {
  const tab = url.searchParams.get('tab') === 'fav' ? 'fav' : 'history';
  const page = Number(url.searchParams.get('p')) || 1;
  const favs = favorites();
  return { tab, hist: history({ page, per: 30 }), favs };
}
