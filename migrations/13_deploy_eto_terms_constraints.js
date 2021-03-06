require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const initializeMigrationStep = require("./helpers").initializeMigrationStep;
const deployConstraints = require("./deployConstraints").deployConstraints;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const PlatformTerms = artifacts.require(CONFIG.artifacts.PLATFORM_TERMS);

  deployer.then(async () => {
    const universe = await initializeMigrationStep(CONFIG, artifacts, web3);
    // deploy first package of constraints
    const deployerAddress = getDeployerAccount(network, accounts);
    await deployConstraints(CONFIG, artifacts, deployer, deployerAddress, universe, 1);

    if (CONFIG.isLiveDeployment) {
      console.log("re-deploying PlatformTerms on live network");
      await deployer.deploy(PlatformTerms);
      const platformTerms = await PlatformTerms.deployed();
      await universe.setSingleton(knownInterfaces.platformTerms, platformTerms.address);
    }
  });
};
