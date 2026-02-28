import { tools, processToolCall } from '../services/agent';

jest.mock('../db', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
}));

jest.mock('../services/storage', () => ({
    storageService: {
        uploadFile: jest.fn().mockResolvedValue({}),
    }
}));

describe('Agent Services', () => {

    it('should export correct tool declarations', () => {
        expect(tools.length).toBe(2);
        expect(tools[0].name).toBe('generate_slide_component');
        expect(tools[1].name).toBe('finalize_presentation_theme');
    });

    it('should process generate_slide_component correctly', async () => {
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
    });
});
