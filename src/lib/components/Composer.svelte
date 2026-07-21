<script lang="ts">
	import type { LessonSession } from '$lib/chat/session.svelte';

	let { session }: { session: LessonSession } = $props();

	let text = $state('');
	let textarea = $state<HTMLTextAreaElement | null>(null);

	const placeholder = $derived.by(() => {
		if (session.pending?.type === 'free-response') return 'Type your answer…';
		if (session.pending?.type === 'open-ended') return 'Share your thoughts…';
		if (session.pending?.type === 'multiple-choice')
			return 'Pick an option above, or ask a question…';
		return 'Ask a question, or press Enter to continue…';
	});

	const continueLabel = $derived.by(() => {
		if (session.finished) return null;
		if (session.pending) return 'Skip question →';
		return 'Continue ↵';
	});

	function send() {
		const value = text;
		text = '';
		if (value.trim()) {
			void session.submit(value);
		} else if (!session.finished) {
			session.advance();
		}
		textarea?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="composer">
	<textarea
		bind:this={textarea}
		bind:value={text}
		{placeholder}
		rows="1"
		disabled={session.busy}
		{onkeydown}
	></textarea>
	<div class="buttons">
		{#if text.trim()}
			<button class="primary" disabled={session.busy} onclick={send}>Send</button>
		{:else if continueLabel}
			<button
				class:primary={!session.pending}
				class:subtle={!!session.pending}
				disabled={session.busy}
				onclick={() => session.advance()}
			>
				{continueLabel}
			</button>
		{/if}
	</div>
</div>

<style>
	.composer {
		display: flex;
		gap: 0.6rem;
		align-items: flex-end;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--bubble-tutor);
		box-shadow: 0 -8px 24px -18px rgb(0 0 0 / 0.4);
	}
	textarea {
		flex: 1;
		resize: none;
		border: none;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
		line-height: 1.4;
		max-height: 9rem;
		field-sizing: content;
	}
	textarea::placeholder {
		color: var(--muted);
	}
	.buttons {
		display: flex;
		gap: 0.4rem;
	}
	button {
		font: inherit;
		font-size: 0.9rem;
		padding: 0.45rem 1rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--chip-bg);
		color: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
	button.subtle {
		color: var(--muted);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:not(:disabled):hover {
		filter: brightness(1.06);
	}
</style>
