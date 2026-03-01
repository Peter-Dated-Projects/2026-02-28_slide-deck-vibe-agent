import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { dbService as db } from '../core/container';
import { googleAuth } from '../controllers/auth';
import type { Request, Response } from 'express';

import { mock, spyOn } from 'bun:test';
import { OAuth2Client } from 'google-auth-library';

// Polyfill jest for bun
const jest = {
    fn: mock,
    mock: mock.module
};

describe('Database Integration Tests', () => {
    let testUserId: string;
    let testConversationId: string;

    beforeAll(async () => {
        // Clean up any test users from previous runs
        await db.query(`DELETE FROM users WHERE email = 'test_oauth@example.com' OR email = 'test_crud@example.com'`);
        
        // Create base user and conversation for CRUD tests
        const userRes = await db.query(
            'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id',
            ['test_crud@example.com', 'Test CRUD User']
        );
        testUserId = userRes.rows[0].id;

        const convRes = await db.query(
            'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id',
            [testUserId, 'Test Conversation for CRUD']
        );
        testConversationId = convRes.rows[0].id;
    });

    afterAll(async () => {
        // Final cleanup
        await db.query(`DELETE FROM users WHERE email = 'test_oauth@example.com' OR email = 'test_crud@example.com'`);
    });

    describe('Google OAuth Login & Users Table', () => {
        it('should create a new user and refresh token via fake Google OAuth login', async () => {
            const mockReq = {
                body: { token: 'fake-google-id-token' }
            } as Partial<Request>;

            const mockJson = jest.fn();
            const mockCookie = jest.fn();
            const mockStatus = jest.fn().mockReturnThis();

            const mockRes = {
                json: mockJson,
                cookie: mockCookie,
                status: mockStatus
            } as any as Response;

            // Setup google mock
            // @ts-ignore
            spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
                getPayload: () => ({
                    email: 'test_oauth@example.com',
                    sub: 'google-sub-12345',
                    name: 'Test OAuth User',
                    picture: 'https://example.com/pic.jpg'
                })
            } as any);

            await googleAuth(mockReq as Request, mockRes);

            // Assert response matches successful auth
            expect(mockJson).toHaveBeenCalled();
            const responseData = (mockJson as any).mock.calls[0][0];
            expect(responseData.accessToken).toBeDefined();
            expect(responseData.user).toBeDefined();
            expect(responseData.user?.email).toBe('test_oauth@example.com');
            expect(responseData.user?.id).toBeDefined();

            const oauthUserId = responseData.user?.id as string;

            // Assert cookies were set (refresh token)
            expect(mockCookie).toHaveBeenCalledWith(
                'refreshToken',
                expect.any(String),
                expect.any(Object)
            );

            // Verify in database: users table
            const userResult = await db.query('SELECT * FROM users WHERE id = $1', [oauthUserId]);
            expect(userResult.rows.length).toBe(1);
            expect(userResult.rows[0].email).toBe('test_oauth@example.com');
            expect(userResult.rows[0].google_id).toBe('google-sub-12345');
            
            // Verify in database: refresh_tokens table
            const tokenResult = await db.query('SELECT * FROM refresh_tokens WHERE user_id = $1', [oauthUserId]);
            expect(tokenResult.rows.length).toBeGreaterThanOrEqual(1);
        });

        it('should update user settings for the created oauth user', async () => {
             const userResult2 = await db.query('SELECT id FROM users WHERE email = $1', ['test_oauth@example.com']);
             const oauthUserId = userResult2.rows[0].id;
             
            const newSettings = { theme: 'night', billing: null, registered_domains: ['test.com'] };
            await db.query('UPDATE users SET settings = $1 WHERE id = $2', [newSettings, oauthUserId]);
            
            const userResult = await db.query('SELECT settings FROM users WHERE id = $1', [oauthUserId]);
            expect(userResult.rows[0].settings.theme).toBe('night');
        });
    });

    describe('Billing Subscriptions Table R/W', () => {
        let subscriptionId: string;

        it('should create a billing subscription', async () => {
            const result = await db.query(
                `INSERT INTO billing_subscriptions (user_id, plan_type, status) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [testUserId, 'pro', 'active']
            );
            expect(result.rows.length).toBe(1);
            subscriptionId = result.rows[0].id;
        });

        it('should read the billing subscription', async () => {
            const result = await db.query(
                'SELECT * FROM billing_subscriptions WHERE id = $1',
                [subscriptionId]
            );
            expect(result.rows.length).toBe(1);
            expect(result.rows[0].plan_type).toBe('pro');
            expect(result.rows[0].status).toBe('active');
        });
    });

    describe('Conversations Table R/W', () => {
        let conversationId2: string;
        it('should create a conversation', async () => {
            const result = await db.query(
                `INSERT INTO conversations (user_id, title) 
                 VALUES ($1, $2) RETURNING id`,
                [testUserId, 'My Test Presentation']
            );
            expect(result.rows.length).toBe(1);
            conversationId2 = result.rows[0].id;
        });

        it('should read conversations for the user', async () => {
            const result = await db.query(
                'SELECT * FROM conversations WHERE user_id = $1 AND id = $2',
                [testUserId, conversationId2]
            );
            expect(result.rows.length).toBe(1);
            expect(result.rows[0].title).toBe('My Test Presentation');
        });
    });

    describe('Messages Table R/W', () => {
        let messageId: string;

        it('should insert a system, user, and assistant message', async () => {
            // System
            await db.query(
                `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
                [testConversationId, 'system', JSON.stringify({ text: 'You are a helpful assistant' })]
            );

            // User
            await db.query(
                `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
                [testConversationId, 'user', JSON.stringify({ text: 'Make me a slide about the solar system' })]
            );

            // Assistant
            const result = await db.query(
                `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id`,
                [testConversationId, 'assistant', JSON.stringify({ text: 'Sure, creating slide.' })]
            );
            expect(result.rows.length).toBe(1);
            messageId = result.rows[0].id;
        });

        it('should read back messages for the conversation', async () => {
            const result = await db.query(
                'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
                [testConversationId]
            );
            expect(result.rows.length).toBe(3);
            expect(result.rows[0].role).toBe('system');
            expect(result.rows[1].role).toBe('user');
            expect(result.rows[2].role).toBe('assistant');
        });
    });

    describe('Slides Table R/W', () => {
        let slideId: string;

        it('should create a slide', async () => {
            const result = await db.query(
                `INSERT INTO slides (conversation_id, minio_object_key, theme_data) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [testConversationId, 'slides/test-user-hash/1.json', JSON.stringify({ theme: 'dark' })]
            );
            expect(result.rows.length).toBe(1);
            slideId = result.rows[0].id;
        });

        it('should read the slide information', async () => {
            const result = await db.query(
                'SELECT * FROM slides WHERE id = $1',
                [slideId]
            );
            expect(result.rows.length).toBe(1);
            expect(result.rows[0].conversation_id).toBe(testConversationId);
            expect(result.rows[0].minio_object_key).toBe('slides/test-user-hash/1.json');
        });
    });
});
