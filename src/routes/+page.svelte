<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Nex</title>
</svelte:head>

<main>
	<header>
		<h1>Nex</h1>
		<p class="tagline">Self-directed lessons, one chat at a time.</p>
	</header>

	{#if data.lessons.length === 0}
		<p class="empty">
			No lessons found. Drop a <code>.md</code> lesson file into the <code>lessons/</code> folder
			(see <code>LESSON_FORMAT.md</code>).
		</p>
	{:else}
		<ul class="lessons">
			{#each data.lessons as lesson (lesson.slug)}
				<li>
					{#if 'error' in lesson}
						<div class="card broken">
							<div class="title">{lesson.slug}.md</div>
							<p class="error">Failed to parse: {lesson.error}</p>
						</div>
					{:else}
						<a class="card" href="/lesson/{lesson.slug}">
							<div class="title">{lesson.title}</div>
							{#if lesson.description}
								<p class="description">{lesson.description}</p>
							{/if}
							<div class="meta">
								{lesson.questionCount}
								{lesson.questionCount === 1 ? 'question' : 'questions'}
							</div>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 44rem;
		margin: 0 auto;
		padding: 3rem 1.25rem;
	}
	header {
		margin-bottom: 2rem;
	}
	h1 {
		font-size: 2.2rem;
		margin: 0;
		letter-spacing: -0.02em;
	}
	.tagline {
		color: var(--muted);
		margin-top: 0.35rem;
	}
	.lessons {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.9rem;
	}
	.card {
		display: block;
		padding: 1.1rem 1.3rem;
		border: 1px solid var(--border);
		border-radius: 0.9rem;
		background: var(--bubble-tutor);
		text-decoration: none;
		color: inherit;
		transition:
			border-color 120ms,
			transform 80ms;
	}
	a.card:hover {
		border-color: var(--accent);
		transform: translateY(-1px);
	}
	.title {
		font-weight: 600;
		font-size: 1.08rem;
	}
	.description {
		color: var(--muted);
		margin: 0.35rem 0 0;
	}
	.meta {
		margin-top: 0.6rem;
		font-size: 0.8rem;
		color: var(--accent);
		font-weight: 500;
	}
	.broken .error {
		color: var(--error-text);
		font-size: 0.85rem;
		white-space: pre-wrap;
	}
	.empty {
		color: var(--muted);
	}
</style>
