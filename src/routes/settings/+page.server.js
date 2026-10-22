import { getSetting } from '$lib/server/settings.js';
import { listSites } from '$lib/server/cms/sites.js';
import { DEFAULT_BASE, DEFAULT_MODEL } from '$lib/server/search/plot.js';
import pkg from '../../../package.json';

export function load() {
  return {
    s: {
      tmdb_key: getSetting('tmdb_key') ?? '',
      llm_base: getSetting('llm_base') ?? '',
      llm_key: getSetting('llm_key') ?? '',
      llm_model: getSetting('llm_model') ?? '',
    },
    defaults: { llm_base: DEFAULT_BASE, llm_model: DEFAULT_MODEL },
    sites: listSites(),
    version: pkg.version,
  };
}
