import { describe, expect, it } from 'bun:test';
import { normalizeMessageContentForModel, sanitizeMessagesForModel, stripThinkingFromText } from '../../core/messageSanitizer';

describe('messageSanitizer', () => {
    it('removes think blocks from plain text', () => {
        const input = 'Before <think>hidden reasoning</think> after';
        expect(stripThinkingFromText(input)).toBe('Before  after'.trim());
    });

    it('removes think blocks from structured assistant content', () => {
        const content = [
            { type: 'think', text: 'hidden reasoning' },
            { type: 'text', text: 'Visible answer' },
            { type: 'tool_call', tool_call: { id: 'x' } },
        ];

        expect(normalizeMessageContentForModel(content)).toBe('Visible answer');
    });

    it('preserves tool metadata while stripping thinking from messages', () => {
        const messages = sanitizeMessagesForModel([
            {
                role: 'assistant',
                content: [{ type: 'think', text: 'hidden reasoning' }, { type: 'text', text: 'Visible answer' }],
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_slide', arguments: '{}' } }],
                tool_call_id: 'call_1',
            },
        ]);

        expect(messages).toEqual([
            {
                role: 'assistant',
                content: 'Visible answer',
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_slide', arguments: '{}' } }],
                tool_call_id: 'call_1',
            },
        ]);
    });
});