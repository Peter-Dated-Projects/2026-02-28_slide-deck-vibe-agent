/**
 * Qwen Tool Calling Integration Test
 *
 * Verifies that Qwen can trigger a locally-defined dummy tool call.
 * The tool is NOT a real production tool — it's a one-time echo function defined here only.
 * Run with: NODE_ENV=test bun run src/tests/qwen-tools.integration.ts
 */

import '../config'; // loads .env.test via dotenv
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

async function run() {
    const apiKey = process.env.QWEN_API_KEY;
    if (!apiKey) {
        console.error('❌ QWEN_API_KEY is not set. Check your .env.test file.');
        process.exit(1);
    }

    console.log('🔄 Starting Qwen tool-calling test...\n');

    const openai = new OpenAI({
        apiKey,
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
    });

    const response = await openai.chat.completions.create({
        model: 'qwen-max',
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
    if (!choice) {
        console.error('❌ Test failed: No choices returned from API.');
        process.exit(1);
    }

    const toolCalls = choice.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
        console.error('❌ Test failed: Model did not make a tool call.');
        console.error('Finish reason:', choice.finish_reason);
        console.error('Response:', choice.message.content);
        process.exit(1);
    }

    const toolCall = toolCalls[0];
    if (!toolCall) {
        console.error('❌ Test failed: tool_calls array was empty.');
        process.exit(1);
    }

    const tc = toolCall as any;
    const toolName = tc.function.name as string;
    const toolArgs = tc.function.arguments as string;

    if (toolName !== 'echo_test') {
        console.error(`❌ Test failed: Expected tool "echo_test" but got "${toolName}"`);
        process.exit(1);
    }

    const args = JSON.parse(toolArgs);
    console.log(`✅ Qwen called tool: "${toolName}"`);
    console.log(`   Arguments: ${JSON.stringify(args)}`);
    console.log('\n✅ Qwen tool-calling test passed.');
}

run().catch((err) => {
    console.error('❌ Test threw an error:', err);
    process.exit(1);
});
