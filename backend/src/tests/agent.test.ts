import { processToolCall } from '../services/agent';
import { llmService } from '../core/container';

jest.mock('../core/container', () => ({
    llmService: {
        processToolCall: jest.fn().mockResolvedValue({
            type: 'tool_result',
            tool_use_id: 'call_123'
        }),
        chatWithAgent: jest.fn()
    }
}));

describe('Agent Services', () => {
    it('should proxy process_tool_call correctly', async () => {
        const mockCall = {
            id: 'call_123',
            name: 'generate_slide_component',
            input: {
                slideNumber: 1,
                componentCode: '<div>Hi</div>',
                fileName: 'Slide1.tsx'
            }
        };

        const result = await processToolCall(mockCall, 'conv_123');
        
        expect(result.type).toBe('tool_result');
        expect(result.tool_use_id).toBe('call_123');
        expect(llmService.processToolCall).toHaveBeenCalledWith(mockCall, 'conv_123');
    });
});
