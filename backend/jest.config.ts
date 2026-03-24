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
