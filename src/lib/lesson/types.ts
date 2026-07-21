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

export type Question =
	| MultipleChoiceQuestion
	| FreeResponseQuestion
	| OpenEndedQuestion
	| ExerciseQuestion;

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
