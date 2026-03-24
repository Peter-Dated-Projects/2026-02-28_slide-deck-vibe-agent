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

import { createClient, type RedisClientType } from 'redis';
import type { ICacheService } from '../../../core/interfaces/ICacheService';
export class RedisCacheProvider implements ICacheService {
    private client: RedisClientType | null = null;
    private connectPromise: Promise<void> | null = null;
    private disabled = false;
    constructor(private readonly redisUrl: string) {}
    private async getClient(): Promise<RedisClientType | null> {
        if (this.disabled) return null;
        if (!this.client) {
            this.client = createClient({ url: this.redisUrl });
            this.client.on('error', (err: Error) => {
                console.error('[RedisCacheProvider] Redis client error:', err.message);
            });
        }
        if (!this.client.isOpen) {
            if (!this.connectPromise) {
                this.connectPromise = this.client.connect()
                    .then(() => undefined)
                    .catch((err: Error) => {
                        this.disabled = true;
                        console.error('[RedisCacheProvider] Failed to connect to Redis, cache disabled:', err.message);
                    })
                    .finally(() => {
                        this.connectPromise = null;
                    });
            }
            await this.connectPromise;
        }
        if (this.disabled || !this.client.isOpen) return null;
        return this.client;
    }
    async get(key: string): Promise<string | null> {
        const client = await this.getClient();
        if (!client) return null;
        return client.get(key);
    }
    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
        const client = await this.getClient();
        if (!client) return;
        await client.set(key, value, { EX: ttlSeconds });
    }
    async expire(key: string, ttlSeconds: number): Promise<void> {
        const client = await this.getClient();
        if (!client) return;
        await client.expire(key, ttlSeconds);
    }
    async del(key: string): Promise<void> {
        const client = await this.getClient();
        if (!client) return;
        await client.del(key);
    }
}
