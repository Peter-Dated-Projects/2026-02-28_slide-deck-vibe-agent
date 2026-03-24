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

import { Pool } from 'pg';
import type { IDatabaseService } from '../../../core/interfaces/IDatabaseService';
export class PgDatabaseProvider implements IDatabaseService {
    private pool: Pool;
    constructor(config: { host?: string, port?: number, user?: string, password?: string, database?: string }) {
        this.pool = new Pool(config);
        this.pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
            // In a real app we might handle this gracefully, keeping process.exit(-1) as original
            process.exit(-1);
        });
    }
    async query(text: string, params?: any[]) {
        const start = Date.now();
        const res = await this.pool.query(text, params);
        const duration = Date.now() - start;
        console.log('executed query', { text, duration, rows: res.rowCount });
        return res;
    }
    async getClient() {
        const client = await this.pool.connect();
        const query = client.query;
        const release = client.release;
        const timeout = setTimeout(() => {
            console.error('A client has been checked out for more than 5 seconds!');
            console.error(`The last executed query on this client was: ${(client as any).lastQuery}`);
        }, 5000);
        client.query = ((...args: any) => {
            (client as any).lastQuery = args;
            return query.apply(client, args as any);
        }) as any;
        client.release = () => {
            clearTimeout(timeout);
            client.query = query;
            client.release = release;
            return release.apply(client);
        };
        return client;
    }
}
