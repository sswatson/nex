import { describe, expect, it } from 'vitest';
import { LessonParseError, parseLesson } from './parse';

const FULL_LESSON = `---
title: Test Lesson
description: A lesson for tests.
---

# Welcome

This is the first paragraph.

This is the second paragraph, with $x^2$ math.

\`\`\`question
type: multiple-choice
prompt: What is $2 + 2$?
choices:
  - text: "3"
    explanation: Off by one.
  - text: "4"
    correct: true
\`\`\`

\`\`\`python
print("a normal code block, not a question")
\`\`\`

\`\`\`question
type: free-response
prompt: Explain why the sky is blue.
criteria: Mentions Rayleigh scattering or wavelength-dependent scattering.
sample_answer: Shorter wavelengths scatter more strongly off air molecules.
\`\`\`

\`\`\`question
type: open-ended
id: reflect
prompt: What did you find surprising?
\`\`\`

That's all!
`;

describe('parseLesson', () => {
	it('parses frontmatter', () => {
		const lesson = parseLesson(FULL_LESSON, 'test');
		expect(lesson.title).toBe('Test Lesson');
		expect(lesson.description).toBe('A lesson for tests.');
		expect(lesson.slug).toBe('test');
	});

	it('chunks exposition per block, attaching headings to the next block', () => {
		const lesson = parseLesson(FULL_LESSON, 'test');
		const expositions = lesson.items.filter((i) => i.kind === 'exposition');
		expect(expositions[0].markdown).toContain('# Welcome');
		expect(expositions[0].markdown).toContain('first paragraph');
		expect(expositions[1].markdown).toBe('This is the second paragraph, with $x^2$ math.');
	});

	it('keeps a blank line between a heading and the following block', () => {
		const lesson = parseLesson(FULL_LESSON, 'test');
		const first = lesson.items[0];
		if (first.kind !== 'exposition') throw new Error('expected exposition');
		// The heading must stay on its own line so it still parses as a heading.
		expect(first.markdown).toMatch(/^# Welcome\n\nThis is the first paragraph\./);
	});

	it('treats non-question code fences as exposition', () => {
		const lesson = parseLesson(FULL_LESSON, 'test');
		const code = lesson.items.find(
			(i) => i.kind === 'exposition' && i.markdown.includes('print(')
		);
		expect(code).toBeDefined();
	});

	it('parses all three question types with auto and explicit ids', () => {
		const lesson = parseLesson(FULL_LESSON, 'test');
		const questions = lesson.items.filter((i) => i.kind === 'question').map((i) => i.question);
		expect(questions.map((q) => q.type)).toEqual([
			'multiple-choice',
			'free-response',
			'open-ended'
		]);
		expect(questions[0].id).toBe('q1');
		expect(questions[2].id).toBe('reflect');
		if (questions[0].type === 'multiple-choice') {
			expect(questions[0].choices[1].correct).toBe(true);
			expect(questions[0].choices[0].correct).toBe(false);
			expect(questions[0].choices[0].explanation).toBe('Off by one.');
		}
	});

	it('preserves item order between exposition and questions', () => {
		const lesson = parseLesson(FULL_LESSON, 'test');
		const kinds = lesson.items.map((i) => i.kind);
		expect(kinds[kinds.length - 1]).toBe('exposition'); // "That's all!"
		expect(kinds).toContain('question');
	});

	it('rejects a lesson without a title', () => {
		expect(() => parseLesson('Just some text.', 'x')).toThrow(LessonParseError);
	});

	it('rejects multiple-choice with no correct answer', () => {
		const bad = `---
title: Bad
---
\`\`\`question
type: multiple-choice
prompt: Pick one.
choices:
  - text: a
  - text: b
\`\`\`
`;
		expect(() => parseLesson(bad, 'x')).toThrow(/correct: true/);
	});

	it('rejects free-response with neither criteria nor sample_answer', () => {
		const bad = `---
title: Bad
---
\`\`\`question
type: free-response
prompt: Explain.
\`\`\`
`;
		expect(() => parseLesson(bad, 'x')).toThrow(/criteria/);
	});

	it('rejects unknown question types with a useful message', () => {
		const bad = `---
title: Bad
---
\`\`\`question
type: fill-in-the-blank
prompt: ____
\`\`\`
`;
		expect(() => parseLesson(bad, 'x')).toThrow(LessonParseError);
	});

	it('rejects duplicate question ids', () => {
		const bad = `---
title: Bad
---
\`\`\`question
type: open-ended
id: dup
prompt: One?
\`\`\`

\`\`\`question
type: open-ended
id: dup
prompt: Two?
\`\`\`
`;
		expect(() => parseLesson(bad, 'x')).toThrow(/Duplicate/);
	});

	it('splits chunks at horizontal rules', () => {
		const src = `---
title: HR
---
# Only a heading

---

After the rule.
`;
		const lesson = parseLesson(src, 'x');
		expect(lesson.items.length).toBe(2);
	});
});

describe('exercise questions', () => {
	const wrap = (yaml: string) => `---
title: Ex
---
Intro.

\`\`\`question
${yaml}
\`\`\`
`;

	it('parses an exercise block', () => {
		const lesson = parseLesson(
			wrap(`type: exercise
id: warmup
prompt: Do the thing.
folder: my-lesson/warmup
context: Guidance here.`),
			'x'
		);
		const item = lesson.items.find((i) => i.kind === 'question');
		expect(item?.kind === 'question' && item.question).toMatchObject({
			type: 'exercise',
			id: 'warmup',
			folder: 'my-lesson/warmup',
			context: 'Guidance here.'
		});
	});

	it('rejects absolute folder paths', () => {
		expect(() =>
			parseLesson(wrap(`type: exercise\nprompt: P\nfolder: /etc`), 'x')
		).toThrow(/relative path/);
	});

	it('rejects folder paths containing ..', () => {
		expect(() =>
			parseLesson(wrap(`type: exercise\nprompt: P\nfolder: ../../secrets`), 'x')
		).toThrow(/\.\./);
	});

	it('requires a folder', () => {
		expect(() => parseLesson(wrap(`type: exercise\nprompt: P`), 'x')).toThrow(/invalid/i);
	});
});

describe('terminal questions', () => {
	const wrap = (yaml: string) => `---
title: Terminal
---
\`\`\`question
${yaml}
\`\`\`
`;

	it('parses a named terminal target and text', () => {
		const lesson = parseLesson(
			wrap(`type: terminal
id: matlab-step
prompt: Plot the signal.
target: matlab
text: disp(1 + 1)`),
			'x'
		);
		const item = lesson.items.find((i) => i.kind === 'question');
		expect(item?.kind === 'question' && item.question).toMatchObject({
			type: 'terminal',
			id: 'matlab-step',
			target: 'matlab',
			text: 'disp(1 + 1)',
			showText: true
		});
	});

	it('can hide a terminal snippet from the chat', () => {
		const lesson = parseLesson(
			wrap('type: terminal\nprompt: P\ntarget: matlab\ntext: x\nshow_text: false'),
			'x'
		);
		const item = lesson.items.find((i) => i.kind === 'question');
		expect(item?.kind === 'question' && item.question.type === 'terminal' && item.question.showText).toBe(
			false
		);
	});

	it('requires a safe named target and non-empty text', () => {
		expect(() =>
			parseLesson(wrap('type: terminal\nprompt: P\ntarget: matlab pane\ntext: x'), 'x')
		).toThrow(/target/);
		expect(() => parseLesson(wrap('type: terminal\nprompt: P\ntarget: matlab\ntext: ""'), 'x')).toThrow(
			/invalid/i
		);
	});
});
