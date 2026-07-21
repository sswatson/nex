import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Lesson, LessonItem, Question } from './types';

const choiceSchema = z.object({
	text: z.string().min(1),
	correct: z.boolean().optional().default(false),
	explanation: z.string().optional()
});

const questionSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('multiple-choice'),
		id: z.string().optional(),
		prompt: z.string().min(1),
		choices: z.array(choiceSchema).min(2)
	}),
	z.object({
		type: z.literal('free-response'),
		id: z.string().optional(),
		prompt: z.string().min(1),
		criteria: z.string().optional(),
		sample_answer: z.string().optional()
	}),
	z.object({
		type: z.literal('open-ended'),
		id: z.string().optional(),
		prompt: z.string().min(1),
		context: z.string().optional()
	}),
	z.object({
		type: z.literal('exercise'),
		id: z.string().optional(),
		prompt: z.string().min(1),
		folder: z
			.string()
			.min(1)
			.refine((f) => !f.startsWith('/') && !f.startsWith('~'), {
				message: 'must be a relative path (resolved against the lessons directory)'
			})
			.refine((f) => f.split(/[\\/]/).every((part) => part !== '..' && part !== ''), {
				message: 'must not contain ".." or empty path segments'
			}),
		context: z.string().optional()
	})
]);

const frontmatterSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional()
});

export class LessonParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LessonParseError';
	}
}

function extractFrontmatter(source: string): { meta: unknown; body: string } {
	if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
		return { meta: {}, body: source };
	}
	const end = source.indexOf('\n---', 3);
	if (end === -1) {
		throw new LessonParseError('Unterminated frontmatter: found opening --- but no closing ---.');
	}
	const raw = source.slice(source.indexOf('\n') + 1, end);
	const body = source.slice(source.indexOf('\n', end + 1) + 1);
	let meta: unknown;
	try {
		meta = parseYaml(raw);
	} catch (e) {
		throw new LessonParseError(`Invalid YAML in frontmatter: ${(e as Error).message}`);
	}
	return { meta: meta ?? {}, body };
}

function parseQuestionBlock(yamlText: string, index: number): Question {
	let data: unknown;
	try {
		data = parseYaml(yamlText);
	} catch (e) {
		throw new LessonParseError(
			`Question block ${index}: invalid YAML — ${(e as Error).message}`
		);
	}
	const result = questionSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
			.join('\n');
		throw new LessonParseError(`Question block ${index} is invalid:\n${issues}`);
	}
	const q = result.data;
	const id = q.id ?? `q${index}`;

	if (q.type === 'multiple-choice') {
		if (!q.choices.some((c) => c.correct)) {
			throw new LessonParseError(
				`Question block ${index} ("${id}"): multiple-choice questions need at least one choice with "correct: true".`
			);
		}
		return { type: 'multiple-choice', id, prompt: q.prompt, choices: q.choices };
	}
	if (q.type === 'free-response') {
		if (!q.criteria && !q.sample_answer) {
			throw new LessonParseError(
				`Question block ${index} ("${id}"): free-response questions need "criteria" and/or "sample_answer" so the tutor can evaluate answers.`
			);
		}
		return {
			type: 'free-response',
			id,
			prompt: q.prompt,
			criteria: q.criteria,
			sampleAnswer: q.sample_answer
		};
	}
	if (q.type === 'exercise') {
		return { type: 'exercise', id, prompt: q.prompt, folder: q.folder, context: q.context };
	}
	return { type: 'open-ended', id, prompt: q.prompt, context: q.context };
}

/**
 * Parse a lesson: markdown with YAML frontmatter and ```question fenced blocks.
 *
 * Exposition is chunked into chat-message-sized items: each top-level markdown
 * block (paragraph, list, code fence, blockquote, table, ...) becomes one item,
 * except headings, which attach to the block that follows them.
 */
export function parseLesson(source: string, slug: string): Lesson {
	const { meta, body } = extractFrontmatter(source);
	const metaResult = frontmatterSchema.safeParse(meta);
	if (!metaResult.success) {
		throw new LessonParseError(
			'Lesson frontmatter must include a "title" (add a YAML block delimited by --- at the top of the file).'
		);
	}

	const tokens = marked.lexer(body);
	const items: LessonItem[] = [];
	const seenIds = new Set<string>();
	let buffer = '';
	let questionIndex = 0;

	const flush = () => {
		const text = buffer.trim();
		if (text) items.push({ kind: 'exposition', markdown: text });
		buffer = '';
	};

	for (const token of tokens) {
		if (token.type === 'space') continue;
		if (token.type === 'code' && token.lang === 'question') {
			flush();
			questionIndex += 1;
			const question = parseQuestionBlock(token.text, questionIndex);
			if (seenIds.has(question.id)) {
				throw new LessonParseError(`Duplicate question id "${question.id}".`);
			}
			seenIds.add(question.id);
			items.push({ kind: 'question', question });
			continue;
		}
		if (token.type === 'hr') {
			flush();
			continue;
		}
		if (token.type === 'heading') {
			flush();
			// marked's heading `raw` carries no trailing newline (it lands in a
			// separate `space` token), so restore the blank line to keep the
			// following block from merging onto the heading's line.
			buffer = token.raw.trimEnd() + '\n\n';
			continue;
		}
		buffer += token.raw;
		flush();
	}
	flush();

	if (items.length === 0) {
		throw new LessonParseError('Lesson has no content.');
	}

	return {
		slug,
		title: metaResult.data.title,
		description: metaResult.data.description,
		items
	};
}
