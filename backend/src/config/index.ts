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

import dotenv from 'dotenv';
import path from 'path';
// Load env vars based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv !== 'production') {
    const currentEnv = nodeEnv === 'test' ? 'test' : 'local';
    const envPath = path.resolve(process.cwd(), `../.env.${currentEnv}`);
    dotenv.config({ path: envPath });
} else {
    const envPath = path.resolve(process.cwd(), `../.env.production`);
    dotenv.config({ path: envPath });
}
const requireEnv = (key: string): string => {
    const value = process.env[key];
    if (!value) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
    return value;
};
export const config = {
  port: process.env.PORT || 3001,
  db: {
    host: requireEnv('DB_HOST'),
    port: parseInt(requireEnv('DB_PORT'), 10),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_NAME'),
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY || 'admin',
    secretKey: process.env.S3_SECRET_KEY || 'admin123',
    bucketName: process.env.S3_BUCKET_NAME || 'vibe-slides',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttlSeconds: parseInt(process.env.REDIS_TTL_SECONDS || '300', 10),
  },
  qwen: {
    apiKey: process.env.QWEN_API_KEY,
    model: process.env.QWEN_MODEL_KEY || 'qwen3.5-flash',
    mode: (process.env.QWEN_MODE
      ?? (process.env.OLLAMA_BASE_URL ? 'ollama' : 'api')) as 'ollama' | 'api',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaModel: process.env.OLLAMA_MODEL_KEY || 'qwen3.5:9b',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'super-secret-refresh-key',
    googleClientId: (() => {
      if (process.env.GOOGLE_OAUTH_CLIENT_JSON) {
        try {
          const parsed = JSON.parse(process.env.GOOGLE_OAUTH_CLIENT_JSON);
          return parsed.web?.client_id || process.env.GOOGLE_CLIENT_ID;
        } catch (e) {
          console.error('Failed to parse GOOGLE_OAUTH_CLIENT_JSON');
        }
      }
      return process.env.GOOGLE_CLIENT_ID;
    })(),
  }
};
