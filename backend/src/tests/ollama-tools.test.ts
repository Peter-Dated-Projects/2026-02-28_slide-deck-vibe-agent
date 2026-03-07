/**
 * Ollama Tool Calling Integration Test (Jest)
 *
 * Verifies that Ollama can trigger a locally-defined dummy tool call.
 * The tool is NOT a real production tool — it's a one-time echo function defined here only.
 * Requires OLLAMA_MODEL_KEY in .env.test. OLLAMA_BASE_URL defaults to http://localhost:11434.
 */

import '../config';

// One-time dummy tool for testing purposes only
const DUMMY_TOOL = {
    type: 'function',
    function: {
        name: 'echo_test',
        description: 'Echoes a message back. Used only for testing that tool calling works.',
        parameters: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The message to echo back'
                }
            },
            required: ['message']
        }
    }
};

describe('Ollama LLM - Tool Calling', () => {
    let baseUrl: string;
    let model: string;

    beforeAll(() => {
        const modelKey = process.env.OLLAMA_MODEL_KEY;
        if (!modelKey) throw new Error('OLLAMA_MODEL_KEY is not set in .env.test');
        model = modelKey;
        baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    });

    it('should trigger the echo_test dummy tool call', async () => {
        const response = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant. When asked to echo something, you MUST call the echo_test tool.'
                    },
                    {
                        role: 'user',
                        content: 'Please use the echo_test tool to echo the message: "hello from integration test"'
                    }
                ],
                tools: [DUMMY_TOOL],
                stream: false
            })
        });

        expect(response.ok).toBe(true);

        const data: any = await response.json();
        const toolCalls = data.message?.tool_calls;

        expect(toolCalls).toBeDefined();
        expect(toolCalls.length).toBeGreaterThan(0);

        const toolName = toolCalls[0].function?.name;
        expect(toolName).toBe('echo_test');

        const args = toolCalls[0].function?.arguments;
        expect(args).toBeDefined();
    }, 120_000);
});
