<script lang="ts">
	import type { LessonSession, Entry } from '$lib/chat/session.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { renderMermaidIn } from '$lib/mermaid';

	let { entry, session }: { entry: Entry; session: LessonSession } = $props();

	let contentEl: HTMLElement | undefined = $state();

	// Render mermaid diagrams once the entry's markdown is final. While the
	// tutor is still streaming, a fence may be incomplete — leave it as text.
	$effect(() => {
		void entry.markdown;
		if (!entry.streaming && contentEl) void renderMermaidIn(contentEl);
	});

	const question = $derived(entry.questionId ? session.questionById(entry.questionId) : undefined);
	const isActiveQuestion = $derived(
		entry.variant === 'question' && session.pending?.id === entry.questionId
	);
	const answeredIndex = $derived(
		entry.questionId !== undefined ? session.mcAnswers[entry.questionId] : undefined
	);

	$effect(() => {
		if (question?.type === 'terminal') session.prewarmTerminal(question.id);
	});

	function typeLabel(t: string): string {
		if (t === 'multiple-choice') return 'Question';
		if (t === 'free-response') return 'Your answer, in the chat box below';
		if (t === 'exercise') return 'Hands-on exercise — opens in your editor';
		if (t === 'terminal') return 'Hands-on step — sends text to your terminal';
		return 'Open question — share your thoughts below';
	}

	let launchState = $state<'idle' | 'opening' | 'opened'>('idle');
	let injectionState = $state<'idle' | 'sending' | 'sent'>('idle');

	async function launchExercise(): Promise<void> {
		if (!question || launchState === 'opening') return;
		launchState = 'opening';
		const ok = await session.launchExercise(question.id);
		launchState = ok ? 'opened' : 'idle';
	}

	async function injectTerminal(): Promise<void> {
		if (!question || injectionState === 'sending') return;
		injectionState = 'sending';
		const ok = await session.injectTerminal(question.id);
		injectionState = ok ? 'sent' : 'idle';
	}
</script>

<div
	class="entry {entry.role} variant-{entry.variant}"
	class:verdict-correct={entry.verdict === 'correct'}
	class:verdict-partial={entry.verdict === 'partial'}
	class:verdict-incorrect={entry.verdict === 'incorrect'}
