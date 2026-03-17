/** @type {import('ts-jest').JestConfigWithTsJest} */
const isIntegration = process.argv.includes('integration');

module.exports = {
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                module: 'CommonJS',
                moduleResolution: 'Node',
                verbatimModuleSyntax: false,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true
            }
        }]
    },
    testPathIgnorePatterns: [
        '/node_modules/', 
        '/dist/',
        ...(isIntegration ? [] : ['\\.integration\\.test\\.ts$'])
    ],
    collectCoverageFrom: ['src/**/*.ts', 'main.ts'],
    coveragePathIgnorePatterns: ['/node_modules/', '/src/config/'],
};
