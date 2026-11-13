const { Resolver } = require('@parcel/plugin');
const NodeResolver = require('@parcel/node-resolver-core').default;

module.exports = new Resolver({
  async loadConfig({ config, options, logger }) {
    const projectConfig = await config.getConfig([], { packageKey: '@parcel/resolver-default' });
    return new NodeResolver({
      fs: options.inputFS,
      projectRoot: options.projectRoot,
      packageManager: options.packageManager,
      shouldAutoInstall: options.shouldAutoInstall,
      mode: options.mode,
      logger,
      packageExports: projectConfig?.contents?.packageExports ?? true,
    });
  },
  resolve({ dependency, specifier, config }) {
    if (/^\w+-loader(?:\?\S*)?!/.test(dependency.specifier)) {
      throw new Error(`The import path: ${dependency.specifier} is using webpack specific loader import syntax, which isn't supported by Parcel.`);
    }
    return config.resolve({
      filename: specifier,
      specifierType: dependency.specifierType,
      range: dependency.range,
      parent: dependency.resolveFrom,
      env: dependency.env,
      sourcePath: dependency.sourcePath,
      loc: dependency.loc,
      packageConditions: dependency.packageConditions,
    });
  },
});
