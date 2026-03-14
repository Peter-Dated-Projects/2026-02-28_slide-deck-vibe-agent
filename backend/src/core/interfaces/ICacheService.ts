export interface ICacheService {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds: number): Promise<void>;
    expire(key: string, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
}
