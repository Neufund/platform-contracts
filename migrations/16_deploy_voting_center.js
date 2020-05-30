require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const initializeMigrationStep = require("./helpers").initializeMigrationStep;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const { TriState } = require("../test/helpers/triState");
const roles = require("../test/helpers/roles").default;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const VotingCenter = artifacts.require(CONFIG.artifacts.VOTING_CENTER);
  const VotingController = artifacts.require(CONFIG.artifacts.VOTING_CENTER_CONTROLLER);
  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    const universe = await initializeMigrationStep(CONFIG, artifacts, web3);
    // deploy fee disbursal and controller
    console.log("Deploying VotingController");
    await deployer.deploy(VotingController, universe.address);
    const controller = await VotingController.deployed();
    console.log("Deploying VotingCenter");
    await deployer.deploy(VotingCenter, controller.address);
    const votingCenter = await VotingCenter.deployed();

    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    await createAccessPolicy(accessPolicy, [
      // temporary access to universe, will be dropped in finalize
      {
        subject: DEPLOYER,
        role: roles.universeManager,
        state: TriState.Allow,
      },
    ]);

    console.log("Setting singletons");
    await universe.setSingleton(knownInterfaces.votingCenter, votingCenter.address);
  });
};
