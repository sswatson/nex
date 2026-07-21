import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { lessonsDir } from '$lib/server/paths';
import type { RequestHandler } from './$types';

// Assets referenced from lesson markdown: images, plus the files an embedded
// widget needs (html/css/js/json/wasm). Everything else in a lesson directory
// (exercise sources, the lesson .md itself) stays unserved.
const CONTENT_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	avif: 'image/avif',
	html: 'text/html; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	json: 'application/json',
	wasm: 'application/wasm'
};

export const GET: RequestHandler = async ({ params }) => {
	const relative = params.path;
	const extension = relative.split('.').pop()?.toLowerCase() ?? '';
	const contentType = CONTENT_TYPES[extension];
	if (!contentType) throw error(404, 'Not found');

	const root = lessonsDir();
	const path = resolve(root, relative);
	if (!path.startsWith(root + '/')) throw error(404, 'Not found');

	let body: Buffer;
	try {
		body = await readFile(path);
	} catch {
		throw error(404, 'Not found');
	}
	const headers: Record<string, string> = {
		'content-type': contentType,
		// Lessons are editable on disk in dev; don't let stale assets stick.
		'cache-control': 'no-cache'
	};
	// Widget documents get a null origin even when opened directly, matching
	// the iframe's sandbox attribute — lesson widgets never run with access to
	// the app's storage or API.
	if (extension === 'html') {
		headers['content-security-policy'] = 'sandbox allow-scripts';
	}
	return new Response(new Uint8Array(body), { headers });
};
