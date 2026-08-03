import type Anthropic from '@anthropic-ai/sdk';
import type { Lesson, Question } from '$lib/lesson/types';

function describeQuestion(q: Question): string {
	const lines = [`Question id: ${q.id}`, `Type: ${q.type}`, `Prompt: ${q.prompt}`];
	if (q.type === 'multiple-choice') {
		for (const [i, c] of q.choices.entries()) {
			lines.push(
				`Choice ${i + 1}: ${c.text}${c.correct ? ' [CORRECT]' : ''}${c.explanation ? ` — explanation: ${c.explanation}` : ''}`
			);
		}
	} else if (q.type === 'free-response') {
		if (q.criteria) lines.push(`Grading criteria: ${q.criteria}`);
		if (q.sampleAnswer) lines.push(`Sample answer: ${q.sampleAnswer}`);
	} else if (q.type === 'exercise') {
		lines.push(
			`Exercise folder: ${q.folder} — the app copies it to a workspace and opens it in the student's own editor; they work there and press Continue when done. You cannot see their files; help from the exercise description and what they tell you.`
		);
		if (q.context) lines.push(`Guidance for helping with this exercise: ${q.context}`);
	} else if (q.type === 'terminal') {
		lines.push(
			`Terminal target: ${q.target}. The learner may send this text to their configured terminal target, then inspect the result:\n${q.text}`
		);
		if (q.context) lines.push(`Guidance for helping with this terminal step: ${q.context}`);
	} else if (q.context) {
		lines.push(`Discussion guidance for the tutor: ${q.context}`);
	}
	return lines.join('\n');
}

/** Render the full lesson script with segment markers, for the system prompt. */
export function renderLessonScript(lesson: Lesson): string {
	const parts: string[] = [];
	for (const [i, item] of lesson.items.entries()) {
		if (item.kind === 'exposition') {
			parts.push(`--- segment ${i + 1} (exposition) ---\n${item.markdown}`);
		} else {
			parts.push(`--- segment ${i + 1} (question) ---\n${describeQuestion(item.question)}`);
		}
	}
	return parts.join('\n\n');
}

const TUTOR_INSTRUCTIONS = `You are Nex, a tutor guiding a student through a scripted lesson in a chat interface. The lesson script is delivered to the student verbatim, one segment at a time, by the application — not by you. You are invoked only when the student engages beyond the script: asking a question, responding to an open-ended prompt, or needing help.

Ground rules:
- Answer in the spirit of the lesson. Connect explanations to material the student has already seen when possible.
- The student has only seen segments up to their current position (given in each request). Do not reveal or reference upcoming material as if they had seen it. If they ask about something covered later, you may give a brief answer and mention that the lesson will cover it in more depth shortly.
- Never reveal the answer to a question the student has not yet answered, unless they explicitly ask for it after making an attempt — prefer hints that let them get there themselves.
- Keep responses conversational and reasonably short: this is a chat, not an essay. A few sentences to a few short paragraphs.
- Use markdown. Math goes in $...$ (inline) or $$...$$ (display) LaTeX. Code goes in fenced code blocks. A fenced block tagged \`mermaid\` renders as a diagram — use one when a picture (flowchart, sequence, state, tree) explains better than prose.
- If the student seems to want to move on, gently point them back to the lesson: they can press Continue to resume the script.`;

export function tutorSystem(lesson: Lesson): Anthropic.Messages.MessageCreateParams['system'] {
	return [
		{ type: 'text', text: TUTOR_INSTRUCTIONS },
		{
			type: 'text',
			text: `Lesson title: ${lesson.title}\n\nFull lesson script (for your reference only — the app delivers it to the student):\n\n${renderLessonScript(lesson)}`,
			cache_control: { type: 'ephemeral' }
		}
	];
}

/** Context prefix attached to the student's latest message. */
export function positionContext(
	lesson: Lesson,
	position: number,
	mode: 'detour' | 'open-ended',
	question?: Question
): string {
	const total = lesson.items.length;
	const seen = Math.min(Math.max(position, 0), total);
	let ctx = `<context>The student is at segment ${seen} of ${total}; they have seen segments 1 through ${seen} only.`;
	if (mode === 'open-ended' && question) {
		ctx += ` They are responding to the open-ended question "${question.id}". Engage thoughtfully with their response — there is no right answer. React to their specific ideas, add a brief insight or perspective they might not have considered, then let them know they can continue the lesson when ready.`;
	} else {
		ctx += ` The student typed a message that departs from the script (an off-script question or comment). Respond helpfully, then remind them they can press Continue to pick the lesson back up.`;
	}
	ctx += `</context>`;
	return ctx;
}

export const GRADE_SCHEMA = {
	type: 'object',
	properties: {
		kind: {
			type: 'string',
			enum: ['answer', 'clarification'],
			description:
				'"answer" if the student attempted to answer the question; "clarification" if they instead asked a question or said something else that is not an attempt.'
		},
		verdict: {
			type: 'string',
			enum: ['correct', 'partial', 'incorrect', 'none'],
			description:
				'Assessment of the attempt. Use "none" when kind is "clarification".'
		},
		reply: {
			type: 'string',
			description:
				'Markdown message shown to the student: feedback on their answer (what they got right, what is missing or wrong, in an encouraging tone), or the response to their clarification question. Use $...$ LaTeX for math. Keep it to a few sentences.'
		}
	},
	required: ['kind', 'verdict', 'reply'],
	additionalProperties: false
} as const;

export function graderSystem(lesson: Lesson, question: Question): string {
	const parts = [
		`You are Nex, a tutor evaluating a student's free-response answer within the lesson "${lesson.title}".`,
		'',
		'The question under evaluation:',
		describeQuestion(question),
		'',
		'Evaluate the student\'s message:',
		'- If it is an attempt at answering, grade it against the criteria/sample answer: "correct" (captures the key idea, even if worded differently), "partial" (on the right track but missing something important), or "incorrect". Write encouraging, specific feedback. For partial/incorrect answers, point at what to reconsider without simply giving the answer away.',
		'- If it is instead a clarification question or an off-topic remark (kind "clarification"), answer it helpfully without revealing the answer, and invite them to try the question.',
		'- Judge substance, not style: terse answers, informal phrasing, and minor typos are fine.',
		'- Use markdown; math in $...$ LaTeX.'
	];
	return parts.join('\n');
}
