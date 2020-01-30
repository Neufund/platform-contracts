require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const initializeMigrationStep = require("./helpers").initializeMigrationStep;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const { TriState } = require("../test/helpers/triState");
const roles = require("../test/helpers/roles").default;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const FeeDisbursal = artifacts.require(CONFIG.artifacts.FEE_DISBURSAL);
  const FeeDisbursalController = artifacts.require(CONFIG.artifacts.FEE_DISBURSAL_CONTROLLER);
  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    const universe = await initializeMigrationStep(CONFIG, artifacts, web3);
    console.log("Temporary permission for ROLE_DISBURSAL_MANAGER");
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    const feeDisbursalAddress = await universe.feeDisbursal();
    await createAccessPolicy(accessPolicy, [
      // temporary access to universe, will be dropped in finalize
      {
        subject: DEPLOYER,
        role: roles.disbursalManager,
        state: TriState.Allow,
      },
    ]);
    console.log("Deploying FeeDisbursalController");
    await deployer.deploy(FeeDisbursalController, universe.address);
    const controller = await FeeDisbursalController.deployed();
    console.log("Changing fee disbursal controller");
    const feeDisbursal = await FeeDisbursal.at(feeDisbursalAddress);
    await feeDisbursal.changeFeeDisbursalController(controller.address);
  });
};
