import { describe, expect, it } from 'vitest';
import { TerminalError, findZellijPane } from './terminal';

const target = { tab: 'matlab', pane: 'matlab', enter: true };

describe('findZellijPane', () => {
	it('selects the unique live terminal pane with matching visible names', () => {
		const pane = findZellijPane(
			[
				{ id: 2, is_plugin: false, exited: false, tab_name: 'matlab', title: 'nvim' },
				{ id: 5, is_plugin: false, exited: false, tab_name: 'matlab', title: 'matlab' }
			],
			target
		);
		expect(pane.id).toBe(5);
	});

	it('rejects a missing or ambiguous target instead of guessing', () => {
		expect(() => findZellijPane([], target)).toThrow(TerminalError);
		expect(() =>
			findZellijPane(
				[
					{ id: 5, is_plugin: false, exited: false, tab_name: 'matlab', title: 'matlab' },
					{ id: 6, is_plugin: false, exited: false, tab_name: 'matlab', title: 'matlab' }
				],
				target
			)
		).toThrow(/unique title/);
	});
});
