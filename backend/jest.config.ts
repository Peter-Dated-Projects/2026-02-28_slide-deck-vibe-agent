/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    collectCoverageFrom: ['src/**/*.ts', 'main.ts'],
    coveragePathIgnorePatterns: ['/node_modules/', '/src/config/'],
};
