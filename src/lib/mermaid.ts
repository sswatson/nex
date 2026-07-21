/**
 * Client-side Mermaid rendering for `pre.mermaid` placeholders emitted by
 * $lib/markdown.ts. The library (~1MB) is imported lazily, so lessons without
 * diagrams never pay for it.
 */

type MermaidModule = typeof import('mermaid').default;

let loader: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
	loader ??= import('mermaid').then((m) => {
		const mermaid = m.default;
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
			theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
		});
		return mermaid;
	});
	return loader;
}

/**
 * Render any not-yet-processed mermaid placeholders inside `root`.
 * No-op (and no library load) when the subtree contains none. Invalid diagram
 * source is left as visible text rather than breaking the message.
 */
export async function renderMermaidIn(root: HTMLElement): Promise<void> {
	const nodes = [...root.querySelectorAll<HTMLElement>('pre.mermaid:not([data-processed])')];
	if (nodes.length === 0) return;
	const mermaid = await loadMermaid();
	await mermaid.run({ nodes, suppressErrors: true });
}
