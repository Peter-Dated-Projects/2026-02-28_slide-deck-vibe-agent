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

import type { IStorageService } from "../../../core/interfaces/IStorageService";
import { Storage } from "@google-cloud/storage";
export class GCPStorageProvider implements IStorageService {
    private storage: Storage;
    private bucketName: string;
    constructor(config: { bucketName: string, projectId?: string, keyFilename?: string }) {
        this.storage = new Storage({
            projectId: config.projectId,
            keyFilename: config.keyFilename, // Optional if application default credentials are used
        });
        this.bucketName = config.bucketName;
    }
    async uploadFile(key: string, body: string | Buffer, contentType: string) {
        const bucket = this.storage.bucket(this.bucketName);
        const file = bucket.file(key);
        await file.save(body as any, {
            contentType: contentType,
        });
        return { success: true, key };
    }
    async getFileUrl(key: string, expiresIn = 3600) {
        const bucket = this.storage.bucket(this.bucketName);
        const file = bucket.file(key);
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + expiresIn * 1000,
        });
        return url;
    }
    async getFileContent(key: string): Promise<string> {
        const bucket = this.storage.bucket(this.bucketName);
        const file = bucket.file(key);
        const [content] = await file.download();
        return content.toString('utf-8');
    }
}
