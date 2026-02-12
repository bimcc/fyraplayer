/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^\\./techs/tech-webrtc\\.js$': '<rootDir>/tests/mocks/tech-webrtc.mock.ts',
    '^\\./techs/tech-hls\\.js$': '<rootDir>/tests/mocks/tech-hls.mock.ts',
    '^\\./techs/tech-dash\\.js$': '<rootDir>/tests/mocks/tech-dash.mock.ts',
    '^\\./techs/tech-fmp4\\.js$': '<rootDir>/tests/mocks/tech-fmp4.mock.ts',
    '^\\./techs/tech-ws-raw\\.js$': '<rootDir>/tests/mocks/tech-ws-raw.mock.ts',
    '^\\./techs/tech-gb28181\\.js$': '<rootDir>/tests/mocks/tech-gb28181.mock.ts',
    '^\\./techs/tech-file\\.js$': '<rootDir>/tests/mocks/tech-file.mock.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/ref/'],
  testPathIgnorePatterns: ['\\\\node_modules\\\\', '<rootDir>/dist/', '<rootDir>/ref/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
