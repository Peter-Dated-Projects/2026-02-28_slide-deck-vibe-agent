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
import { OllamaProvider } from '../infrastructure/providers/llm/OllamaProvider';
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
// 3. Initialize LLM Provider
// If local, we can use Ollama. Otherwise use Claude.
export const llmService: ILLMService = isLocal
    ? new OllamaProvider(
        process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        process.env.OLLAMA_MODEL_KEY || 'llama3.2',
        dbService,
        storageService
    )
    : new QwenProvider(
        config.qwen.apiKey || '',
        process.env.QWEN_MODEL_KEY || 'qwen3.5-flash',
        dbService,
        storageService
    );
// 4. Initialize Cache Provider
export const cacheService: ICacheService = new RedisCacheProvider(config.redis.url);
