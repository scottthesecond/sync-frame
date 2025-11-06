/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@syncframe/core$': '<rootDir>/src/index.ts',
    '^@syncframe/adapter-in-memory$': '<rootDir>/../adapters/src/in-memory-adapter.ts',
    '^@syncframe/linkindex-in-memory$': '<rootDir>/../linkindex/src/in-memory-link-index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
};

