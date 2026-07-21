import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ExerciseQuestion, Lesson } from '$lib/lesson/types';
import { configRoot, dataRoot, lessonsDir } from './paths';

/** Error whose message is already user-presentable. */
export class ExerciseError extends Error {}

function configPath(): string {
	return join(configRoot(), 'config.yaml');
}

function workspacesRoot(): string {
	return join(dataRoot(), 'workspaces');
}

const EXAMPLE_CONFIG = [
	'# ~/.config/nex/config.yaml',
	'exercise:',
	'  # Shell command that opens a folder in your editor/multiplexer.',
	'  # {dir} and {name} are replaced with the (shell-quoted) workspace path',
	'  # and a human-readable title.',
	'  launch: zellij action new-tab --cwd {dir} --name {name}'
].join('\n');

async function readLaunchCommand(): Promise<string> {
	const path = configPath();
	let raw: string;
	try {
		raw = await readFile(path, 'utf-8');
	} catch {
		throw new ExerciseError(
			`No launch command configured. Create ${path} with:\n\n${EXAMPLE_CONFIG}`
		);
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (e) {
		throw new ExerciseError(`Could not parse ${path}: ${(e as Error).message}`);
	}
	const launch = (parsed as { exercise?: { launch?: unknown } })?.exercise?.launch;
	if (typeof launch !== 'string' || !launch.trim()) {
		throw new ExerciseError(
			`${path} is missing "exercise.launch". Expected something like:\n\n${EXAMPLE_CONFIG}`
		);
	}
	if (!launch.includes('{dir}')) {
		throw new ExerciseError(
			`The exercise.launch command in ${path} must contain a {dir} placeholder for the folder to open.`
		);
	}
	return launch;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Copy the exercise's template folder into the learner's workspace (first
 * launch only — later launches reuse it, preserving progress) and return the
 * workspace path.
 */
async function prepareWorkspace(lesson: Lesson, exercise: ExerciseQuestion): Promise<string> {
	const root = lessonsDir();
	const template = resolve(root, exercise.folder);
	if (!template.startsWith(root + '/')) {
		throw new ExerciseError(`Exercise folder escapes the lessons directory: ${exercise.folder}`);
	}
	try {
		const info = await stat(template);
		if (!info.isDirectory()) throw new Error('not a directory');
	} catch {
		throw new ExerciseError(
			`Exercise folder "${exercise.folder}" not found in the lessons directory (expected ${template}).`
		);
	}

	const workspace = join(workspacesRoot(), lesson.slug, exercise.id);
	try {
		await stat(workspace);
		return workspace; // already prepared — keep the learner's progress
	} catch {
		// first launch — fall through and copy
	}
	await mkdir(workspace, { recursive: true });
	await cp(template, workspace, { recursive: true });
	return workspace;
}

/** How long a launch command may run before we assume it succeeded. */
const LAUNCH_GRACE_MS = 2000;

async function runLaunchCommand(command: string, dir: string, name: string): Promise<void> {
	const rendered = command
		.replaceAll('{dir}', shellQuote(dir))
		.replaceAll('{name}', shellQuote(name));
	const child = spawn('sh', ['-c', rendered], {
		cwd: dir,
		stdio: ['ignore', 'ignore', 'pipe'],
		detached: true
	});
	let stderr = '';
	child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));

	// Fast failures (editor not found, no multiplexer session) surface to the
	// user; commands still running after the grace period are assumed to have
	// opened something and are left alone.
	const outcome = await new Promise<'ok' | 'failed' | 'running'>((resolvePromise) => {
		const timer = setTimeout(() => resolvePromise('running'), LAUNCH_GRACE_MS);
		child.on('error', () => {
			clearTimeout(timer);
			resolvePromise('failed');
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolvePromise(code === 0 ? 'ok' : 'failed');
		});
	});
	if (outcome === 'failed') {
		const detail = stderr.trim().split('\n').pop() || 'no error output';
		throw new ExerciseError(`The launch command failed: ${detail}`);
	}
	if (outcome === 'running') child.unref();
}

/**
 * Prepare the workspace for an exercise and open it with the user-configured
 * launch command. Returns the workspace path.
 */
export async function launchExercise(
	lesson: Lesson,
	exercise: ExerciseQuestion
): Promise<string> {
	const command = await readLaunchCommand();
	const workspace = await prepareWorkspace(lesson, exercise);
	await runLaunchCommand(command, workspace, `${lesson.slug}/${exercise.id}`);
	return workspace;
}
