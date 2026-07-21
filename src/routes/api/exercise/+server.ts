import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { ExerciseError, launchExercise } from '$lib/server/exercise';
import { loadLesson } from '$lib/server/lessons';
import type { RequestHandler } from './$types';

const bodySchema = z.object({
	slug: z.string(),
	questionId: z.string()
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = bodySchema.safeParse(await request.json());
	if (!parsed.success) {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}
	const { slug, questionId } = parsed.data;

	let lesson;
	try {
		lesson = await loadLesson(slug);
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 404 });
	}

	const exercise = lesson.items.flatMap((i) => (i.kind === 'question' ? [i.question] : [])).find(
		(q) => q.id === questionId
	);
	if (!exercise || exercise.type !== 'exercise') {
		return json({ error: `No exercise with id "${questionId}"` }, { status: 404 });
	}

	try {
		const dir = await launchExercise(lesson, exercise);
		return json({ dir });
	} catch (e) {
		if (e instanceof ExerciseError) {
			return json({ error: e.message }, { status: 500 });
		}
		return json({ error: (e as Error).message }, { status: 500 });
	}
};
