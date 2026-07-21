import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ChatTurn } from '$lib/lesson/types';
import { ClaudeCodeError } from './claudeCode';

const LOGIN_HINT =
	'Claude Code is not logged in. Run `claude` in a terminal, type /login to sign in with your subscription, then retry.';

export interface SessionConfig {
	system: string;
	model: string;
	effort?: string;
}

const MAX_SESSIONS = 4;
const IDLE_MS = 15 * 60_000;
const SEEN_CAP = 80;

/**
 * A long-lived `claude -p --input-format stream-json` process holding one
 * lesson conversation. Turns are sent as JSON user messages over stdin; the
 * process keeps the conversation server-side, so repeated turns skip both CLI
 * startup and re-reading the transcript, and hit the prompt cache.
 */
export class TutorSession {
	readonly config: SessionConfig;
	/** Turns of the client transcript this session has incorporated. */
	seen: ChatTurn[] = [];
	lastUsed = Date.now();
	dead = false;

	#child: ChildProcessWithoutNullStreams;
	#lines: AsyncIterator<string>;
	#stderrTail = '';
	#spawnError: ClaudeCodeError | null = null;
	#inTurn = false;

	constructor(config: SessionConfig) {
		this.config = config;
		// Strip ANTHROPIC_API_KEY so the CLI always uses its subscription login.
		const { ANTHROPIC_API_KEY: _drop, ...childEnv } = process.env;
		this.#child = spawn(
			'claude',
			[
				'-p',
				'--input-format',
				'stream-json',
				'--output-format',
				'stream-json',
				'--include-partial-messages',
				'--verbose',
				'--no-session-persistence',
				'--setting-sources',
				'',
				'--tools',
				'',
				'--model',
				config.model,
				...(config.effort ? ['--effort', config.effort] : []),
				'--system-prompt',
				config.system
			],
			{ env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }
		);
		this.#child.on('error', (e: NodeJS.ErrnoException) => {
			this.#spawnError = new ClaudeCodeError(
				e.code === 'ENOENT'
					? 'Claude Code CLI (`claude`) was not found on PATH. Install it or set NEX_BACKEND=api.'
					: `Failed to launch the Claude Code CLI: ${e.message}`
			);
			this.dead = true;
		});
		this.#child.on('close', () => {
			this.dead = true;
		});
		this.#child.stderr.on('data', (d: Buffer) => {
			this.#stderrTail = (this.#stderrTail + d.toString()).slice(-2000);
		});
		this.#lines = lineIterator(this.#child.stdout);
	}

	/** Send one user turn and yield assistant text as it streams. */
	async *send(prompt: string): AsyncGenerator<string> {
		if (this.#inTurn) {
			throw new ClaudeCodeError(
				'The tutor is still responding to an earlier message — try again in a moment.'
			);
		}
		if (this.dead) {
			throw this.#spawnError ?? new ClaudeCodeError('The tutor session has ended — retry.');
		}
		this.#inTurn = true;
		let completed = false;
		try {
			this.#child.stdin.write(
				JSON.stringify({
					type: 'user',
					message: { role: 'user', content: [{ type: 'text', text: prompt }] }
				}) + '\n'
			);

			let sawDelta = false;
			for (;;) {
				const next = await this.#lines.next();
				if (next.done) {
					const detail = this.#stderrTail.trim().split('\n').pop();
					throw (
						this.#spawnError ??
						new ClaudeCodeError(`Claude Code exited unexpectedly: ${detail || 'no error output'}`)
					);
				}
				if (!next.value.trim()) continue;
				let msg: {
					type: string;
					event?: { type: string; delta?: { type: string; text?: string; stop_reason?: string } };
					is_error?: boolean;
					result?: string;
				};
				try {
					msg = JSON.parse(next.value);
				} catch {
					continue;
				}
				if (msg.type === 'stream_event' && msg.event) {
					if (
						msg.event.type === 'content_block_delta' &&
						msg.event.delta?.type === 'text_delta'
					) {
						sawDelta = true;
						yield msg.event.delta.text ?? '';
					} else if (
						msg.event.type === 'message_delta' &&
						msg.event.delta?.stop_reason === 'refusal'
					) {
						yield '\n\n_(The model declined to answer this request.)_';
					}
				} else if (msg.type === 'result') {
					if (msg.is_error) {
						const reason = msg.result ?? 'unknown error';
						throw new ClaudeCodeError(
							/not logged in/i.test(reason) ? LOGIN_HINT : `Claude Code error: ${reason}`
						);
					}
					if (!sawDelta && msg.result) yield msg.result;
					completed = true;
					return;
				}
			}
		} finally {
			this.#inTurn = false;
			// An aborted or failed turn leaves unread events in the pipe, which
			// would corrupt the next turn — retire the session instead.
			if (!completed) this.kill();
		}
	}

	/** Record the client-transcript turns this session now embodies. */
	incorporate(history: ChatTurn[], message: string, reply: string): void {
		this.seen = [
			...history,
			{ role: 'user' as const, content: message },
			{ role: 'assistant' as const, content: reply }
		].slice(-SEEN_CAP);
	}

	kill(): void {
		this.dead = true;
		if (this.#child.exitCode === null) this.#child.kill('SIGTERM');
	}
}

