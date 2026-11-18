const { Transformer } = require('@parcel/plugin');
const original = require('@parcel/transformer-css').default[Symbol.for('parcel-plugin-config')];

module.exports = new Transformer({
  ...original,
  async loadConfig(args) {
    const config = await original.loadConfig(args);
    return {
      ...config,
      drafts: { customMedia: true, ...config?.drafts },
    };
  },
});
