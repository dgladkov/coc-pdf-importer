/**
 * Copy to fvtt.config.js and set userDataPath to your Foundry user data folder
 * (Foundry → Configure Settings → User Data Path), or the host path Docker binds
 * as /data (e.g. /Users/YOU/foundrydata).
 *
 * Then: npm run dev   (watch → Data/modules/coc-pdf-importer)
 *       npm run build (one-off production bundle, same destination)
 */

const developmentOptions = {
  userDataPath: '/Users/YOU/foundrydata',
};

export default developmentOptions;