async function* lineIterator(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
	let buffer = '';
	for await (const chunk of stream) {
		buffer += chunk.toString();
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		yield* lines;
	}
	if (buffer) yield buffer;
}

/**
 * Turns of `clientHistory` the session hasn't incorporated yet, or null when
 * the histories diverge (lesson restarted, another tab, edited transcript) —
 * the caller should then replace the session.
 */
export function historyDelta(seen: ChatTurn[], clientHistory: ChatTurn[]): ChatTurn[] | null {
	if (seen.length === 0) return clientHistory;
	const eq = (a: ChatTurn, b: ChatTurn): boolean =>
		a.role === b.role && a.content.trim() === b.content.trim();
	const anchor = seen[seen.length - 1];
	for (let i = clientHistory.length - 1; i >= 0; i--) {
		if (!eq(clientHistory[i], anchor)) continue;
		let matches = true;
		for (let j = 1; j <= Math.min(i, seen.length - 1); j++) {
			if (!eq(clientHistory[i - j], seen[seen.length - 1 - j])) {
				matches = false;
				break;
			}
		}
		if (matches) return clientHistory.slice(i + 1);
	}
	return null;
}

// The registry lives on globalThis so Vite dev-server module reloads don't
// orphan running CLI processes.
const registry: Map<string, TutorSession> = ((
	globalThis as unknown as { __nexTutorSessions?: Map<string, TutorSession> }
).__nexTutorSessions ??= new Map());

function sameConfig(a: SessionConfig, b: SessionConfig): boolean {
	return a.system === b.system && a.model === b.model && a.effort === b.effort;
}

export function getTutorSession(key: string, config: SessionConfig): TutorSession {
	const now = Date.now();
	for (const [k, s] of registry) {
		if (s.dead || now - s.lastUsed > IDLE_MS) {
			s.kill();
			registry.delete(k);
		}
	}
	let session = registry.get(key);
	if (session && !sameConfig(session.config, config)) {
		session.kill();
		registry.delete(key);
		session = undefined;
	}
	if (!session) {
		while (registry.size >= MAX_SESSIONS) {
			let oldest: string | undefined;
			for (const [k, s] of registry) {
				if (oldest === undefined || s.lastUsed < registry.get(oldest)!.lastUsed) oldest = k;
			}
			if (oldest === undefined) break;
			registry.get(oldest)!.kill();
			registry.delete(oldest);
		}
		session = new TutorSession(config);
		registry.set(key, session);
	}
	session.lastUsed = now;
	return session;
}

export function dropTutorSession(key: string): void {
	const session = registry.get(key);
	if (session) {
		session.kill();
		registry.delete(key);
	}
}
