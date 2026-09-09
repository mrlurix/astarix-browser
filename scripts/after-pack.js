const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');

module.exports = async function (context) {
  const exePath = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  try {
    await flipFuses(exePath, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    console.log('Fuses applied:', exePath);
  } catch (err) {
    console.error('Fuse error:', err.message);
  }
};
