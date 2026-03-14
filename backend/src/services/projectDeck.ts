import * as fs from 'fs/promises';
import * as path from 'path';
import { cacheService, dbService as db, storageService } from '../core/container';
import { config } from '../config';

const DECK_CACHE_PREFIX = 'deck:html:';

const getCacheKey = (conversationId: string) => `${DECK_CACHE_PREFIX}${conversationId}`;

const getDefaultHtml = async (): Promise<string> => {
    const defaultHtmlPath = path.resolve(__dirname, '../../../frontend/public/default.html');
    return fs.readFile(defaultHtmlPath, { encoding: 'utf-8' });
};

const getExistingDeckKey = async (conversationId: string): Promise<string | null> => {
    const slidesResult = await db.query(
        'SELECT minio_object_key FROM slides WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 1',
        [conversationId]
    );

    return slidesResult.rows[0]?.minio_object_key ?? null;
};

const getConversationOwner = async (conversationId: string): Promise<string> => {
    const result = await db.query('SELECT user_id FROM conversations WHERE id = $1', [conversationId]);
    const userId = result.rows[0]?.user_id;
    if (!userId) {
        throw new Error(`Conversation ${conversationId} not found`);
    }
    return userId;
};

export const ensureDeckExistsForConversation = async (conversationId: string): Promise<string> => {
    const existingKey = await getExistingDeckKey(conversationId);
    if (existingKey) return existingKey;

    const userId = await getConversationOwner(conversationId);
    const s3Key = `users/${userId}/${conversationId}.html`;
    const defaultHtml = await getDefaultHtml();

    await storageService.uploadFile(s3Key, defaultHtml, 'text/html');
    await db.query(
        'INSERT INTO slides (conversation_id, minio_object_key) VALUES ($1, $2)',
        [conversationId, s3Key]
    );

    await cacheService.set(getCacheKey(conversationId), defaultHtml, config.redis.ttlSeconds);
    return s3Key;
};

export const loadDeckHtmlForConversation = async (conversationId: string): Promise<{ html: string; s3Key: string; cacheHit: boolean }> => {
    const s3Key = await ensureDeckExistsForConversation(conversationId);
    const cacheKey = getCacheKey(conversationId);

    const cachedHtml = await cacheService.get(cacheKey);
    if (cachedHtml !== null) {
        await cacheService.expire(cacheKey, config.redis.ttlSeconds);
        return { html: cachedHtml, s3Key, cacheHit: true };
    }

    const html = await storageService.getFileContent(s3Key);
    await cacheService.set(cacheKey, html, config.redis.ttlSeconds);
    return { html, s3Key, cacheHit: false };
};

export const saveDeckHtmlForConversation = async (conversationId: string, html: string): Promise<string> => {
    const s3Key = await ensureDeckExistsForConversation(conversationId);
    await storageService.uploadFile(s3Key, html, 'text/html');
    await cacheService.set(getCacheKey(conversationId), html, config.redis.ttlSeconds);
    return s3Key;
};
