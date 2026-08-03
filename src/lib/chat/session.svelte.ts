import { browser } from '$app/environment';
import type {
	ChatTurn,
	GradeResult,
	Lesson,
	Question,
	Verdict
} from '$lib/lesson/types';

export interface Entry {
	id: number;
	role: 'tutor' | 'user';
	markdown: string;
	variant: 'exposition' | 'question' | 'feedback' | 'chat' | 'notice' | 'error';
	questionId?: string;
	verdict?: Verdict | null;
	streaming?: boolean;
}

interface SavedState {
	v: 1;
	cursor: number;
	entries: Entry[];
	pendingId: string | null;
	mcAnswers: Record<string, number>;
	nextId: number;
}

const COMPLETION_MESSAGE = "🎉 That's the end of the lesson — nice work! Feel free to keep asking questions about anything we covered.";

export class LessonSession {
	readonly lesson: Lesson;

	entries = $state<Entry[]>([]);
	cursor = $state(0);
	pending = $state<Question | null>(null);
	busy = $state(false);
	mcAnswers = $state<Record<string, number>>({});

	#nextId = 1;
	#initialized = false;
	#prewarmedTerminalSteps = new Set<string>();

	constructor(lesson: Lesson) {
		this.lesson = lesson;
	}

	/**
	 * Restore saved progress or deliver the first item. Called from an effect
	 * after mount (not in the constructor) so that server-side rendering and
	 * hydration see the same empty transcript.
	 */
	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;
		if (!(await this.#restore())) {
			this.advance();
		}
	}

	get storageKey(): string {
		return `nex:${this.lesson.slug}`;
	}

	get total(): number {
		return this.lesson.items.length;
	}

	get finished(): boolean {
		return this.cursor >= this.total && this.pending === null;
	}

	questionById(id: string): Question | undefined {
		for (const item of this.lesson.items) {
			if (item.kind === 'question' && item.question.id === id) return item.question;
		}
		return undefined;
	}

	#push(entry: Omit<Entry, 'id'>): Entry {
		const full = { ...entry, id: this.#nextId++ };
		this.entries.push(full);
		// Return the proxied element, not `full`: pushing into a $state array
		// stores a reactive proxy, and mutations on the raw object (e.g.
		// `entry.markdown += chunk` while streaming) would bypass reactivity —
		// the UI would only repaint at the end of the stream.
		return this.entries[this.entries.length - 1];
	}

