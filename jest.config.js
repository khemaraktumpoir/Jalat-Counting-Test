const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig');

module.exports = {
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    ...pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' })
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.{js,jsx,tsx,ts}', '!**/node_modules/**', '!**/vendor/**'],
  coverageReporters: ['json', 'lcov'],
  // Tests live in src/ only (training/ holds the Ultralytics repo and its Python environments).
  roots: ['<rootDir>/src'],
  testRegex: '/src/.*\\.(test|spec).(ts|tsx|js)$',
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
};
