<!-- TEMP: stub replacing shadcn docs' icon-placeholder — may consider dropping shadcn-svelte entirely, too cumbersome to maintain -->
<script lang="ts">
	let { class: className }: Record<string, any> = $props();
</script>

<span class={className}></span>
