import { existsSync, readdirSync, readFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataRoot } from './paths';

/**
 * Durable lesson progression history, stored in SQLite at
 * ~/.local/share/nex/history.db. Each row of `runs` is one pass through a
 * lesson: the active run has archived_at IS NULL (at most one per lesson);
 * "start afresh" archives the row instead of deleting it, so a
 * borked-but-valued transcript can always be recovered:
 *
 *   sqlite3 history.db "SELECT id, slug, archived_at FROM runs"
 *   sqlite3 history.db "UPDATE runs SET archived_at = NULL WHERE id = <id>"
 */

const globals = globalThis as unknown as { __nexHistoryDb?: DatabaseSync };

function iso(): string {
	return new Date().toISOString();
}

function db(): DatabaseSync {
	if (globals.__nexHistoryDb) return globals.__nexHistoryDb;
	mkdirSync(dataRoot(), { recursive: true });
	const database = new DatabaseSync(join(dataRoot(), 'history.db'));
	database.exec(`
		PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			slug TEXT NOT NULL,
			state TEXT NOT NULL,
			started_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			archived_at TEXT
		);
		CREATE UNIQUE INDEX IF NOT EXISTS runs_current ON runs(slug) WHERE archived_at IS NULL;
		CREATE INDEX IF NOT EXISTS runs_by_slug ON runs(slug);
	`);
	importLegacyJson(database);
	globals.__nexHistoryDb = database;
	return database;
}

/** One-time import of the earlier JSON-file store (history/<slug>/*.json). */
function importLegacyJson(database: DatabaseSync): void {
	const legacyDir = join(dataRoot(), 'history');
	if (!existsSync(legacyDir)) return;
	const insert = database.prepare(
		`INSERT OR IGNORE INTO runs (slug, state, started_at, updated_at, archived_at)
		 VALUES (?, ?, ?, ?, ?)`
	);
	database.exec('BEGIN');
	try {
		for (const dirent of readdirSync(legacyDir, { withFileTypes: true })) {
			if (!dirent.isDirectory()) continue;
			const slug = dirent.name;
			for (const file of readdirSync(join(legacyDir, slug))) {
				if (!file.endsWith('.json')) continue;
				const path = join(legacyDir, slug, file);
				let state: string;
				try {
					state = readFileSync(path, 'utf-8');
					JSON.parse(state); // only import intact files
				} catch {
					continue;
				}
				const mtime = statSync(path).mtime.toISOString();
				// Archive filenames encode their timestamp with dashes for
				// filesystem safety: 2026-07-18T21-00-32-342Z → real ISO.
				const stem = file.slice(0, -'.json'.length);
				const m = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stem);
				const archivedAt =
					file === 'current.json' ? null : m ? `${m[1]}:${m[2]}:${m[3]}.${m[4]}Z` : mtime;
				insert.run(slug, state, mtime, mtime, archivedAt);
			}
		}
		database.exec('COMMIT');
	} catch (e) {
		database.exec('ROLLBACK');
		throw e;
	}
	renameSync(legacyDir, legacyDir + '.imported-to-sqlite');
}

export async function readState(slug: string): Promise<unknown | null> {
	const row = db()
		.prepare('SELECT state FROM runs WHERE slug = ? AND archived_at IS NULL')
		.get(slug) as { state: string } | undefined;
	if (!row) return null;
	try {
		return JSON.parse(row.state) as unknown;
	} catch {
		return null;
	}
}

export async function writeState(slug: string, state: unknown): Promise<void> {
	const now = iso();
	db()
		.prepare(
			`INSERT INTO runs (slug, state, started_at, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT (slug) WHERE archived_at IS NULL
			 DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`
		)
		.run(slug, JSON.stringify(state), now, now);
}

/** Archive the active run (if any). Returns its archive timestamp, or null. */
export async function archiveState(slug: string): Promise<string | null> {
	const now = iso();
	const result = db()
		.prepare('UPDATE runs SET archived_at = ? WHERE slug = ? AND archived_at IS NULL')
		.run(now, slug);
	return result.changes > 0 ? now : null;
}
