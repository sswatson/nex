import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';

// Math support: $...$ inline, $$...$$ display. Runs before the standard
// tokenizers so dollar-delimited spans never reach emphasis/code handling.
const blockMath = {
	name: 'blockMath',
	level: 'block' as const,
	start(src: string) {
		const i = src.indexOf('$$');
		return i === -1 ? undefined : i;
	},
	tokenizer(src: string) {
		const match = /^\$\$([\s\S]+?)\$\$/.exec(src);
		if (match) {
			return { type: 'blockMath', raw: match[0], text: match[1].trim() };
		}
	},
	renderer(token: { text: string }) {
		return katex.renderToString(token.text, { displayMode: true, throwOnError: false });
	}
};

const inlineMath = {
	name: 'inlineMath',
	level: 'inline' as const,
	start(src: string) {
		const i = src.indexOf('$');
		return i === -1 ? undefined : i;
	},
	tokenizer(src: string) {
		const match = /^\$([^$\n]+?)\$/.exec(src);
		if (match) {
			return { type: 'inlineMath', raw: match[0], text: match[1] };
		}
	},
	renderer(token: { text: string }) {
		return katex.renderToString(token.text, { displayMode: false, throwOnError: false });
	}
};

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

// ```mermaid fences render as diagrams. A custom block tokenizer (like the
// math ones) claims the fence before the standard code tokenizer, so the
// source reaches the client unhighlighted and correctly escaped; the browser
// then renders it in place (see $lib/mermaid.ts).
const mermaidBlock = {
	name: 'mermaid',
	level: 'block' as const,
	start(src: string) {
		const i = src.indexOf('```mermaid');
		return i === -1 ? undefined : i;
	},
	tokenizer(src: string) {
		const match = /^```mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?:\n+|$)/.exec(src);
		if (match) {
			return { type: 'mermaid', raw: match[0], text: match[1] };
		}
	},
	renderer(token: { text: string }) {
		return `<pre class="mermaid">${escapeHtml(token.text)}</pre>`;
	}
};

// ```embed fences render a sandboxed iframe hosting a lesson-local web app
// (a self-contained HTML file in the lesson's folder). The sandbox gives the
// widget a null origin: scripts run, but it cannot touch the app's storage or
// API. Fields: src (required, relative to lessons/), height, title.
const embedBlock = {
	name: 'embed',
	level: 'block' as const,
	start(src: string) {
		const i = src.indexOf('```embed');
		return i === -1 ? undefined : i;
	},
	tokenizer(src: string) {
		const match = /^```embed[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?:\n+|$)/.exec(src);
		if (match) {
			return { type: 'embed', raw: match[0], text: match[1] };
		}
	},
	renderer(token: { text: string }) {
		const fields: Record<string, string> = {};
		for (const line of token.text.split('\n')) {
			const m = /^(\w+):\s*(.*)$/.exec(line.trim());
			if (m) fields[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
		const src = fields.src ?? '';
		const invalid =
			!src ||
			/^[a-z][a-z0-9+.-]*:/i.test(src) ||
			src.startsWith('/') ||
			src.split(/[\\/]/).some((part) => part === '..' || part === '');
		if (invalid) {
			return '<p><em>Invalid embed: "src" must be a file path relative to the lessons directory.</em></p>\n';
		}
		const height = Math.min(Math.max(parseInt(fields.height ?? '', 10) || 400, 100), 2000);
		const title = fields.title || 'Interactive lesson widget';
		return `<iframe class="embed" src="/lessons/${escapeHtml(src)}" height="${height}" sandbox="allow-scripts" loading="lazy" title="${escapeHtml(title)}"></iframe>\n`;
	}
};

const renderer = new Marked(
	markedHighlight({
		langPrefix: 'hljs language-',
		highlight(code, lang) {
			const language = hljs.getLanguage(lang) ? lang : 'plaintext';
			return hljs.highlight(code, { language }).value;
		}
	})
);
renderer.use({ extensions: [blockMath, inlineMath, mermaidBlock, embedBlock] });

// Lesson images: a relative image path refers to a file in the lessons
// directory (e.g. ![curves](my-lesson/growth.svg) → /lessons/my-lesson/growth.svg,
// served by src/routes/lessons/[...path]). Absolute paths and full URLs pass
// through untouched.
renderer.use({
	renderer: {
		image({ href, title, text }) {
			let src = href ?? '';
			if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/')) {
				src = `/lessons/${src}`;
			}
			const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
			return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text ?? '')}"${titleAttr} loading="lazy">`;
		}
	}
});

/** Render lesson/tutor markdown (with math and syntax highlighting) to HTML. */
export function renderMarkdown(markdown: string): string {
	return renderer.parse(markdown, { async: false });
}
