import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { describeApiError } from '$lib/server/anthropic';
import { streamChat, type ChatTurn } from '$lib/server/llm';
import { loadLesson } from '$lib/server/lessons';
import { positionContext, tutorSystem } from '$lib/server/prompts';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	slug: z.string(),
	position: z.number().int().min(0),
	mode: z.enum(['detour', 'open-ended']),
	questionId: z.string().optional(),
	transcript: z
		.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
		.default([]),
	message: z.string().min(1)
});

const TRANSCRIPT_LIMIT = 40;

export const POST: RequestHandler = async ({ request }) => {
	const parsed = bodySchema.safeParse(await request.json());
	if (!parsed.success) {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}
	const { slug, position, mode, questionId, transcript, message } = parsed.data;

	let lesson;
	try {
		lesson = await loadLesson(slug);
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 404 });
	}

	const question =
		mode === 'open-ended'
			? lesson.items.flatMap((i) => (i.kind === 'question' ? [i.question] : [])).find(
					(q) => q.id === questionId
				)
			: undefined;

	const history: ChatTurn[] = transcript.slice(-TRANSCRIPT_LIMIT).filter((t) => t.content.trim());
	// The messages array must start with a user turn.
	while (history.length && history[0].role !== 'user') history.shift();

	try {
		const chunks = streamChat({
			system: tutorSystem(lesson),
			history,
			message,
			context: positionContext(lesson, position, mode, question),
			sessionKey: slug
		});
		// Awaiting the first chunk here means auth/model/rate-limit errors are
		// returned as JSON before any streaming begins.
		const first = await chunks.next();

		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				try {
					if (!first.done) controller.enqueue(encoder.encode(first.value));
					for await (const chunk of chunks) {
						controller.enqueue(encoder.encode(chunk));
					}
					controller.close();
				} catch (e) {
					controller.error(e);
				}
			},
			cancel() {
				void chunks.return(undefined);
			}
		});

		return new Response(body, {
			headers: {
				'content-type': 'text/plain; charset=utf-8',
				'cache-control': 'no-cache'
			}
		});
	} catch (e) {
		const { status, message: msg } = describeApiError(e);
		return json({ error: msg }, { status });
	}
};
