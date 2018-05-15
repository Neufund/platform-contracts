require("babel-register");
const fs = require("fs");
const { join } = require("path");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const getNetworkDefinition = require("./config").getNetworkDefinition;
const roles = require("../test/helpers/roles").default;
const knownInterfaces = require("../test/helpers/knownInterfaces").default;
const interfaceArtifacts = require("../test/helpers/interfaceArtifacts").default;
const { TriState } = require("../test/helpers/triState");
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const getFixtureAccounts = require("./config").getFixtureAccounts;
const promisify = require("../test/helpers/evmCommands").promisify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipDeployment) return;
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const DEPLOYER = getDeployerAccount(network, accounts);
  const fas = getFixtureAccounts(accounts);

  deployer.then(async () => {
    const universe = await Universe.deployed();

    if (CONFIG.isLiveDeployment) {
      const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());

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

    const endBlockNo = await promisify(web3.eth.getBlockNumber)();
    console.log(`deployment finished at block ${endBlockNo}`);

    const meta = {
      CONFIG,
      DEPLOYER,
      UNIVERSE_ADDRESS: universe.address,
      ROLES: roles,
      KNOWN_INTERFACES: knownInterfaces,
      INTERFACE_ARTIFACTS: interfaceArtifacts,
      NETWORK: getNetworkDefinition(network),
      FIXTURE_ACCOUNTS: fas,
      HEAD_BLOCK_NO: endBlockNo,
    };
    const path = join(__dirname, "../build/meta.json");
    fs.writeFile(path, JSON.stringify(meta), err => {
      if (err) throw new Error(err);
    });

    console.log("---------------------------------------------");
    console.log(`Universe is ${universe.address}`);
    console.log(`Deployment artifacts are in "${path}"`);
    console.log("---------------------------------------------");
  });
};
