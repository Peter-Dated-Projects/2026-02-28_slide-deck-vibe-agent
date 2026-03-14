import { chatWithAgent } from '../services/agent';
import { llmService } from '../core/container';

jest.mock('../core/container', () => ({
    llmService: {
        chatWithAgent: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Hello!' }],
            stop_reason: 'end_turn'
        })
    }
}));

describe('Agent Services', () => {
    it('should proxy chatWithAgent correctly', async () => {
        const messages = [{ role: 'user', content: 'Hello' }];
        const result = await chatWithAgent('conv_123', messages);

        expect(result.stop_reason).toBe('end_turn');
        expect(result.content[0].text).toBe('Hello!');
        expect(llmService.chatWithAgent).toHaveBeenCalledTimes(1);

        const [conversationId, sentMessages, tools, systemInstruction] = (llmService.chatWithAgent as jest.Mock).mock.calls[0];
        expect(conversationId).toBe('conv_123');
        expect(sentMessages).toEqual(messages);
        expect(Array.isArray(tools)).toBe(true);
        expect(systemInstruction).toContain('read_slide');
    });
});
