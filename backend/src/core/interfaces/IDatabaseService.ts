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

import type { QueryResult } from 'pg'; // You can use generic types if you want to fully decouple, but we'll stick to pg for now or keep it 'any' for the result to decouple.
export interface IDatabaseService {
    query(text: string, params?: any[]): Promise<any>;
    getClient(): Promise<any>;
}
