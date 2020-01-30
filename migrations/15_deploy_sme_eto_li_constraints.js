require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const initializeMigrationStep = require("./helpers").initializeMigrationStep;
const deployConstraints = require("./deployConstraints").deployConstraints;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  deployer.then(async () => {
    const universe = await initializeMigrationStep(CONFIG, artifacts, web3);
    // deploy first package of constraints
    const deployerAddress = getDeployerAccount(network, accounts);
    await deployConstraints(CONFIG, artifacts, deployer, deployerAddress, universe, 2);
  });
};
