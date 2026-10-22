<script>
  /** 首页：占位。真正的首页（大搜索框、继续观看、想看、推荐排）在后续任务里做。 */
  import Page from '$lib/ui/Page.svelte';
  import Section from '$lib/ui/Section.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import Play from 'phosphor-svelte/lib/Play';
</script>

<Page>
  <Section title="继续观看" first>
    <EmptyState title="还没有观看记录" icon={Play} />
  </Section>
</Page>
