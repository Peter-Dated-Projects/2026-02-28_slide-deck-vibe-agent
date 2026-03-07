import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { IStorageService } from "../../../core/interfaces/IStorageService";

export class MinioProvider implements IStorageService {
    private s3Client: S3Client;
    private bucketName: string;

    constructor(config: { endpoint: string, accessKey: string, secretKey: string, bucketName: string }) {
        this.s3Client = new S3Client({
            endpoint: config.endpoint,
            region: "us-east-1",
            credentials: {
                accessKeyId: config.accessKey,
                secretAccessKey: config.secretKey,
            },
            forcePathStyle: true,
        });
        this.bucketName = config.bucketName;
    }

    private async ensureBucketExists(): Promise<void> {
        try {
            await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
        } catch (err: any) {
            // 404 / NoSuchBucket means the bucket needs to be created
            if (err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchBucket' || err.Code === 'NoSuchBucket') {
                await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
                console.log(`[MinioProvider] Bucket "${this.bucketName}" created.`);
            } else {
                throw err;
            }
        }
    }

    async uploadFile(key: string, body: string | Buffer, contentType: string) {
        await this.ensureBucketExists();
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: body,
            ContentType: contentType,
        });
        return await this.s3Client.send(command);
    }

    async getFileUrl(key: string, expiresIn = 3600) {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        });
        return await getSignedUrl(this.s3Client, command, { expiresIn });
    }

    async getFileContent(key: string): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        });
        const response = await this.s3Client.send(command);
        if (!response.Body) {
            throw new Error("Empty body from storage");
        }
        return await response.Body.transformToString();
    }
}
