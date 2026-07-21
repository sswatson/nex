import type Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { getClient, getModel } from './anthropic';
import { completeClaudeCode } from './claudeCode';
import { dropTutorSession, getTutorSession, historyDelta } from './claudeSession';

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

type SystemPrompt = Anthropic.Messages.MessageCreateParams['system'];

/**
 * Which LLM backend to use:
 * - 'claude-code' (default): shell out to the Claude Code CLI headlessly.
 *   Uses the subscription login — no API token pricing.
 * - 'api': call the Anthropic API directly with ANTHROPIC_API_KEY.
 */
export function getBackend(): 'claude-code' | 'api' {
	return env.NEX_BACKEND === 'api' ? 'api' : 'claude-code';
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORT_LEVELS)[number];

/**
 * Reasoning effort for tutoring and grading. Defaults to 'low': replies are
 * short and grounded in the lesson script, and low effort roughly halves
 * time-to-first-token (Claude Code would otherwise default to xhigh).
 */
function getEffort(): Effort {
	const value = env.NEX_EFFORT as Effort | undefined;
	return value && EFFORT_LEVELS.includes(value) ? value : 'low';
}

function flattenSystem(system: SystemPrompt): string {
	if (typeof system === 'string') return system;
	return (system ?? []).map((b) => b.text).join('\n\n');
}

/**
 * The CLI takes a single prompt, so prior turns are rendered into it as a
 * transcript block ahead of the current message.
 */
function renderPrompt(messages: ChatTurn[]): string {
	const current = messages[messages.length - 1];
	const history = messages.slice(0, -1);
	if (history.length === 0) return current.content;
	const rendered = history
		.map((t) => `${t.role === 'user' ? 'Student' : 'Nex (you)'}: ${t.content}`)
		.join('\n\n');
	return `<conversation_history>\n${rendered}\n</conversation_history>\n\nThe student's latest message follows. Reply to it directly (do not prefix your reply with a speaker label).\n\n${current.content}`;
}

/** Turns delivered by the app (exposition, questions, grading) since the session's last turn. */
function renderUpdateBlock(delta: ChatTurn[]): string {
	const rendered = delta
		.map((t) => `${t.role === 'user' ? 'Student' : 'Nex (you)'}: ${t.content}`)
		.join('\n\n');
	return `<conversation_update>\nDelivered in the lesson app since your last turn (scripted exposition, question prompts, and answers graded in a separate role):\n\n${rendered}\n</conversation_update>`;
}

/** Stream a chat reply as text chunks. Throws before the first chunk on auth/model errors. */
export async function* streamChat(opts: {
	system: SystemPrompt;
	/** Prior transcript turns (client-side source of truth). */
	history: ChatTurn[];
	/** The student's new message, exactly as it will appear in the transcript. */
	message: string;
	/** Per-turn context prefix (lesson position etc.), not stored in the transcript. */
	context?: string;
	/** Enables a persistent Claude Code session (one live conversation per key). */
	sessionKey?: string;
}): AsyncGenerator<string> {
	const currentContent = opts.context ? `${opts.context}\n\n${opts.message}` : opts.message;

	if (getBackend() === 'claude-code') {
		const key = opts.sessionKey ?? 'default';
		const config = {
			system: flattenSystem(opts.system),
			model: getModel(),
			effort: getEffort()
		};
		let session = getTutorSession(key, config);
		let delta = historyDelta(session.seen, opts.history);
		if (delta === null) {
			// Transcript diverged (lesson restarted, other tab, edited history):
			// replace the session and fold the full history back in.
			dropTutorSession(key);
			session = getTutorSession(key, config);
			delta = opts.history;
		}
		const parts = delta.length ? [renderUpdateBlock(delta), currentContent] : [currentContent];
		let reply = '';
		for await (const chunk of session.send(parts.join('\n\n'))) {
			reply += chunk;
			yield chunk;
		}
		session.incorporate(opts.history, opts.message, reply);
		return;
	}

	const stream = await getClient().messages.create({
		model: getModel(),
		max_tokens: 16000,
		thinking: { type: 'adaptive' },
		output_config: { effort: getEffort() },
		system: opts.system,
		messages: [...opts.history, { role: 'user', content: currentContent }],
		stream: true
	});
	try {
		for await (const event of stream) {
			if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
				yield event.delta.text;
			} else if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') {
				yield '\n\n_(The model declined to answer this request.)_';
			}
		}
	} finally {
		stream.controller.abort();
	}
}

/** Model output that should be a bare JSON object — strip fences/prose if present. */
function extractJson(text: string): string {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const body = fenced ? fenced[1] : text;
	const start = body.indexOf('{');
	const end = body.lastIndexOf('}');
	return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/** Run a completion that must return JSON matching `schema`; returns the JSON text. */
export async function completeJson(opts: {
	system: string;
	messages: ChatTurn[];
	schema: Record<string, unknown>;
}): Promise<string> {
	if (getBackend() === 'claude-code') {
		const system = `${opts.system}\n\nOutput format: respond with ONLY a single JSON object that validates against this JSON Schema. No markdown fences, no commentary before or after the JSON.\n\n${JSON.stringify(opts.schema)}`;
		const raw = await completeClaudeCode({
			system,
			prompt: renderPrompt(opts.messages),
			model: getModel(),
			effort: getEffort()
		});
		return extractJson(raw);
	}

	const response = await getClient().messages.create({
		model: getModel(),
		max_tokens: 4000,
		thinking: { type: 'adaptive' },
		system: opts.system,
		messages: opts.messages,
		output_config: {
			effort: getEffort(),
			format: { type: 'json_schema', schema: opts.schema }
		}
	});
	if (response.stop_reason === 'refusal') {
		throw new Error('The model declined to evaluate this submission.');
	}
	const text = response.content.find((b) => b.type === 'text')?.text;
	if (!text) throw new Error('Empty response from the grader.');
	return text;
}
