import type { QueryResult } from 'pg'; // You can use generic types if you want to fully decouple, but we'll stick to pg for now or keep it 'any' for the result to decouple.

export interface IDatabaseService {
    query(text: string, params?: any[]): Promise<any>;
    getClient(): Promise<any>;
}
