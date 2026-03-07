/**
 * Qwen Tool Calling Integration Test (Jest)
 *
 * Verifies that Qwen can trigger a locally-defined dummy tool call.
 * The tool is NOT a real production tool — it's a one-time echo function defined here only.
 * Requires QWEN_API_KEY in .env.test.
 */

import '../config';
import OpenAI from 'openai';

// One-time dummy tool for testing purposes only
const DUMMY_TOOL: OpenAI.Chat.ChatCompletionTool = {
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

describe('Qwen LLM - Tool Calling', () => {
    let openai: OpenAI;

    beforeAll(() => {
        const apiKey = process.env.QWEN_API_KEY;
        if (!apiKey) throw new Error('QWEN_API_KEY is not set in .env.test');
        openai = new OpenAI({
            apiKey,
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
        });
    });

    it('should trigger the echo_test dummy tool call', async () => {
        const model = process.env.QWEN_MODEL_KEY || 'qwen-max';
        const response = await openai.chat.completions.create({
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
            tool_choice: 'auto',
            max_tokens: 512
        });

        const choice = response.choices[0];
        expect(choice).toBeDefined();

        const toolCalls = choice!.message.tool_calls;
        expect(toolCalls).toBeDefined();
        expect(toolCalls!.length).toBeGreaterThan(0);

        const tc = toolCalls![0] as any;
        expect(tc.function.name).toBe('echo_test');

        const args = JSON.parse(tc.function.arguments);
        expect(args).toHaveProperty('message');
    }, 30_000);
});
