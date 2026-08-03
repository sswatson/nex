import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';
import type { TerminalQuestion } from '$lib/lesson/types';
import { configRoot } from './paths';

/** Error whose message is already user-presentable. */
export class TerminalError extends Error {}

const execFileAsync = promisify(execFile);

// Looking through every tab and pane can take several seconds in a busy
// Zellij session. Pane ids remain stable for a running pane, so retain the
// result and discard it if a later send reports a failure.
const zellijPaneCache = new Map<string, string>();

function configPath(): string {
	return join(configRoot(), 'config.yaml');
}

const EXAMPLE_CONFIG = [
	'# ~/.config/nex/config.yaml',
	'terminal:',
	'  targets:',
	'    # The key is referenced by a terminal question\'s target field. Nex finds',
	'    # the live pane by its visible tab and pane titles on every send.',
	'    matlab:',
	'      zellij:',
	'        tab: matlab',
	'        pane: matlab'
].join('\n');

interface ZellijTarget {
	tab: string;
	pane: string;
	enter: boolean;
}

type TerminalTarget = { kind: 'command'; command: string } | { kind: 'zellij'; zellij: ZellijTarget };

function parseZellijTarget(value: unknown): ZellijTarget | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const zellij = (value as { zellij?: unknown }).zellij;
	if (!zellij || typeof zellij !== 'object' || Array.isArray(zellij)) return null;
	const { tab, pane, enter } = zellij as { tab?: unknown; pane?: unknown; enter?: unknown };
	if (typeof tab !== 'string' || !tab.trim() || typeof pane !== 'string' || !pane.trim()) return null;
	if (enter !== undefined && typeof enter !== 'boolean') return null;
	return { tab, pane, enter: enter ?? true };
}

async function readTarget(target: string): Promise<TerminalTarget> {
	const path = configPath();
	let raw: string;
	try {
		raw = await readFile(path, 'utf-8');
	} catch {
		throw new TerminalError(
			`No terminal target configured. Create ${path} with:\n\n${EXAMPLE_CONFIG}`
		);
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(raw);
	} catch (e) {
		throw new TerminalError(`Could not parse ${path}: ${(e as Error).message}`);
	}
	const targets = (parsed as { terminal?: { targets?: unknown } })?.terminal?.targets;
	if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
		throw new TerminalError(
			`${path} is missing "terminal.targets". Expected something like:\n\n${EXAMPLE_CONFIG}`
		);
	}
	const value = (targets as Record<string, unknown>)[target];
	if (value === undefined) {
		throw new TerminalError(
			`No terminal target named "${target}" in ${path}. Add it under "terminal.targets".`
		);
	}
	if (typeof value === 'string' && value.trim()) {
		if (!value.includes('{text}')) {
			throw new TerminalError(
				`The terminal target "${target}" in ${path} must contain a {text} placeholder.`
			);
		}
		return { kind: 'command', command: value };
	}
	const zellij = parseZellijTarget(value);
	if (zellij) return { kind: 'zellij', zellij };
	throw new TerminalError(
		`The terminal target "${target}" in ${path} must be a command string with {text}, or a zellij target with non-empty "tab" and "pane" names.`
	);
}

interface ZellijPane {
	id: number | string;
	is_plugin: boolean;
	exited: boolean;
	tab_name: string;
	title: string;
}

export function findZellijPane(panes: ZellijPane[], target: ZellijTarget): ZellijPane {
	const matches = panes.filter(
		(pane) =>
			!pane.is_plugin &&
			!pane.exited &&
			pane.tab_name === target.tab &&
			pane.title === target.pane
	);
	if (matches.length === 1) return matches[0];
	if (matches.length === 0) {
		throw new TerminalError(
			`No live Zellij pane named "${target.pane}" in tab "${target.tab}". Rename or open that pane, then try again.`
		);
	}
	throw new TerminalError(
		`Zellij found ${matches.length} live panes named "${target.pane}" in tab "${target.tab}". Give the target pane a unique title.`
	);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function zellijTargetKey(target: ZellijTarget): string {
	return `${target.tab}\0${target.pane}`;
}

async function resolveZellijPaneId(target: ZellijTarget): Promise<{ paneId: string; cached: boolean }> {
	const key = zellijTargetKey(target);
	const cachedPaneId = zellijPaneCache.get(key);
	if (cachedPaneId) return { paneId: cachedPaneId, cached: true };

	let panes: ZellijPane[];
	try {
		const { stdout } = await execFileAsync('zellij', ['action', 'list-panes', '--json', '--all']);
		panes = JSON.parse(stdout) as ZellijPane[];
	} catch (e) {
		throw new TerminalError(`Could not list Zellij panes: ${(e as Error).message}`);
	}
	const paneId = String(findZellijPane(panes, target).id);
	zellijPaneCache.set(key, paneId);
	return { paneId, cached: false };
}

async function injectIntoZellij(target: ZellijTarget, text: string): Promise<void> {
	const { paneId, cached } = await resolveZellijPaneId(target);
	try {
		await execFileAsync('zellij', ['action', 'write-chars', '--pane-id', paneId, text]);
		if (target.enter) {
			await execFileAsync('zellij', ['action', 'send-keys', '--pane-id', paneId, 'Enter']);
		}
	} catch (e) {
		if (cached) zellijPaneCache.delete(zellijTargetKey(target));
		throw new TerminalError(`Could not send text to Zellij pane "${target.pane}": ${(e as Error).message}`);
	}
}

/** Resolve a named target ahead of a send, without writing to its pane. */
export async function prewarmTerminalTarget(targetName: string): Promise<void> {
	const target = await readTarget(targetName);
	if (target.kind === 'zellij') await resolveZellijPaneId(target.zellij);
}

/** Send text to the named target through the user-configured command. */
export async function injectTerminalText(terminal: TerminalQuestion): Promise<void> {
	const target = await readTarget(terminal.target);
	if (target.kind === 'zellij') {
		await injectIntoZellij(target.zellij, terminal.text);
		return;
	}
	const rendered = target.command.replaceAll('{text}', shellQuote(terminal.text));
	const child = spawn('sh', ['-c', rendered], { stdio: ['ignore', 'ignore', 'pipe'] });
	let stderr = '';
	child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));

	const outcome = await new Promise<'ok' | 'failed'>((resolve) => {
		child.on('error', () => resolve('failed'));
		child.on('close', (code) => resolve(code === 0 ? 'ok' : 'failed'));
	});
	if (outcome === 'failed') {
		const detail = stderr.trim().split('\n').pop() || 'no error output';
		throw new TerminalError(`The terminal command for "${terminal.target}" failed: ${detail}`);
	}
}
