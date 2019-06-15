require("babel-register");
const confirm = require("node-ask").confirm;
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const { TriState } = require("../test/helpers/triState");
const roles = require("../test/helpers/roles").default;

const promisify = require("../test/helpers/evmCommands").promisify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const FeeDisbursal = artifacts.require(CONFIG.artifacts.FEE_DISBURSAL);
  const FeeDisbursalController = artifacts.require(CONFIG.artifacts.FEE_DISBURSAL_CONTROLLER);
  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    // todo: extract to stub that can be used in future migrations
    // recover universe
    if (CONFIG.isLiveDeployment && !CONFIG.UNIVERSE_ADDRESS) {
      throw Error("On live deployment UNIVERSE_ADDRESS must be set");
    }
    if (CONFIG.isLiveDeployment) {
      console.log("LIVE DEPLOYMENT");
      console.log("Deployment parameters:");
      console.log(`Recovered UNIVERSE: ${CONFIG.UNIVERSE_ADDRESS}`);
      console.log(CONFIG);
      if (!(await confirm("Are you sure you want to deploy? [y/n]"))) {
        throw new Error("Aborting!");
      }
    }
    let universe;
    if (CONFIG.UNIVERSE_ADDRESS) {
      universe = await Universe.at(CONFIG.UNIVERSE_ADDRESS);
    } else {
      universe = await Universe.deployed();
    }
    // set initial block
    if (global._initialBlockNo === undefined) {
      global._initialBlockNo = await promisify(web3.eth.getBlockNumber)();
    }

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
