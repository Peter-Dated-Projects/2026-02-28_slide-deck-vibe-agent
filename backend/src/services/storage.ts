import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: "us-east-1",
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true, // required for MinIO
});

export const storageService = {
  async uploadFile(key: string, body: string | Buffer, contentType: string) {
    const command = new PutObjectCommand({
        Bucket: config.s3.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
    });
    return await s3Client.send(command);
  },

  async getFileUrl(key: string, expiresIn = 3600) {
    const command = new GetObjectCommand({
        Bucket: config.s3.bucketName,
        Key: key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  },

   async getFileContent(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
    });
    const response = await s3Client.send(command);
    if (!response.Body) {
        throw new Error("Empty body from storage");
    }
    return await response.Body.transformToString();
  }
};
