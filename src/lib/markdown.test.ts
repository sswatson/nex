import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
	it('renders mermaid fences as unprocessed placeholders', () => {
		const html = renderMarkdown('```mermaid\ngraph LR\n  A --> B\n```');
		expect(html).toContain('<pre class="mermaid">');
		expect(html).not.toContain('hljs');
	});

	it('escapes mermaid source so arrows survive textContent extraction', () => {
		const html = renderMarkdown('```mermaid\ngraph LR\n  A["<b>"] --> B\n```');
		expect(html).toContain('A[&quot;&lt;b&gt;&quot;] --&gt; B');
		expect(html).not.toContain('<b>');
	});

	it('still highlights ordinary code fences', () => {
		const html = renderMarkdown('```python\nprint("hi")\n```');
		expect(html).toContain('hljs');
		expect(html).not.toContain('class="mermaid"');
	});

	it('leaves an unterminated mermaid fence as a code block', () => {
		const html = renderMarkdown('```mermaid\ngraph LR\n  A --> B');
		expect(html).not.toContain('<pre class="mermaid">');
	});

	it('renders inline and display math with KaTeX', () => {
		expect(renderMarkdown('so $x^2$ grows')).toContain('katex');
		expect(renderMarkdown('$$\\frac{1}{2}$$')).toContain('katex-display');
	});
});

describe('lesson images', () => {
	it('rewrites relative image paths to the lesson asset route', () => {
		const html = renderMarkdown('![curves](big-o-notation/growth.svg)');
		expect(html).toContain('src="/lessons/big-o-notation/growth.svg"');
		expect(html).toContain('alt="curves"');
		expect(html).toContain('loading="lazy"');
	});

	it('leaves absolute paths and full URLs untouched', () => {
		expect(renderMarkdown('![a](/static/x.png)')).toContain('src="/static/x.png"');
		expect(renderMarkdown('![a](https://example.com/x.png)')).toContain(
			'src="https://example.com/x.png"'
		);
		expect(renderMarkdown('![a](data:image/png;base64,AAAA)')).toContain(
			'src="data:image/png;base64,AAAA"'
		);
	});

	it('escapes alt text and title', () => {
		const html = renderMarkdown('![a "quote" <b>](pic.png "my \\"title\\"")');
		expect(html).not.toContain('<b>');
		expect(html).toContain('title=');
	});
});

describe('embedded widgets', () => {
	it('renders an embed fence as a sandboxed iframe', () => {
		const html = renderMarkdown('```embed\nsrc: my-lesson/widget/index.html\nheight: 320\n```');
		expect(html).toContain('src="/lessons/my-lesson/widget/index.html"');
		expect(html).toContain('sandbox="allow-scripts"');
		expect(html).toContain('height="320"');
	});

	it('defaults and clamps the height', () => {
		expect(renderMarkdown('```embed\nsrc: a/b.html\n```')).toContain('height="400"');
		expect(renderMarkdown('```embed\nsrc: a/b.html\nheight: 99999\n```')).toContain(
			'height="2000"'
		);
	});

	it('rejects absolute, external, and traversal src values', () => {
		for (const src of ['/etc/passwd', 'https://example.com/x.html', '../../secret.html', '']) {
			const html = renderMarkdown('```embed\nsrc: ' + src + '\n```');
			expect(html).toContain('Invalid embed');
			expect(html).not.toContain('<iframe');
		}
	});
});
