/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary 
 * information of Freedom, LLC ("Confidential Information"). You shall not 
 * disclose such Confidential Information and shall use it only in accordance 
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

/**
 * Qwen Conversation Integration Test (Jest)
 *
 * Verifies that we can maintain a multi-turn conversation with Qwen.
 * Requires QWEN_API_KEY in .env.test.
 */
import { describe, expect, beforeAll, it } from "bun:test";
import '../config';
import { QwenProvider } from '../infrastructure/providers/llm/QwenProvider';
import type { IDatabaseService } from '../core/interfaces/IDatabaseService';
import type { IStorageService } from '../core/interfaces/IStorageService';
const dbStub = {} as IDatabaseService;
const storageStub = {} as IStorageService;
const USER_MESSAGES = [
    "Hi! I'm building a pitch deck for a B2B SaaS startup.",
    "The startup sells AI-powered invoice automation to mid-market companies.",
    "What slide topics would you suggest for the deck?"
];
// Check if the user ran 'bun test integration'
const isIntegrationRun = process.argv.join(' ').includes('integration');
describe.skipIf(!isIntegrationRun)('Qwen LLM - Conversation', () => {
    let provider: QwenProvider;
    beforeAll(() => {
        const apiKey = process.env.QWEN_API_KEY;
        if (!apiKey) throw new Error('QWEN_API_KEY is not set in .env.test');
        const model = process.env.QWEN_MODEL_KEY || 'qwen-max';
        provider = new QwenProvider(apiKey, model, dbStub, storageStub);
    });
    it('should complete a 3-turn conversation and return non-empty responses', async () => {
        const conversationId = 'jest-test-' + Date.now();
        const messages: { role: string; content: string }[] = [];
        for (let i = 0; i < USER_MESSAGES.length; i++) {
            const userMessage = USER_MESSAGES[i]!;
            messages.push({ role: 'user', content: userMessage });
            const response = await provider.chatWithAgent(conversationId, messages);
            const text: string | undefined = response?.content?.[0]?.text;
            expect(text).toBeDefined();
            expect(text!.trim().length).toBeGreaterThan(0);
            messages.push({ role: 'assistant', content: text! });
            // Print out conversation
            console.log(`Turn ${i + 1} - User: "${userMessage}"`);
            console.log(`Turn ${i + 1} - Assistant: "${text}"`);
        }
    }, 60_000); // 60s timeout for live API calls
});
