import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { ClaudeCodeError } from './claudeCode';

// SvelteKit loads .env into $env/dynamic/private, NOT into process.env, so the
// key must be passed to the constructor explicitly. When it's absent we fall
// back to the zero-arg client, which resolves ANTHROPIC_AUTH_TOKEN or an
// `ant auth login` profile from the launching environment.
let client: Anthropic | null = null;

export function getClient(): Anthropic {
	client ??= new Anthropic(
		env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : undefined
	);
	return client;
}

export function getModel(): string {
	return env.NEX_MODEL || 'claude-opus-4-8';
}

/** Map SDK / Claude Code errors to a user-presentable message. */
export function describeApiError(e: unknown): { status: number; message: string } {
	if (e instanceof ClaudeCodeError) {
		return { status: 502, message: e.message };
	}
	if (e instanceof Error && e.message.includes('Could not resolve authentication method')) {
		return {
			status: 500,
			message:
				'No Anthropic credentials found. Export ANTHROPIC_API_KEY in the environment you launch the dev server from (or put it in a .env file at the project root), then restart.'
		};
	}
	if (e instanceof Anthropic.AuthenticationError) {
		return {
			status: 500,
			message:
				'Anthropic rejected the API key. Check the ANTHROPIC_API_KEY value in your environment (or .env file), then restart the dev server.'
		};
	}
	if (e instanceof Anthropic.NotFoundError) {
		return {
			status: 500,
			message: `Model not found — check the NEX_MODEL setting (currently "${getModel()}").`
		};
	}
	if (e instanceof Anthropic.RateLimitError) {
		return { status: 429, message: 'Rate limited by the Anthropic API. Wait a moment and retry.' };
	}
	if (e instanceof Anthropic.APIConnectionError) {
		return { status: 502, message: 'Could not reach the Anthropic API. Check your connection.' };
	}
	if (e instanceof Anthropic.APIError) {
		return { status: 500, message: `Anthropic API error: ${e.message}` };
	}
	return { status: 500, message: (e as Error)?.message ?? 'Unknown error' };
}
