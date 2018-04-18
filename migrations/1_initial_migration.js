require("babel-register");
const getConfig = require("./config").getConfig;

const Migrations = artifacts.require("./Migrations.sol");

module.exports = function deployMigration(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // do not deploy testing network
  if (CONFIG.shouldSkipDeployment) return;
  deployer.deploy(Migrations);
};
