require("babel-register");
const confirm = require("node-ask").confirm;
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const { TriState } = require("../test/helpers/triState");
const roles = require("../test/helpers/roles").default;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const promisify = require("../test/helpers/evmCommands").promisify;
const Q18 = require("../test/helpers/constants").Q18;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const PlatformTerms = artifacts.require(CONFIG.artifacts.PLATFORM_TERMS);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const EuroTokenController = artifacts.require(CONFIG.artifacts.EURO_TOKEN_CONTROLLER);
  const FeeDisbursal = artifacts.require("FeeDisbursal");
  const FeeDisbursalController = artifacts.require("FeeDisbursalController");
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);

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
    // deploy fee disbursal and controller
    console.log("Deploying FeeDisbursalController");
    await deployer.deploy(FeeDisbursalController, universe.address);
    const controller = await FeeDisbursalController.deployed();
    console.log("Deploying FeeDisbursal");
    await deployer.deploy(FeeDisbursal, universe.address, controller.address);
    const feeDisbursal = await FeeDisbursal.deployed();

    // set some permissions
    const euroTokenAddress = await universe.euroToken();
    const etherTokenAddress = await universe.etherToken();
    const euroToken = await EuroToken.at(euroTokenAddress);
    const tokenController = await EuroTokenController.at(await euroToken.tokenController());
    const DEPLOYER = getDeployerAccount(network, accounts);

    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    console.log("Setting permissions");
    await createAccessPolicy(accessPolicy, [
      // temporary access to universe, will be dropped in finalize
      {
        subject: DEPLOYER,
        role: roles.universeManager,
        object: universe.address,
        state: TriState.Allow,
      },
      // temporary access to euro token controller, will be dropped in finalize
      { subject: DEPLOYER, role: roles.eurtLegalManager },
      // add platform wallet to disbursers
      {
        subject: CONFIG.PLATFORM_OPERATOR_WALLET,
        role: roles.disburser,
        object: feeDisbursal.address,
        state: TriState.Allow,
      },
      // add deposit manager role to feeDisbursal to be able to convert old nEur to new nEur
      {
        subject: feeDisbursal.address,
        role: roles.eurtDepositManager,
        object: euroTokenAddress,
        state: TriState.Allow,
      },
    ]);
    // set as default disbursal
    console.log("Setting singletons");
    await universe.setSingleton(knownInterfaces.feeDisbursal, feeDisbursal.address);

    const minDeposit = await tokenController.minDepositAmountEurUlps();
    const minWithdraw = await tokenController.minWithdrawAmountEurUlps();
    const maxAllowance = await tokenController.maxSimpleExchangeAllowanceEurUlps();
    console.log(
      `re-apply token controller settings to reload feeDisbursal permissions ${minDeposit
        .div(Q18)
        .toNumber()} ${minWithdraw.div(Q18).toNumber()} ${maxAllowance.div(Q18).toNumber()}`,
    );
    await tokenController.applySettings(minDeposit, minWithdraw, maxAllowance);
    console.log("add payment tokens to payment tokens collection");
    await universe.setCollectionsInterfaces(
      [knownInterfaces.paymentTokenInterface, knownInterfaces.paymentTokenInterface],
      [euroTokenAddress, etherTokenAddress],
      [true, true],
    );
    if (CONFIG.isLiveDeployment) {
      console.log("re-deploying PlatformTerms on live network");
      await deployer.deploy(PlatformTerms);
      const platformTerms = await PlatformTerms.deployed();
      await universe.setSingleton(knownInterfaces.platformTerms, platformTerms.address);
    }
  });
};
