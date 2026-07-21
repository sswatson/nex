import { json } from '@sveltejs/kit';
import { readState, writeState } from '$lib/server/history';
import { isValidSlug } from '$lib/server/lessons';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!isValidSlug(params.slug)) {
		return json({ error: 'Invalid lesson slug' }, { status: 400 });
	}
	return json(await readState(params.slug));
};

export const PUT: RequestHandler = async ({ params, request }) => {
	if (!isValidSlug(params.slug)) {
		return json({ error: 'Invalid lesson slug' }, { status: 400 });
	}
	let state: unknown;
	try {
		state = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const shape = state as { v?: unknown; entries?: unknown } | null;
	if (!shape || shape.v !== 1 || !Array.isArray(shape.entries)) {
		return json({ error: 'Not a recognized saved state' }, { status: 400 });
	}
	await writeState(params.slug, state);
	return json({ ok: true });
};
