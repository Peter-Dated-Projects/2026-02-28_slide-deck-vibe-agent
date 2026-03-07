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
        expect(llmService.chatWithAgent).toHaveBeenCalledWith('conv_123', messages);
    });
});
