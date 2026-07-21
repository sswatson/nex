#!/usr/bin/env node
/**
 * Global launcher for Nex. Serves a lesson library from anywhere:
 *
 *   nex                 serve the cwd's lesson library (resolution below)
 *   nex <dir>           serve <dir>'s lesson library
 *
 * Library resolution, first match wins: <dir>/.nex/lessons (the convention
 * for lessons living inside the project they pertain to), <dir>/lessons,
 * <dir> itself.
 *   nex --port 4700     starting port (default 6767, or $NEX_PORT); if busy,
 *                       walks up to the next free port
 *   nex --no-open       don't open the browser
 *
 * Per-user state (history, workspaces, config) is machine-global and shared
 * across libraries — see the README.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
let dirArg = null;
let port = process.env.NEX_PORT || '6767';
let open = true;

for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === '--port') port = args[++i];
	else if (arg === '--no-open') open = false;
	else if (arg === '--help' || arg === '-h') {
		console.log('usage: nex [lessons-dir] [--port N] [--no-open]');
		process.exit(0);
	} else if (arg.startsWith('-')) {
		console.error(`unknown option: ${arg}`);
		process.exit(1);
	} else dirArg = arg;
}

const base = resolve(dirArg ?? '.');
if (!existsSync(base) || !statSync(base).isDirectory()) {
	console.error(`nex: not a directory: ${base}`);
	process.exit(1);
}
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const lessons =
	[join(base, '.nex', 'lessons'), join(base, 'lessons')].find(isDir) ?? base;
if (!readdirSync(lessons).some((f) => f.endsWith('.md'))) {
	console.warn(`nex: no .md lessons in ${lessons} yet — the picker will be empty`);
}

// A personal tool should not listen on the LAN (adapter-node defaults to
// 0.0.0.0). Override with HOST=0.0.0.0 if you really want that.
process.env.HOST ??= '127.0.0.1';

function portFree(candidate, host) {
	return new Promise((done) => {
		const probe = createServer();
		probe.once('error', () => done(false));
		probe.once('listening', () => probe.close(() => done(true)));
		probe.listen(candidate, host);
	});
}

// Walk up from the requested port until one is free.
const start = Number(port);
if (!Number.isInteger(start) || start < 1 || start > 65535) {
	console.error(`nex: invalid port: ${port}`);
	process.exit(1);
}
let chosen = start;
while (!(await portFree(chosen, process.env.HOST))) {
	chosen += 1;
	if (chosen - start >= 20 || chosen > 65535) {
		console.error(`nex: no free port found in ${start}–${chosen - 1}`);
		process.exit(1);
	}
}
if (chosen !== start) console.log(`nex: port ${start} is busy — using ${chosen}`);

process.env.NEX_LESSONS_DIR = lessons;
process.env.PORT = String(chosen);

const url = `http://localhost:${chosen}`;
console.log(`nex: serving ${lessons}`);
console.log(`nex: ${url}`);

await import('../build/index.js');

if (open) {
	const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
	setTimeout(() => {
		spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
	}, 500);
}
