import { config } from '../config';

import type { ILLMService } from './interfaces/ILLMService';
import type { IStorageService } from './interfaces/IStorageService';
import type { IDatabaseService } from './interfaces/IDatabaseService';

import { QwenProvider } from '../infrastructure/providers/llm/QwenProvider';
import { OllamaProvider } from '../infrastructure/providers/llm/OllamaProvider';
import { MinioProvider } from '../infrastructure/providers/storage/MinioProvider';
import { GCPStorageProvider } from '../infrastructure/providers/storage/GCPStorageProvider';
import { PgDatabaseProvider } from '../infrastructure/providers/db/PgDatabaseProvider';

// Determine environment
const isLocal = process.env.NODE_ENV === 'local' || process.env.NODE_ENV === 'development';

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
        dbService,
        storageService
    )
    : new QwenProvider(
        config.qwen.apiKey || '',
        dbService,
        storageService
    );
