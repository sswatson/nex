import { homedir } from 'node:os';
import { join } from 'node:path';

/** Nex's per-user config directory (XDG): ~/.config/nex */
export function configRoot(): string {
	const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(base, 'nex');
}

/** Nex's per-user data directory (XDG): ~/.local/share/nex */
export function dataRoot(): string {
	const base = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
	return join(base, 'nex');
}

/**
 * The lesson library being served. The `nex` CLI sets NEX_LESSONS_DIR to serve
 * lessons from anywhere; a bare dev server falls back to ./lessons in the
 * checkout.
 */
export function lessonsDir(): string {
	return process.env.NEX_LESSONS_DIR || join(process.cwd(), 'lessons');
}