	/** Deliver the next script item (or skip a pending question first). */
	advance(): void {
		if (this.busy) return;
		if (this.pending) {
			this.pending = null;
		}
		while (this.cursor < this.total) {
			const item = this.lesson.items[this.cursor];
			this.cursor += 1;
			if (item.kind === 'exposition') {
				this.#push({ role: 'tutor', markdown: item.markdown, variant: 'exposition' });
			} else {
				this.#push({
					role: 'tutor',
					markdown: item.question.prompt,
					variant: 'question',
					questionId: item.question.id
				});
				// Exercises don't await a typed answer — the learner works in
				// their editor and presses Continue when done.
				if (item.question.type !== 'exercise') {
					this.pending = item.question;
				}
			}
			break;
		}
		if (this.finished && !this.entries.some((e) => e.variant === 'notice')) {
			this.#push({ role: 'tutor', markdown: COMPLETION_MESSAGE, variant: 'notice' });
		}
		this.#save();
	}

	answerChoice(question: Question, index: number): void {
		if (question.type !== 'multiple-choice') return;
		if (this.pending?.id !== question.id || this.busy) return;
		const choice = question.choices[index];
		this.mcAnswers[question.id] = index;
		this.#push({ role: 'user', markdown: choice.text, variant: 'chat' });

		let feedback: string;
		let verdict: Verdict;
		if (choice.correct) {
			verdict = 'correct';
			feedback = '**Correct!**';
			if (choice.explanation) feedback += ` ${choice.explanation}`;
		} else {
			verdict = 'incorrect';
			feedback = '**Not quite.**';
			if (choice.explanation) feedback += ` ${choice.explanation}`;
			const right = question.choices.find((c) => c.correct);
			if (right) {
				feedback += `\n\nThe correct answer is: ${right.text}`;
				if (right.explanation) feedback += ` — ${right.explanation}`;
			}
		}
		this.#push({
			role: 'tutor',
			markdown: feedback,
			variant: 'feedback',
			verdict,
			questionId: question.id
		});
		this.pending = null;
		this.#save();
	}

	/** Handle typed input: answer a pending question or ask off-script. */
	async submit(text: string): Promise<void> {
		const message = text.trim();
		if (!message || this.busy) return;
		this.#push({ role: 'user', markdown: message, variant: 'chat' });
		this.#save();

		if (this.pending?.type === 'free-response') {
			await this.#grade(this.pending, message);
		} else if (this.pending?.type === 'open-ended') {
			await this.#streamChat('open-ended', message, this.pending);
		} else {
			// No pending text question (or a pending multiple-choice, which is
			// answered via the chips) — treat typed text as an off-script question.
			await this.#streamChat('detour', message);
		}
	}

	#transcript(): ChatTurn[] {
		return this.entries
			.filter((e) => e.variant !== 'error' && e.markdown.trim())
			.map((e) => ({
				role: e.role === 'user' ? ('user' as const) : ('assistant' as const),
				content: e.markdown
			}));
	}

	async #grade(question: Question, message: string): Promise<void> {
		this.busy = true;
		const thinking = this.#push({
			role: 'tutor',
			markdown: '',
			variant: 'feedback',
			questionId: question.id,
			streaming: true
		});
		try {
			const res = await fetch('/api/grade', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					slug: this.lesson.slug,
					questionId: question.id,
					message,
					transcript: this.#transcript().slice(0, -1)
				})
			});
			if (!res.ok) {
				throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
			}
			const result = (await res.json()) as GradeResult;
			thinking.markdown = result.reply;
			thinking.verdict = result.verdict;
			thinking.streaming = false;
			if (result.kind === 'answer') {
				this.pending = null;
			}
		} catch (e) {
			this.entries = this.entries.filter((en) => en.id !== thinking.id);
			this.#push({ role: 'tutor', markdown: (e as Error).message, variant: 'error' });
		} finally {
			this.busy = false;
			this.#save();
		}
	}

	async #streamChat(
		mode: 'detour' | 'open-ended',
		message: string,
		question?: Question
	): Promise<void> {
		this.busy = true;
		const entry = this.#push({
			role: 'tutor',
			markdown: '',
			variant: 'chat',
			streaming: true
		});
		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					slug: this.lesson.slug,
					position: this.cursor,
					mode,
					questionId: question?.id,
					message,
					transcript: this.#transcript().slice(0, -1)
				})
			});
			if (!res.ok || !res.body) {
				const detail = res.headers.get('content-type')?.includes('json')
					? ((await res.json()) as { error?: string }).error
					: undefined;
				throw new Error(detail ?? `HTTP ${res.status}`);
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				entry.markdown += decoder.decode(value, { stream: true });
			}
			entry.streaming = false;
			if (mode === 'open-ended') {
				this.pending = null;
			}
		} catch (e) {
			this.entries = this.entries.filter((en) => en.id !== entry.id);
			this.#push({ role: 'tutor', markdown: (e as Error).message, variant: 'error' });
		} finally {
			this.busy = false;
			this.#save();
		}
	}

	/** Open an exercise's workspace in the user's configured editor. */
	async launchExercise(questionId: string): Promise<boolean> {
		try {
			const res = await fetch('/api/exercise', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ slug: this.lesson.slug, questionId })
			});
			if (!res.ok) {
				throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
			}
			return true;
		} catch (e) {
			this.#push({ role: 'tutor', markdown: (e as Error).message, variant: 'error' });
			return false;
		}
	}

	/** Send a terminal lesson step through its configured target. */
	async injectTerminal(questionId: string): Promise<boolean> {
		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ slug: this.lesson.slug, questionId })
			});
			if (!res.ok) {
				throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
			}
			return true;
		} catch (e) {
			this.#push({ role: 'tutor', markdown: (e as Error).message, variant: 'error' });
			return false;
		}
	}

	/** Resolve a terminal target in the background before the learner clicks Send. */
	prewarmTerminal(questionId: string): void {
		if (this.#prewarmedTerminalSteps.has(questionId)) return;
		this.#prewarmedTerminalSteps.add(questionId);
		void (async () => {
			try {
				const res = await fetch('/api/terminal/prewarm', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ slug: this.lesson.slug, questionId })
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
			} catch {
				this.#prewarmedTerminalSteps.delete(questionId);
			}
		})();
	}

	/**
	 * Go through the lesson again afresh. The current run is archived
	 * server-side (a timestamped file next to current.json), never deleted —
	 * a borked-but-valued transcript can always be recovered from disk.
	 */
	async restart(): Promise<void> {
		if (browser) {
			try {
				await fetch(`/api/state/${this.lesson.slug}/afresh`, { method: 'POST' });
			} catch {
				// archiving is best-effort; starting afresh still proceeds
			}
			localStorage.removeItem(this.storageKey); // clear any legacy copy
		}
		this.entries = [];
		this.cursor = 0;
		this.pending = null;
		this.busy = false;
		this.mcAnswers = {};
		this.#nextId = 1;
		this.advance();
	}

	// Saves go to the server (~/.local/share/nex/history/<slug>/current.json)
	// so history survives browser data loss. PUTs are chained so they can never
	// land out of order; each is best-effort — the next save retries.
	#saveChain: Promise<unknown> = Promise.resolve();

	#save(): void {
		if (!browser) return;
		const state: SavedState = {
			v: 1,
			cursor: this.cursor,
			entries: this.entries.filter((e) => !e.streaming).map((e) => ({ ...e })),
			pendingId: this.pending?.id ?? null,
			mcAnswers: { ...this.mcAnswers },
			nextId: this.#nextId
		};
		const body = JSON.stringify(state);
		this.#saveChain = this.#saveChain.then(() =>
			fetch(`/api/state/${this.lesson.slug}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body
			}).catch(() => undefined)
		);
	}

	#apply(state: SavedState): boolean {
		if (state.v !== 1 || !Array.isArray(state.entries)) return false;
		this.entries = state.entries;
		this.cursor = Math.min(state.cursor, this.total);
		this.pending = state.pendingId ? (this.questionById(state.pendingId) ?? null) : null;
		this.mcAnswers = state.mcAnswers ?? {};
		this.#nextId = state.nextId ?? this.entries.length + 1;
		return this.entries.length > 0;
	}

	async #restore(): Promise<boolean> {
		if (!browser) return false;
		try {
			const res = await fetch(`/api/state/${this.lesson.slug}`);
			if (res.ok) {
				const state = (await res.json()) as SavedState | null;
				if (state && this.#apply(state)) return true;
			}
		} catch {
			// fall through to the legacy store
		}
		// One-time migration: earlier versions kept state in localStorage.
		const raw = localStorage.getItem(this.storageKey);
		if (!raw) return false;
		try {
			const state = JSON.parse(raw) as SavedState;
			if (!this.#apply(state)) return false;
			localStorage.removeItem(this.storageKey);
			this.#save(); // promote to the durable store
			return true;
		} catch {
			return false;
		}
	}
}
