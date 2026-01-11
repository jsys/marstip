<script lang="ts">
  import '../app.css';
  import { isLoading } from 'svelte-i18n';
  import { initI18n } from '$lib/i18n';

  initI18n();
</script>

{#if $isLoading}
  <div class="h-screen bg-slate-900 flex items-center justify-center">
    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
  </div>
{:else}
  <slot />
{/if}
