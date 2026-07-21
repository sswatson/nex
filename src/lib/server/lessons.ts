import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseLesson } from '$lib/lesson/parse';
import type { Lesson, LessonSummary } from '$lib/lesson/types';
import { lessonsDir } from './paths';

export function isValidSlug(slug: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(slug) && !slug.includes('..');
}

export async function listLessons(): Promise<
	Array<LessonSummary | { slug: string; error: string }>
> {
	let files: string[];
	try {
		files = await readdir(lessonsDir());
	} catch {
		return [];
	}
	const summaries: Array<LessonSummary | { slug: string; error: string }> = [];
	for (const file of files.filter((f) => f.endsWith('.md')).sort()) {
		const slug = file.slice(0, -3);
		try {
			const lesson = await loadLesson(slug);
			summaries.push({
				slug,
				title: lesson.title,
				description: lesson.description,
				questionCount: lesson.items.filter((i) => i.kind === 'question').length
			});
		} catch (e) {
			summaries.push({ slug, error: (e as Error).message });
		}
	}
	return summaries;
}

export async function loadLesson(slug: string): Promise<Lesson> {
	if (!isValidSlug(slug)) {
		throw new Error(`Invalid lesson slug: ${slug}`);
	}
	const source = await readFile(join(lessonsDir(), `${slug}.md`), 'utf-8');
	return parseLesson(source, slug);
}
