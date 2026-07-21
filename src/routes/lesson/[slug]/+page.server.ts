import { error } from '@sveltejs/kit';
import { loadLesson } from '$lib/server/lessons';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { lesson: await loadLesson(params.slug) };
	} catch (e) {
		error(404, (e as Error).message);
	}
};
