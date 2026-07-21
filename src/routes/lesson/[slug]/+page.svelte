<script lang="ts">
	import { LessonSession } from '$lib/chat/session.svelte';
	import ChatEntry from '$lib/components/ChatEntry.svelte';
	import Composer from '$lib/components/Composer.svelte';

	let { data } = $props();

	const session = $derived.by(() => new LessonSession(data.lesson));

	let scroller = $state<HTMLElement | null>(null);

	$effect(() => {
		session.init();
	});

	// Keep the newest message in view as entries arrive and stream in.
	$effect(() => {
		const last = session.entries.at(-1);
		void last?.markdown;
		void session.entries.length;
		if (scroller) {
			scroller.scrollTo({ top: scroller.scrollHeight });
		}
	});

	const progress = $derived(session.total ? session.cursor / session.total : 0);

	function restart() {
		if (
			confirm(
				'Go through this lesson again afresh? Your current run is archived (not deleted) and a clean one begins.'
			)
		) {
			void session.restart();
		}
	}
</script>

<svelte:head>
	<title>{data.lesson.title} · Nex</title>
</svelte:head>

<div class="page">
	<header>
		<a class="back" href="/" aria-label="All lessons">←</a>
		<div class="heading">
			<div class="title">{data.lesson.title}</div>
			<div class="progressbar" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
				<div class="fill" style="width: {progress * 100}%"></div>
			</div>
		</div>
		<button class="restart" onclick={restart} title="Archive this run and start over">
			Start afresh
		</button>
	</header>

	<main bind:this={scroller}>
		<div class="transcript">
			{#each session.entries as entry (entry.id)}
				<ChatEntry {entry} {session} />
			{/each}
		</div>
	</main>

	<footer>
		<Composer {session} />
	</footer>
</div>

<style>
	.page {
		height: 100dvh;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.7rem 1.1rem;
		border-bottom: 1px solid var(--border);
		background: var(--bubble-tutor);
	}
	.back {
		text-decoration: none;
		font-size: 1.2rem;
		color: var(--muted);
	}
	.back:hover {
		color: var(--accent);
	}
	.heading {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.progressbar {
		margin-top: 0.35rem;
		height: 4px;
		border-radius: 999px;
		background: var(--border);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--accent);
		border-radius: 999px;
		transition: width 300ms ease;
	}
	.restart {
		font: inherit;
		font-size: 0.82rem;
		color: var(--muted);
		background: none;
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.3rem 0.8rem;
		cursor: pointer;
	}
	.restart:hover {
		color: var(--bad);
		border-color: var(--bad);
	}
	main {
		flex: 1;
		overflow-y: auto;
	}
	.transcript {
		max-width: 52rem;
		margin: 0 auto;
		padding: 1.25rem 1.1rem 0.5rem;
	}
	footer {
		padding: 0.6rem 1.1rem 1rem;
	}
	footer :global(.composer) {
		max-width: 52rem;
		margin: 0 auto;
	}
</style>
