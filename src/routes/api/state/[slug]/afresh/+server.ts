import { json } from '@sveltejs/kit';
import { archiveState } from '$lib/server/history';
import { isValidSlug } from '$lib/server/lessons';
import type { RequestHandler } from './$types';

/** Archive the current run so the learner can go through the lesson afresh. */
export const POST: RequestHandler = async ({ params }) => {
	if (!isValidSlug(params.slug)) {
		return json({ error: 'Invalid lesson slug' }, { status: 400 });
	}
	return json({ archived: await archiveState(params.slug) });
};
