import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { loadLesson } from '$lib/server/lessons';
import { prewarmTerminalTarget } from '$lib/server/terminal';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	slug: z.string(),
	questionId: z.string()
});

/** Resolve a terminal target without sending text, so the visible button is fast. */
export const POST: RequestHandler = async ({ request }) => {
	const parsed = bodySchema.safeParse(await request.json());
	if (!parsed.success) return json({ error: 'Invalid request body' }, { status: 400 });
	try {
		const lesson = await loadLesson(parsed.data.slug);
		const terminal = lesson.items
			.flatMap((item) => (item.kind === 'question' ? [item.question] : []))
			.find((question) => question.id === parsed.data.questionId && question.type === 'terminal');
		if (!terminal || terminal.type !== 'terminal') {
			return json({ error: `No terminal step with id "${parsed.data.questionId}"` }, { status: 404 });
		}
		await prewarmTerminalTarget(terminal.target);
		return json({ ok: true });
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 500 });
	}
};
