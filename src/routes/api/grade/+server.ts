import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { describeApiError } from '$lib/server/anthropic';
import { completeJson, type ChatTurn } from '$lib/server/llm';
import { loadLesson } from '$lib/server/lessons';
import { GRADE_SCHEMA, graderSystem } from '$lib/server/prompts';
import type { GradeResult } from '$lib/lesson/types';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	slug: z.string(),
	questionId: z.string(),
	message: z.string().min(1),
	transcript: z
		.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
		.default([])
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = bodySchema.safeParse(await request.json());
	if (!parsed.success) {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}
	const { slug, questionId, message, transcript } = parsed.data;

	let lesson;
	try {
		lesson = await loadLesson(slug);
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 404 });
	}

	const question = lesson.items
		.flatMap((i) => (i.kind === 'question' ? [i.question] : []))
		.find((q) => q.id === questionId);
	if (!question || question.type !== 'free-response') {
		return json({ error: `No free-response question with id "${questionId}"` }, { status: 404 });
	}

	// Recent turns give the grader conversational context (e.g. a prior hint).
	const history = transcript.slice(-10).filter((t) => t.content.trim());
	while (history.length && history[0].role !== 'user') history.shift();

	const messages: ChatTurn[] = [
		...history,
		{ role: 'user', content: `The student's submission:\n\n${message}` }
	];

	try {
		const text = await completeJson({
			system: graderSystem(lesson, question),
			messages,
			schema: GRADE_SCHEMA
		});
		const raw = JSON.parse(text) as {
			kind: 'answer' | 'clarification';
			verdict: 'correct' | 'partial' | 'incorrect' | 'none';
			reply: string;
		};
		const result: GradeResult = {
			kind: raw.kind,
			verdict: raw.verdict === 'none' ? null : raw.verdict,
			reply: raw.reply
		};
		return json(result);
	} catch (e) {
		const { status, message: msg } = describeApiError(e);
		return json({ error: msg }, { status });
	}
};
