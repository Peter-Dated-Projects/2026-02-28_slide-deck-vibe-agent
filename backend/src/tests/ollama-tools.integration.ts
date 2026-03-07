/**
 * Ollama Tool Calling Integration Test
 *
 * Verifies that Ollama can trigger a locally-defined dummy tool call.
 * The tool is NOT a real production tool — it's a one-time echo function defined here only.
 * Run with: NODE_ENV=test bun run src/tests/ollama-tools.integration.ts
 */

import '../config'; // loads .env.test via dotenv

// One-time dummy tool for testing purposes only (same definition as qwen-tools test)
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

async function run() {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL_KEY;
    if (!model) {
        console.error('❌ OLLAMA_MODEL_KEY is not set. Check your .env.test file.');
        process.exit(1);
    }
    console.log(`🔄 Starting Ollama tool-calling test (endpoint: ${baseUrl}, model: ${model})...\n`);

    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: model,
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

    if (!response.ok) {
        console.error(`❌ Ollama API error: ${response.status} ${response.statusText}`);
        process.exit(1);
    }

    const data: any = await response.json();
    const toolCalls = data.message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
        console.error('❌ Test failed: Model did not make a tool call.');
        console.error('Response:', JSON.stringify(data.message, null, 2));
        console.error('💡 Note: Not all Ollama models support tool calling. Try a model like llama3.1 or mistral-nemo.');
        process.exit(1);
    }

    const toolCall = toolCalls[0];
    const toolName = toolCall.function?.name;

    if (toolName !== 'echo_test') {
        console.error(`❌ Test failed: Expected tool "echo_test" but got "${toolName}"`);
        process.exit(1);
    }

    const args = toolCall.function?.arguments;
    console.log(`✅ Ollama called tool: "${toolName}"`);
    console.log(`   Arguments: ${JSON.stringify(args)}`);
    console.log('\n✅ Ollama tool-calling test passed.');
}

run().catch((err) => {
    console.error('❌ Test threw an error:', err);
    console.error('💡 Make sure Ollama is running locally and OLLAMA_BASE_URL is set in .env.test');
    process.exit(1);
});
