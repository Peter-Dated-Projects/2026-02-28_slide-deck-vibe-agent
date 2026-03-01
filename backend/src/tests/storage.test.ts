import { describe, it, expect, beforeAll } from 'bun:test';
import { MinioProvider } from '../infrastructure/providers/storage/MinioProvider';
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config';

describe('Storage Integration Tests (Minio)', () => {
    let storageService: MinioProvider;
    const testKey = `test-folder/test-file-${Date.now()}.txt`;
    const testContent = 'Hello, this is a test upload for Minio!';

    beforeAll(async () => {
        storageService = new MinioProvider({
            endpoint: config.s3.endpoint,
            accessKey: config.s3.accessKey,
            secretKey: config.s3.secretKey,
            bucketName: config.s3.bucketName,
        });

        const s3Client = new S3Client({
            endpoint: config.s3.endpoint,
            region: "us-east-1",
            credentials: {
                accessKeyId: config.s3.accessKey,
                secretAccessKey: config.s3.secretKey,
            },
            forcePathStyle: true,
        });

        try {
            await s3Client.send(new HeadBucketCommand({ Bucket: config.s3.bucketName }));
        } catch (error) {
            await s3Client.send(new CreateBucketCommand({ Bucket: config.s3.bucketName }));
        }
    });

    it('should upload a file to Minio', async () => {
        const response = await storageService.uploadFile(testKey, testContent, 'text/plain');
        expect(response.$metadata.httpStatusCode).toBe(200);
    });

    it('should generate a signed URL for the uploaded file', async () => {
        const url = await storageService.getFileUrl(testKey, 3600);
        expect(url).toBeTypeOf('string');
        expect(url).toContain(config.s3.endpoint);
        expect(url).toContain(config.s3.bucketName);
        expect(url).toContain('X-Amz-Signature');
    });

    it('should retrieve the file content matching the original upload', async () => {
        const content = await storageService.getFileContent(testKey);
        expect(content).toBe(testContent);
    });
});
