<script module lang="ts">
	export type ThemeContext = Writable<'light' | 'dark' | undefined>;
</script>

<script lang="ts">
	import { Button } from 'flowbite-svelte';
	import { MoonOutline, SunOutline } from 'flowbite-svelte-icons';
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';

	let theme = getContext<ThemeContext>('theme');

	function handleClick() {
		// Toggle the theme that is actually showing, which app.html sets before the page loads
		const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
		theme.set(next);
		// Only save an explicit choice, so visitors who never click keep following their system theme
		localStorage.setItem('theme', next);
	}
</script>

<Button size="sm" on:click={handleClick} color="none">
	<!-- Chosen by the dark class instead of the store, so the icon is right before the page hydrates -->
	<SunOutline class="hidden dark:block"></SunOutline>
	<MoonOutline class="dark:hidden"></MoonOutline>
</Button>
