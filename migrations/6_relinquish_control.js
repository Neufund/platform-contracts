require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const roles = require("../test/helpers/roles").default;
const { TriState, GLOBAL } = require("../test/helpers/triState");

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipDeployment) return;
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    if (CONFIG.isLiveDeployment) {
      const accessPolicy = await RoleBasedAccessPolicy.deployed();
      const euroToken = await ICBMEuroToken.deployed();

      console.log("Dropping temporary permissions");
      await accessPolicy.setUserRole(
        DEPLOYER,
        roles.eurtDepositManager,
        euroToken.address,
        TriState.Unset,
      );
      await accessPolicy.setUserRole(
        DEPLOYER,
        roles.lockedAccountAdmin,
        GLOBAL,
        TriState.Unset,
      );

      console.log(`Adding new ACCESS_CONTROLLER to ${CONFIG.addresses.ACCESS_CONTROLLER}`);
      await accessPolicy.setUserRole(
        CONFIG.addresses.ACCESS_CONTROLLER,
        roles.accessController,
        GLOBAL,
        TriState.Allow,
      );
      await accessPolicy.setUserRole(
        CONFIG.addresses.ACCESS_CONTROLLER,
        roles.accessController,
        accessPolicy.address,
        TriState.Allow,
      );
      await accessPolicy.setUserRole(
        DEPLOYER,
        roles.accessController,
        GLOBAL,
        TriState.Unset,
      );
      console.log("---------------------------------------------");
      console.log(
        `New ACCESS_CONTROLLER ${
          CONFIG.addresses.ACCESS_CONTROLLER
        } must remove access to deployer ${DEPLOYER} for object ${accessPolicy.address}`,
      );
      console.log("---------------------------------------------");

      /* await accessPolicy.setUserRole(
        DEPLOYER,
        web3.sha3("AccessController"),
        accessPolicy.address,
        TriState.Unset,
        {from: CONFIG.addresses.ACCESS_CONTROLLER}
      ); */
    } else {
      console.log("---------------------------------------------");
      console.log("Will relinquish control only on live network");
      console.log("---------------------------------------------");
    }
  });
};
