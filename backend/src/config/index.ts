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

export const config = {
  port: process.env.PORT || 3001,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'vibe',
    password: process.env.DB_PASSWORD || 'vibe_password',
    database: process.env.DB_NAME || 'vibe_db',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY || 'admin',
    secretKey: process.env.S3_SECRET_KEY || 'admin123',
    bucketName: process.env.S3_BUCKET_NAME || 'vibe-slides',
  },
  anthropic: {
    apiKey: process.env.CLAUDE_API_KEY,
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'super-secret-refresh-key',
    googleClientId: process.env.GOOGLE_CLIENT_ID,
  }
};
