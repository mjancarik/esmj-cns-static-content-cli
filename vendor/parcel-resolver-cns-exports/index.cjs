const { Resolver } = require('@parcel/plugin');
const NodeResolver = require('@parcel/node-resolver-core').default;
const path = require('node:path');

function matchesAlias(specifier, aliases) {
  return Object.keys(aliases ?? {}).some((key) => {
    const pattern = key.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}$`).test(specifier);
  });
}

async function findPackageAlias(specifier, resolveFrom, projectRoot, fs) {
  const changed = [];
  const created = [];
  let directory = path.dirname(resolveFrom);
  while (directory !== projectRoot && directory.startsWith(`${projectRoot}${path.sep}`)) {
    const manifest = path.join(directory, 'package.json');
    let contents;
    try {
      contents = await fs.readFile(manifest, 'utf8');
      changed.push(manifest);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      created.push({ filePath: manifest });
    }
    if (contents && matchesAlias(specifier, JSON.parse(contents).alias)) {
      return { found: true, changed, created };
    }
    directory = path.dirname(directory);
  }
  return { found: false, changed, created };
}

module.exports = new Resolver({
  async loadConfig({ config, options, logger }) {
    const projectConfig = await config.getConfig([], { packageKey: '@parcel/resolver-default' });
    const aliases = await config.getConfigFrom(path.join(options.projectRoot, 'index'), [], { packageKey: 'alias' });
    const resolver = new NodeResolver({
      fs: options.inputFS,
      projectRoot: options.projectRoot,
      packageManager: options.packageManager,
      shouldAutoInstall: options.shouldAutoInstall,
      mode: options.mode,
      logger,
      packageExports: projectConfig?.contents?.packageExports ?? true,
    });
    return { resolver, aliases: aliases?.contents, projectRoot: options.projectRoot, fs: options.inputFS };
  },
  async resolve({ dependency, specifier, config }) {
    if (/^\w+-loader(?:\?\S*)?!/.test(dependency.specifier)) {
      throw new Error(`The import path: ${dependency.specifier} is using webpack specific loader import syntax, which isn't supported by Parcel.`);
    }
    let filename = specifier;
    const isDefaultAlias = specifier.startsWith('@/') || specifier.startsWith('@merkur/');
    const nestedAlias = isDefaultAlias && dependency.resolveFrom
      ? await findPackageAlias(specifier, dependency.resolveFrom, config.projectRoot, config.fs)
      : { found: false, changed: [], created: [] };
    if (!nestedAlias.found && !matchesAlias(specifier, config.aliases)) {
      if (specifier.startsWith('@/')) {
        filename = path.resolve(config.projectRoot, 'share', specifier.slice(2));
      } else if (specifier.startsWith('@merkur/')) {
        filename = path.resolve(config.projectRoot, 'node_modules/@merkur', specifier.slice(8), 'lib/index.es9.mjs');
      }
    }
    if (filename !== specifier) {
      filename = path.relative(path.dirname(dependency.resolveFrom), filename).split(path.sep).join('/');
      if (!filename.startsWith('.')) filename = `./${filename}`;
    }
    const result = await config.resolver.resolve({
      filename,
      specifierType: dependency.specifierType,
      range: dependency.range,
      parent: dependency.resolveFrom,
      env: dependency.env,
      sourcePath: dependency.sourcePath,
      loc: dependency.loc,
      packageConditions: dependency.packageConditions,
    });
    return {
      ...result,
      invalidateOnFileChange: [...(result.invalidateOnFileChange ?? []), ...nestedAlias.changed],
      invalidateOnFileCreate: [...(result.invalidateOnFileCreate ?? []), ...nestedAlias.created],
    };
  },
});
