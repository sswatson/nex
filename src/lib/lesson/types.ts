export interface Choice {
	text: string;
	correct: boolean;
	explanation?: string;
}

export interface MultipleChoiceQuestion {
	type: 'multiple-choice';
	id: string;
	prompt: string;
	choices: Choice[];
}

export interface FreeResponseQuestion {
	type: 'free-response';
	id: string;
	prompt: string;
	criteria?: string;
	sampleAnswer?: string;
}

export interface OpenEndedQuestion {
	type: 'open-ended';
	id: string;
	prompt: string;
	context?: string;
}

/**
 * A hands-on exercise backed by a folder that ships alongside the lesson.
 * The app copies the folder to a per-learner workspace and opens it with the
 * user-configured launch command (editor, multiplexer tab, ...).
 */
export interface ExerciseQuestion {
	type: 'exercise';
	id: string;
	prompt: string;
	/** Folder path relative to the lessons directory. */
	folder: string;
	/** Optional guidance for the tutor when the learner asks about the exercise. */
	context?: string;
}

/**
 * A lesson step that can type text into a user-configured terminal target.
 * The target is a named entry in ~/.config/nex/config.yaml; the lesson never
 * contains a shell command or a pane id itself.
 */
export interface TerminalQuestion {
	type: 'terminal';
	id: string;
	prompt: string;
	/** Name of a configured terminal target, such as "matlab". */
	target: string;
	/** Text to write verbatim to that target. */
	text: string;
	/** Whether to show the text in the chat before offering to send it. */
	showText: boolean;
	/** Optional guidance for the tutor when the learner asks about this step. */
	context?: string;
}

export type Question =
	| MultipleChoiceQuestion
	| FreeResponseQuestion
	| OpenEndedQuestion
	| ExerciseQuestion
	| TerminalQuestion;

export type LessonItem =
	| { kind: 'exposition'; markdown: string }
	| { kind: 'question'; question: Question };

export interface Lesson {
	slug: string;
	title: string;
	description?: string;
	items: LessonItem[];
}

export interface LessonSummary {
	slug: string;
	title: string;
	description?: string;
	questionCount: number;
}

/** A prior chat turn, as sent to the LLM endpoints. */
export interface ChatTurn {
	role: 'user' | 'assistant';
	content: string;
}

export type Verdict = 'correct' | 'partial' | 'incorrect';

/** Result of grading a free-response submission. */
export interface GradeResult {
	kind: 'answer' | 'clarification';
	verdict: Verdict | null;
	reply: string;
}
