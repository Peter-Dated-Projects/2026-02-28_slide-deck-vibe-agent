/**
 * Ollama Conversation Integration Test
 *
 * Verifies that we can maintain a multi-turn conversation with a local Ollama instance.
 * Run with: NODE_ENV=test bun run src/tests/ollama-conversation.integration.ts
 */

import '../config'; // loads .env.test via dotenv
import { OllamaProvider } from '../infrastructure/providers/llm/OllamaProvider';
import type { IDatabaseService } from '../core/interfaces/IDatabaseService';
import type { IStorageService } from '../core/interfaces/IStorageService';

const dbStub = {} as IDatabaseService;
const storageStub = {} as IStorageService;

const USER_MESSAGES = [
    "Hi! I'm building a pitch deck for a B2B SaaS startup.",
    "The startup sells AI-powered invoice automation to mid-market companies.",
    "What slide topics would you suggest for the deck?"
];

async function run() {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL_KEY;
    if (!model) {
        console.error('❌ OLLAMA_MODEL_KEY is not set. Check your .env.test file.');
        process.exit(1);
    }
    console.log(`🔄 Starting Ollama 3-turn conversation test (endpoint: ${baseUrl}, model: ${model})...\n`);

    const provider = new OllamaProvider(baseUrl, model, dbStub, storageStub);
    const conversationId = 'integration-test-' + Date.now();
    const messages: { role: string; content: string }[] = [];

    for (let i = 0; i < USER_MESSAGES.length; i++) {
        const userMessage = USER_MESSAGES[i]!;
        messages.push({ role: 'user', content: userMessage });

        console.log(`👤 Turn ${i + 1} — User: "${userMessage}"`);

        const response = await provider.chatWithAgent(conversationId, messages);

        const text: string | undefined = response?.content?.[0]?.text;
        if (!text || text.trim().length === 0) {
            console.error(`❌ Turn ${i + 1} failed: received empty or missing response.`);
            process.exit(1);
        }

        console.log(`🤖 Ollama: "${text.substring(0, 120)}..."\n`);
        messages.push({ role: 'assistant', content: text });
    }

    console.log('✅ Ollama conversation test passed — 3 turns completed successfully.');
}

run().catch((err) => {
    console.error('❌ Test threw an error:', err);
    console.error('💡 Make sure Ollama is running locally and OLLAMA_BASE_URL is set in .env.test');
    process.exit(1);
});
