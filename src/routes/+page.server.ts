import { listLessons } from '$lib/server/lessons';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { lessons: await listLessons() };
};
