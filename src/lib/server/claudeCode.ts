import { spawn } from 'node:child_process';

/** Error whose message is already user-presentable. */
export class ClaudeCodeError extends Error {}

export interface ClaudeCodeRequest {
	system: string;
	prompt: string;
	model: string;
	/** Reasoning effort. Lower = faster time-to-first-token. */
	effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

const LOGIN_HINT =
	'Claude Code is not logged in. Run `claude` in a terminal, type /login to sign in with your subscription, then retry.';

/**
 * Run `claude -p` headlessly and yield assistant text as it streams.
 *
 * Uses the Claude Code CLI's own credentials (subscription login), so usage is
 * billed against the subscription rather than API token pricing. Tools,
 * settings sources (CLAUDE.md, hooks, MCP) and session persistence are all
 * disabled — this is a pure text-generation call.
 */
export async function* streamClaudeCode(req: ClaudeCodeRequest): AsyncGenerator<string> {
	// Strip ANTHROPIC_API_KEY so the CLI always uses its subscription login —
	// an exported key would silently switch billing back to API tokens.
	const { ANTHROPIC_API_KEY: _drop, ...childEnv } = process.env;

	const child = spawn(
		'claude',
		[
			'-p',
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
			req.model,
			...(req.effort ? ['--effort', req.effort] : []),
			'--system-prompt',
			req.system
		],
		{ env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] }
	);

	let stderr = '';
	child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

	const spawnFailed = new Promise<never>((_, reject) => {
		child.on('error', (e: NodeJS.ErrnoException) => {
			reject(
				new ClaudeCodeError(
					e.code === 'ENOENT'
						? 'Claude Code CLI (`claude`) was not found on PATH. Install it or set NEX_BACKEND=api.'
						: `Failed to launch the Claude Code CLI: ${e.message}`
				)
			);
		});
	});

	child.stdin.write(req.prompt);
	child.stdin.end();

	let sawDelta = false;
	let resultText: string | null = null;
	let resultError: string | null = null;
	let refused = false;
	let buffer = '';

	function* handleLine(line: string): Generator<string> {
		if (!line.trim()) return;
		let msg: {
			type: string;
			event?: {
				type: string;
				delta?: { type: string; text?: string; stop_reason?: string };
			};
			is_error?: boolean;
			result?: string;
		};
		try {
			msg = JSON.parse(line);
		} catch {
			return; // ignore non-JSON noise
		}
		if (msg.type === 'stream_event' && msg.event) {
			if (msg.event.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
				sawDelta = true;
				yield msg.event.delta.text ?? '';
			} else if (
				msg.event.type === 'message_delta' &&
				msg.event.delta?.stop_reason === 'refusal'
			) {
				refused = true;
			}
		} else if (msg.type === 'result') {
			if (msg.is_error) resultError = msg.result ?? 'Claude Code returned an error.';
			else resultText = msg.result ?? null;
		}
	}

	try {
		const reading = (async function* () {
			for await (const chunk of child.stdout) {
				buffer += chunk.toString();
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				yield* lines;
			}
			if (buffer) yield buffer;
		})();

		// Race stdout against spawn failure (ENOENT never produces output).
		const iterator = reading[Symbol.asyncIterator]();
		for (;;) {
			const next = await Promise.race([iterator.next(), spawnFailed]);
			if (next.done) break;
			yield* handleLine(next.value);
		}

		const exitCode = await new Promise<number | null>((resolve) =>
			child.on('close', resolve)
		);

		if (resultError) {
			throw new ClaudeCodeError(
				/not logged in/i.test(resultError) ? LOGIN_HINT : `Claude Code error: ${resultError}`
			);
		}
		if (exitCode !== 0) {
			const detail = stderr.trim().split('\n').pop() ?? `exit code ${exitCode}`;
			throw new ClaudeCodeError(`Claude Code failed: ${detail}`);
		}
		// Older CLIs (or a dropped stream) may deliver the text only in the
		// final result envelope.
		if (!sawDelta && resultText) yield resultText;
		if (refused) yield '\n\n_(The model declined to answer this request.)_';
	} finally {
		if (child.exitCode === null) child.kill('SIGTERM');
	}
}

/** Run a request to completion and return the full response text. */
export async function completeClaudeCode(req: ClaudeCodeRequest): Promise<string> {
	let out = '';
	for await (const chunk of streamClaudeCode(req)) out += chunk;
	return out;
}
