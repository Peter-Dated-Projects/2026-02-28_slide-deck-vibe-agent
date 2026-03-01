export interface IStorageService {
    uploadFile(key: string, body: string | Buffer, contentType: string): Promise<any>;
    getFileUrl(key: string, expiresIn?: number): Promise<string>;
    getFileContent(key: string): Promise<string>;
}
