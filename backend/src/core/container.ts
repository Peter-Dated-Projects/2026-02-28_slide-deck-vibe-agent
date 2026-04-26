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

import { config } from '../config';
import type { ILLMService } from './interfaces/ILLMService';
import type { IStorageService } from './interfaces/IStorageService';
import type { IDatabaseService } from './interfaces/IDatabaseService';
import type { ICacheService } from './interfaces/ICacheService';
import { QwenProvider } from '../infrastructure/providers/llm/QwenProvider';
import { MinioProvider } from '../infrastructure/providers/storage/MinioProvider';
import { GCPStorageProvider } from '../infrastructure/providers/storage/GCPStorageProvider';
import { PgDatabaseProvider } from '../infrastructure/providers/db/PgDatabaseProvider';
import { RedisCacheProvider } from '../infrastructure/providers/cache/RedisCacheProvider';
// Default to local provider unless explicitly running in a non-local runtime.
const runtimeEnv = process.env.NODE_ENV || 'development';
const isLocal = runtimeEnv === 'local' || runtimeEnv === 'development' || runtimeEnv === 'test';
// 1. Initialize Database Provider
export const dbService: IDatabaseService = new PgDatabaseProvider({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
});
// 2. Initialize Storage Provider
export const storageService: IStorageService = isLocal
    ? new MinioProvider({
        endpoint: config.s3.endpoint,
        accessKey: config.s3.accessKey,
        secretKey: config.s3.secretKey,
        bucketName: config.s3.bucketName,
    })
    : new GCPStorageProvider({
        bucketName: process.env.GCP_BUCKET_NAME || config.s3.bucketName,
        projectId: process.env.GCP_PROJECT_ID,
    });
// 3. Initialize LLM Provider — Qwen via DashScope (OpenAI-compatible) by default,
// or via local Ollama (also OpenAI-compatible at /v1) when QWEN_MODE=ollama or
// OLLAMA_BASE_URL is set.
export const llmService: ILLMService = (() => {
    if (config.qwen.mode === 'ollama' && config.qwen.ollamaBaseUrl) {
        const baseURL = `${config.qwen.ollamaBaseUrl.replace(/\/$/, '')}/v1`;
        console.log(`[llm] mode: ollama → ${baseURL} (model: ${config.qwen.ollamaModel})`);
        return new QwenProvider('ollama', config.qwen.ollamaModel, baseURL);
    }
    console.log(`[llm] mode: api → dashscope (model: ${config.qwen.model})`);
    return new QwenProvider(config.qwen.apiKey || '', config.qwen.model);
})();
// 4. Initialize Cache Provider
export const cacheService: ICacheService = new RedisCacheProvider(config.redis.url);
