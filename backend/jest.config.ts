/** @type {import('ts-jest').JestConfigWithTsJest} */
const isIntegration = process.argv.includes('integration');

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testPathIgnorePatterns: [
        '/node_modules/', 
        '/dist/',
        ...(isIntegration ? [] : ['\\.integration\\.test\\.ts$'])
    ],
    collectCoverageFrom: ['src/**/*.ts', 'main.ts'],
    coveragePathIgnorePatterns: ['/node_modules/', '/src/config/'],
};
