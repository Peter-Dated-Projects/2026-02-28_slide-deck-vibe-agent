import { describe, expect, test } from 'bun:test';
import { rowToBlocks, rowsToHistory, type StoredMessageRow } from '../core/conversationBlocks';

function row(partial: Partial<StoredMessageRow>): StoredMessageRow {
    return {
        role: 'assistant',
        blocks: null,
        content: null,
        tool_calls: null,
        tool_results: null,
        ...partial,
    };
}

describe('rowToBlocks', () => {
    test('passes through new-format blocks unchanged in order', () => {
        const r = row({
            blocks: [
                { type: 'text', text: 'before' },
                { type: 'tool_call', id: 'a', name: 'add_element', args: { x: 1 } },
                { type: 'text', text: 'after' },
                { type: 'tool_call', id: 'b', name: 'update_element', args: {} },
            ],
        });
        expect(rowToBlocks(r)).toEqual([
            { type: 'text', text: 'before' },
            { type: 'tool_call', id: 'a', name: 'add_element', args: { x: 1 } },
            { type: 'text', text: 'after' },
            { type: 'tool_call', id: 'b', name: 'update_element', args: {} },
        ]);
    });

    test('preserves thinking blocks', () => {
        const r = row({
            blocks: [
                { type: 'thinking', text: 'hmm' },
                { type: 'text', text: 'ok' },
            ],
        });
        expect(rowToBlocks(r)).toEqual([
            { type: 'thinking', text: 'hmm' },
            { type: 'text', text: 'ok' },
        ]);
    });

    test('falls back to legacy triplet (text → tool_calls → tool_results)', () => {
        const r = row({
            blocks: null,
            content: [{ type: 'text', text: 'hello' }],
            tool_calls: [
                { id: 't1', type: 'function', function: { name: 'add_element', arguments: '{"slot":1}' } },
            ],
            tool_results: [{ id: 't1', result: '{"ok":true}' }],
        });
        expect(rowToBlocks(r)).toEqual([
            { type: 'text', text: 'hello' },
            { type: 'tool_call', id: 't1', name: 'add_element', args: { slot: 1 } },
            { type: 'tool_result', id: 't1', result: '{"ok":true}' },
        ]);
    });

    test('user row falls back to {text} content shape', () => {
        const r = row({ role: 'user', content: { text: 'hi there' } });
        expect(rowToBlocks(r)).toEqual([{ type: 'text', text: 'hi there' }]);
    });
});

describe('rowsToHistory', () => {
    test('drops thinking blocks before sending to LLM', () => {
        const rows: StoredMessageRow[] = [
            row({ role: 'user', blocks: [{ type: 'text', text: 'make a slide' }] }),
            row({
                role: 'assistant',
                blocks: [
                    { type: 'thinking', text: 'let me plan' },
                    { type: 'text', text: 'sure thing' },
                ],
            }),
        ];
        const history = rowsToHistory(rows);
        expect(history).toEqual([
            { role: 'user', content: 'make a slide' },
            { role: 'assistant', content: 'sure thing', tool_calls: undefined },
        ]);
        const flat = JSON.stringify(history);
        expect(flat).not.toContain('let me plan');
        expect(flat).not.toContain('thinking');
    });

    test('emits tool messages paired by id after the assistant message', () => {
        const rows: StoredMessageRow[] = [
            row({
                role: 'assistant',
                blocks: [
                    { type: 'text', text: 'before' },
                    { type: 'tool_call', id: 'c1', name: 'add_element', args: { a: 1 } },
                    { type: 'text', text: 'middle' },
                    { type: 'tool_call', id: 'c2', name: 'update_element', args: { b: 2 } },
                    { type: 'tool_result', id: 'c1', result: 'r1' },
                    { type: 'tool_result', id: 'c2', result: 'r2' },
                ],
            }),
        ];
        const history = rowsToHistory(rows);
        expect(history).toEqual([
            {
                role: 'assistant',
                content: 'beforemiddle',
                tool_calls: [
                    { id: 'c1', name: 'add_element', args: { a: 1 } },
                    { id: 'c2', name: 'update_element', args: { b: 2 } },
                ],
            },
            { role: 'tool', tool_call_id: 'c1', content: 'r1' },
            { role: 'tool', tool_call_id: 'c2', content: 'r2' },
        ]);
    });

    test('handles missing tool_result (empty content)', () => {
        const rows: StoredMessageRow[] = [
            row({
                role: 'assistant',
                blocks: [
                    { type: 'tool_call', id: 'x', name: 'foo', args: {} },
                ],
            }),
        ];
        const history = rowsToHistory(rows);
        expect(history[1]).toEqual({ role: 'tool', tool_call_id: 'x', content: '' });
    });
});
