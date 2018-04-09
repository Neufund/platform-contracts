require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const roles = require("../test/helpers/roles").default;
const { TriState } = require("../test/helpers/triState");
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const getFixtureAccounts = require("./config").getFixtureAccounts;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipDeployment) return;
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const DEPLOYER = getDeployerAccount(network, accounts);
  const fas = getFixtureAccounts(accounts);

  deployer.then(async () => {
    const universe = await Universe.deployed();

    if (CONFIG.isLiveDeployment) {
      const accessPolicy = await RoleBasedAccessPolicy.deployed();

      console.log("Dropping temporary permissions");
      await createAccessPolicy(accessPolicy, [
        { subject: DEPLOYER, role: roles.eurtLegalManager, state: TriState.Unset },
      ]);

      console.log("---------------------------------------------");
      console.log(
        `ACCESS_CONTROLLER ${
          CONFIG.addresses.ACCESS_CONTROLLER
        } must remove access to deployer ${DEPLOYER} for object ${accessPolicy.address}`,
      );
      console.log("---------------------------------------------");
    }

    console.log("---------------------------------------------");
    console.log(`Universe is ${universe.address}`);
    console.log(`Deployment artifacts are in ${network}`);
    console.log(`Accounts with fixtures: ${fas}`);
    console.log("---------------------------------------------");
  });
};