>
	<div class="bubble">
		{#if entry.variant === 'question' && question}
			<div class="question-tag">{typeLabel(question.type)}</div>
		{/if}
		{#if entry.streaming && !entry.markdown}
			<span class="typing" aria-label="Nex is thinking"><i></i><i></i><i></i></span>
		{:else if entry.variant === 'error'}
			<strong>Something went wrong:</strong> {entry.markdown}
		{:else}
			<div class="content" bind:this={contentEl}>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html renderMarkdown(entry.markdown)}{#if entry.streaming}<span class="caret"></span>{/if}
			</div>
		{/if}

		{#if entry.variant === 'question' && question?.type === 'exercise'}
			<div class="exercise-actions">
				<button class="launch" disabled={launchState === 'opening'} onclick={launchExercise}>
					{launchState === 'opening'
						? 'Opening…'
						: launchState === 'opened'
							? 'Open again'
							: 'Open exercise'}
				</button>
				{#if launchState === 'opened'}
					<span class="launch-note">Opened — press Continue here when you're done.</span>
				{/if}
			</div>
		{/if}

		{#if entry.variant === 'question' && question?.type === 'terminal'}
			{#if question.showText}
				<pre class="terminal-code"><code>{question.text}</code></pre>
			{/if}
			<div class="exercise-actions">
				<button class="launch" disabled={injectionState === 'sending'} onclick={injectTerminal}>
					{injectionState === 'sending'
						? 'Sending…'
						: injectionState === 'sent'
							? 'Send again'
							: `Send to ${question.target}`}
				</button>
				{#if injectionState === 'sent'}
					<span class="launch-note">Sent — inspect the result, then press Continue here.</span>
				{/if}
			</div>
		{/if}

		{#if entry.variant === 'question' && question?.type === 'multiple-choice'}
			<div class="chips" role="group" aria-label="Answer choices">
				{#each question.choices as choice, i (i)}
					<button
						class="chip"
						class:selected={answeredIndex === i}
						class:chip-correct={answeredIndex !== undefined && choice.correct}
						class:chip-incorrect={answeredIndex === i && !choice.correct}
						disabled={!isActiveQuestion}
						onclick={() => session.answerChoice(question, i)}
					>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html renderMarkdown(choice.text)}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.entry {
		display: flex;
		margin-block: 0.35rem;
	}
	.entry.user {
		justify-content: flex-end;
	}
	.bubble {
		max-width: min(46rem, 88%);
		padding: 0.7rem 1rem;
		border-radius: 0.9rem;
		line-height: 1.55;
		overflow-wrap: break-word;
	}
	/* A shrink-to-fit bubble makes an embed's width: 100% circular (it falls
	   back to ~300px), so a bubble holding one takes its full width. */
	.bubble:has(:global(iframe.embed)) {
		width: min(46rem, 88%);
	}
	.entry.tutor .bubble {
		background: var(--bubble-tutor);
		border: 1px solid var(--border);
		border-bottom-left-radius: 0.25rem;
	}
	.entry.user .bubble {
		background: var(--bubble-user);
		color: var(--bubble-user-text);
		border-bottom-right-radius: 0.25rem;
	}
	.variant-question .bubble {
		border-left: 3px solid var(--accent);
	}
	.variant-notice .bubble {
		background: transparent;
		border: 1px dashed var(--border);
		color: var(--muted);
	}
	.variant-error .bubble {
		background: var(--error-bg);
		border: 1px solid var(--error-border);
		color: var(--error-text);
		/* Server errors can carry multi-line guidance (e.g. a config example). */
		white-space: pre-wrap;
	}
	.verdict-correct .bubble {
		border-left: 3px solid var(--ok);
	}
	.verdict-partial .bubble {
		border-left: 3px solid var(--warn);
	}
	.verdict-incorrect .bubble {
		border-left: 3px solid var(--bad);
	}

	.question-tag {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
		margin-bottom: 0.35rem;
	}

	.exercise-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.7rem;
	}
	.launch {
		font: inherit;
		font-size: 0.92em;
		font-weight: 600;
		padding: 0.35rem 0.95rem;
		border-radius: 999px;
		border: 1px solid var(--accent);
		background: var(--accent);
		color: var(--bubble-user-text, #fff);
		cursor: pointer;
		transition:
			opacity 120ms,
			transform 60ms;
	}
	.launch:hover:not(:disabled) {
		transform: translateY(-1px);
	}
	.launch:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.launch-note {
		font-size: 0.85em;
		color: var(--muted);
	}
	.terminal-code {
		margin: 0.7rem 0 0;
		white-space: pre-wrap;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.7rem;
	}
	.chip {
		font: inherit;
		font-size: 0.92em;
		padding: 0.35rem 0.85rem;
		border-radius: 999px;
		border: 1px solid var(--chip-border);
		background: var(--chip-bg);
		color: inherit;
		cursor: pointer;
		transition:
			border-color 120ms,
			background 120ms,
			transform 60ms;
	}
	.chip :global(p) {
		margin: 0;
		display: inline;
	}
	.chip:not(:disabled):hover {
		border-color: var(--accent);
		transform: translateY(-1px);
	}
	.chip:disabled {
		cursor: default;
		opacity: 0.75;
	}
	.chip.chip-correct {
		border-color: var(--ok);
		background: var(--ok-bg);
		opacity: 1;
	}
	.chip.chip-incorrect {
		border-color: var(--bad);
		background: var(--bad-bg);
		opacity: 1;
	}

	.typing {
		display: inline-flex;
		gap: 4px;
		align-items: center;
		height: 1.2em;
	}
	.typing i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--muted);
		animation: blink 1.2s infinite both;
	}
	.typing i:nth-child(2) {
		animation-delay: 0.15s;
	}
	.typing i:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes blink {
		0%,
		80%,
		100% {
			opacity: 0.25;
		}
		40% {
			opacity: 1;
		}
	}
	.caret {
		display: inline-block;
		width: 2px;
		height: 1em;
		background: var(--accent);
		vertical-align: text-bottom;
		margin-left: 1px;
		animation: blink 1s infinite;
	}

	/* Markdown content inside bubbles */
	.bubble :global(h1) {
		font-size: 1.35rem;
		margin: 0.4rem 0 0.6rem;
	}
	.bubble :global(h2) {
		font-size: 1.18rem;
		margin: 0.4rem 0 0.5rem;
	}
	.bubble :global(h3),
	.bubble :global(h4) {
		font-size: 1.05rem;
		margin: 0.3rem 0 0.4rem;
	}
	.bubble :global(p:first-child),
	.bubble :global(h1:first-child),
	.bubble :global(h2:first-child),
	.bubble :global(h3:first-child) {
		margin-top: 0;
	}
	.bubble :global(p:last-child),
	.bubble :global(ul:last-child),
	.bubble :global(ol:last-child),
	.bubble :global(pre:last-child) {
		margin-bottom: 0;
	}
	.bubble :global(pre) {
		background: var(--pre-bg);
		color: var(--pre-text);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		padding: 0.7rem 0.9rem;
		overflow-x: auto;
		font-size: 0.88em;
	}
	.bubble :global(iframe.embed) {
		display: block;
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		background: transparent;
		margin: 0.4rem 0;
	}
	/* A rendered mermaid diagram is a figure, not a code block. */
	.bubble :global(pre.mermaid[data-processed]) {
		background: none;
		color: inherit;
		border: none;
		padding: 0.2rem 0;
		text-align: center;
	}
	.bubble :global(pre.mermaid svg) {
		max-width: 100%;
		height: auto;
	}
	.bubble :global(code) {
		font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
	}
	.bubble :global(:not(pre) > code) {
		background: var(--code-bg);
		padding: 0.1em 0.35em;
		border-radius: 0.3em;
		font-size: 0.9em;
	}
	.bubble :global(blockquote) {
		margin: 0.5rem 0;
		padding-left: 0.9rem;
		border-left: 3px solid var(--border);
		color: var(--muted);
	}
	.bubble :global(img) {
		max-width: 100%;
	}
	.bubble :global(table) {
		border-collapse: collapse;
		margin: 0.5rem 0;
	}
	.bubble :global(th),
	.bubble :global(td) {
		border: 1px solid var(--border);
		padding: 0.3rem 0.6rem;
	}
	.bubble :global(.katex-display) {
		overflow-x: auto;
		overflow-y: hidden;
		padding-block: 0.2rem;
	}
</style>
