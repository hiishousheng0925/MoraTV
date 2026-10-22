<script>
  /**
   * 设置：TMDB 密钥、AI 接口（地址 / 密钥 / 模型都是自由填写，空着用缺省）、资源站管理（增删 / 启停 / 测速）、
   * 主题、清缓存、版本号；底部 TMDB 署名（TMDB 使用条款要求）。
   */
  import { invalidateAll } from '$app/navigation';
  import Page from '$lib/ui/Page.svelte';
  import SettingsGroup from '$lib/ui/SettingsGroup.svelte';
  import ThemeToggle from '$lib/ui/ThemeToggle.svelte';
  import Confirm from '$lib/ui/Confirm.svelte';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { PRIMARY, SECONDARY, ROW, INPUT } from '$lib/ui/btn.js';
  import Trash from 'phosphor-svelte/lib/Trash';

  let { data } = $props();

  let tmdbKey = $state(''), llmBase = $state(''), llmKey = $state(''), llmModel = $state('');
  $effect(() => { tmdbKey = data.s.tmdb_key; llmBase = data.s.llm_base; llmKey = data.s.llm_key; llmModel = data.s.llm_model; });

  let busy = $state('');
  async function post(url, body, method = 'POST') {
    const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '操作失败');
    return j;
  }

  async function saveTmdb(e) {
    e.preventDefault();
    busy = 'tmdb';
    try {
      const j = await post('/api/settings', { tmdb_key: tmdbKey });
      if (!tmdbKey.trim()) toast.ok('TMDB 密钥已清除');
      else if (j.tmdbOk === false) toast.error('已保存，但 TMDB 连不上或密钥无效');
      else toast.ok('TMDB 密钥已保存');
      await invalidateAll();
    } catch (err) { toast.error(err); } finally { busy = ''; }
  }
  async function saveLlm(e) {
    e.preventDefault();
    busy = 'llm';
    try {
      await post('/api/settings', { llm_base: llmBase, llm_key: llmKey, llm_model: llmModel });
      toast.ok('AI 接口已保存');
      await invalidateAll();
    } catch (err) { toast.error(err); } finally { busy = ''; }
  }

  /* ---------- 资源站 ---------- */
  let sites = $state([]);
  $effect(() => { sites = data.sites; });
  let newName = $state(''), newApi = $state('');
  let testing = $state({});

  async function addSite(e) {
    e.preventDefault();
    busy = 'add';
    try {
      const j = await post('/api/sites', { name: newName, api: newApi });
      sites = [...sites, j.site];
      toast.ok(`已添加「${j.site.name}」`);
      newName = ''; newApi = '';
      test(j.site);
    } catch (err) { toast.error(err); } finally { busy = ''; }
  }
  async function toggle(s) {
    try {
      const j = await post('/api/sites', { id: s.id, enabled: !s.enabled }, 'PATCH');
      sites = sites.map((x) => (x.id === s.id ? j.site : x));
      toast.ok(`${j.site.name} 已${j.site.enabled ? '启用' : '停用'}`);
    } catch (err) { toast.error(err); }
  }
  async function test(s) {
    testing = { ...testing, [s.id]: true };
    try {
      const j = await post('/api/sites', { action: 'test', id: s.id });
      sites = sites.map((x) => (x.id === s.id ? { ...x, latency_ms: j.latencyMs, fail_streak: j.ok ? 0 : x.fail_streak + 1, ok: j.ok } : x));
      if (j.ok) toast.ok(`${s.name} 可用 · ${j.latencyMs} ms`); else toast.error(`${s.name} 连不上`);
    } catch (err) { toast.error(err); } finally { testing = { ...testing, [s.id]: false }; }
  }
  const testAll = () => sites.filter((s) => s.enabled).forEach(test);

  let removing = $state(null);
  async function removeSite() {
    const s = removing; removing = null;
    try {
      const r = await fetch(`/api/sites?id=${s.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('删除失败');
      sites = sites.filter((x) => x.id !== s.id);
      toast.ok(`已删除「${s.name}」`);
    } catch (err) { toast.error(err); }
  }
  const status = (s) => (s.ok === false || (s.ok == null && s.fail_streak > 0) ? 'bad' : s.latency_ms != null ? 'ok' : 'idle');

  let clearing = $state(false);
  async function clearCache() {
    clearing = true;
    try { await post('/api/settings', { action: 'clearCache' }); toast.ok('缓存已清除'); } catch (err) { toast.error(err); } finally { clearing = false; }
  }
</script>

<Confirm open={!!removing} danger title="删除资源站「{removing?.name ?? ''}」？" confirmLabel="删除"
         onconfirm={removeSite} oncancel={() => (removing = null)} />

<Page narrow>
  <div class="space-y-8">
    <SettingsGroup id="tmdb" title="TMDB">
      <form class="{ROW} max-sm:flex-col max-sm:items-stretch" onsubmit={saveTmdb}>
        <label for="tmdb-key" class="shrink-0 text-[14px] text-ink-100">API 密钥</label>
        <div class="flex min-w-0 flex-1 gap-2 sm:max-w-md">
          <input id="tmdb-key" type="password" bind:value={tmdbKey} autocomplete="off" spellcheck="false" class={INPUT} />
          <button class={PRIMARY} disabled={busy === 'tmdb'}>保存</button>
        </div>
      </form>
    </SettingsGroup>

    <SettingsGroup id="ai" title="AI 接口（剧情搜索）">
      <form onsubmit={saveLlm} class="divide-y divide-ink-700">
        <div class="{ROW} max-sm:flex-col max-sm:items-stretch">
          <label for="llm-base" class="shrink-0 text-[14px] text-ink-100">接口地址</label>
          <input id="llm-base" bind:value={llmBase} placeholder={data.defaults.llm_base} autocomplete="off" spellcheck="false" class="{INPUT} sm:max-w-md" />
        </div>
        <div class="{ROW} max-sm:flex-col max-sm:items-stretch">
          <label for="llm-key" class="shrink-0 text-[14px] text-ink-100">密钥</label>
          <input id="llm-key" type="password" bind:value={llmKey} autocomplete="off" spellcheck="false" class="{INPUT} sm:max-w-md" />
        </div>
        <div class="{ROW} max-sm:flex-col max-sm:items-stretch">
          <label for="llm-model" class="shrink-0 text-[14px] text-ink-100">模型</label>
          <input id="llm-model" bind:value={llmModel} placeholder={data.defaults.llm_model} autocomplete="off" spellcheck="false" class="{INPUT} sm:max-w-md" />
        </div>
        <div class="flex justify-end px-4 py-3"><button class={PRIMARY} disabled={busy === 'llm'}>保存</button></div>
      </form>
    </SettingsGroup>

    <SettingsGroup id="sites" title="资源站">
      {#snippet extra()}<button onclick={testAll} class="ml-auto rounded-md px-2 py-0.5 text-[12px] font-normal text-accent hover:bg-accent/10">全部测速</button>{/snippet}
      {#each sites as s (s.id)}
        {@const st = status(s)}
        <div class="{ROW} gap-3" data-site={s.id}>
          <span class="h-2 w-2 shrink-0 rounded-full {st === 'ok' ? 'bg-live' : st === 'bad' ? 'bg-danger' : 'bg-ink-600'}" aria-hidden="true"></span>
          <div class="min-w-0 flex-1 {s.enabled ? '' : 'opacity-50'}">
            <div class="truncate text-[14px] text-ink-100">{s.name}</div>
            <div class="truncate text-[11.5px] text-ink-400">{s.api}</div>
          </div>
          <span class="w-16 shrink-0 text-right text-[12px] tabular-nums text-ink-400">{testing[s.id] ? '…' : s.latency_ms != null ? `${s.latency_ms} ms` : ''}</span>
          <button onclick={() => test(s)} disabled={testing[s.id]} class="{SECONDARY} max-sm:hidden">测速</button>
          <button role="switch" aria-checked={!!s.enabled} aria-label="{s.enabled ? '停用' : '启用'} {s.name}" onclick={() => toggle(s)}
                  class="relative h-6 w-10 shrink-0 rounded-full transition {s.enabled ? 'bg-accent' : 'bg-ink-600'}">
            <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all {s.enabled ? 'left-[18px]' : 'left-0.5'}"></span>
          </button>
          <button onclick={() => (removing = s)} aria-label="删除 {s.name}" class="tap grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-400 transition hover:bg-ink-800 hover:text-danger">
            <Trash size={16} />
          </button>
        </div>
      {/each}
      <form class="{ROW} gap-2 max-sm:flex-col max-sm:items-stretch" onsubmit={addSite}>
        <input bind:value={newName} placeholder="名称" aria-label="资源站名称" class="{INPUT} sm:max-w-[9rem]" />
        <input bind:value={newApi} placeholder="https://…/api.php/provide/vod" aria-label="资源站接口地址" spellcheck="false" class={INPUT} />
        <button class={PRIMARY} disabled={busy === 'add' || !newName.trim() || !newApi.trim()}>添加</button>
      </form>
    </SettingsGroup>

    <SettingsGroup id="look" title="外观">
      <div class={ROW}><span class="text-[14px] text-ink-100">主题</span><ThemeToggle /></div>
    </SettingsGroup>

    <SettingsGroup id="storage" title="存储">
      <div class={ROW}>
        <span class="text-[14px] text-ink-100">图片与搜索缓存</span>
        <button class={SECONDARY} onclick={clearCache} disabled={clearing}>清除缓存</button>
      </div>
    </SettingsGroup>

    <SettingsGroup id="about" title="关于">
      <div class={ROW}><span class="text-[14px] text-ink-100">版本</span><span class="text-[13px] tabular-nums text-ink-400" data-version>{data.version}</span></div>
    </SettingsGroup>

    <footer class="flex flex-col items-center gap-2.5 pb-4 pt-2 text-center" data-tmdb>
      <img src="/tmdb.svg" alt="TMDB" class="h-3.5 w-auto" />
      <p class="text-[11.5px] text-ink-400">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </footer>
  </div>
</Page>
