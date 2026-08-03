import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { loadLesson } from '$lib/server/lessons';
import { injectTerminalText } from '$lib/server/terminal';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	slug: z.string(),
	questionId: z.string()
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = bodySchema.safeParse(await request.json());
	if (!parsed.success) return json({ error: 'Invalid request body' }, { status: 400 });
	const { slug, questionId } = parsed.data;

	let lesson;
	try {
		lesson = await loadLesson(slug);
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 404 });
	}
	const terminal = lesson.items
		.flatMap((i) => (i.kind === 'question' ? [i.question] : []))
		.find((q) => q.id === questionId && q.type === 'terminal');
	if (!terminal || terminal.type !== 'terminal') {
		return json({ error: `No terminal step with id "${questionId}"` }, { status: 404 });
	}

	try {
		await injectTerminalText(terminal);
		return json({ ok: true });
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 500 });
	}
};
