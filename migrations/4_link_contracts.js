require("babel-register");
const getConfig = require("./config").getConfig;
const { TriState, GLOBAL } = require("../test/helpers/triState");
const getDeployerAccount = require("./config").getDeployerAccount;

module.exports = function deployContracts(deployer, network, accounts) {
  const DEPLOYER = getDeployerAccount(network, accounts);
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipDeployment) return;

  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);

  deployer.then(async () => {
    const accessPolicy = await RoleBasedAccessPolicy.deployed();
    const commitment = await Commitment.deployed();
    const etherLock = await ICBMLockedAccount.at(await commitment.etherLock());
    const euroLock = await ICBMLockedAccount.at(await commitment.euroLock());

    // locked account admin role to yourself during deployment and relinquish control later
    await accessPolicy.setUserRole(
      DEPLOYER,
      web3.sha3("LockedAccountAdmin"),
      GLOBAL,
      TriState.Allow,
    );

    console.log("Attaching Commitment to LockedAccounts");
    await euroLock.setController(commitment.address);
    await etherLock.setController(commitment.address);
  });
};
