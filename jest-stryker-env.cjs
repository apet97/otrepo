// Custom Jest environment for Stryker mutation testing
// This wraps the jsdom environment with Stryker's mixin for proper coverage reporting
const { mixinJestEnvironment } = require('@stryker-mutator/jest-runner');
const JsdomEnvironment = require('jest-environment-jsdom').default;

module.exports = mixinJestEnvironment(JsdomEnvironment);
