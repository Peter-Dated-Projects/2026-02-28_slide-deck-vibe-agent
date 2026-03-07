/**
 * Qwen Conversation Integration Test
 *
 * Verifies that we can maintain a multi-turn conversation with Qwen.
 * Run with: NODE_ENV=test bun run src/tests/qwen-conversation.integration.ts
 */

import '../config'; // loads .env.test via dotenv
import { QwenProvider } from '../infrastructure/providers/llm/QwenProvider';
import type { IDatabaseService } from '../core/interfaces/IDatabaseService';
import type { IStorageService } from '../core/interfaces/IStorageService';

// Minimal no-op stubs — conversation test doesn't use DB or storage
const dbStub = {} as IDatabaseService;
const storageStub = {} as IStorageService;

const USER_MESSAGES = [
    "Hi! I'm building a pitch deck for a B2B SaaS startup.",
    "The startup sells AI-powered invoice automation to mid-market companies.",
    "What slide topics would you suggest for the deck?"
];

async function run() {
    const apiKey = process.env.QWEN_API_KEY;
    if (!apiKey) {
        console.error('❌ QWEN_API_KEY is not set. Check your .env.test file.');
        process.exit(1);
    }

    console.log('🔄 Starting Qwen 3-turn conversation test...\n');

    const provider = new QwenProvider(apiKey, dbStub, storageStub);
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

        console.log(`🤖 Qwen: "${text.substring(0, 120)}..."\n`);
        messages.push({ role: 'assistant', content: text });
    }

    console.log('✅ Qwen conversation test passed — 3 turns completed successfully.');
}

run().catch((err) => {
    console.error('❌ Test threw an error:', err);
    process.exit(1);
});
