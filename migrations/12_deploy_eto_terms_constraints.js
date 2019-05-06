require("babel-register");
const confirm = require("node-ask").confirm;
const getConfig = require("./config").getConfig;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;

const promisify = require("../test/helpers/evmCommands").promisify;

const constraints = require("./configETOTermsFixtures").constraints;
const deployedAddresses = require("./configETOTermsFixtures").deployedAddresses;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const ETOTermsConstraints = artifacts.require(CONFIG.artifacts.ETO_TERMS_CONSTRAINTS);

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

    for (const constraint of constraints) {
      console.log(`Deploying EtoTermsConstraints: ${constraint.NAME}`);
      await deployer.deploy(
        ETOTermsConstraints,
        constraint.CAN_SET_TRANSFERABILITY,
        constraint.HAS_NOMINEE,
        constraint.MIN_TICKET_SIZE_EUR_ULPS,
        constraint.MAX_TICKET_SIZE_EUR_ULPS,
        constraint.MIN_INVESTMENT_AMOUNT_EUR_ULPS,
        constraint.MAX_INVESTMENT_AMOUNT_EUR_ULPS,
        constraint.NAME,
        constraint.OFFERING_DOCUMENT_TYPE,
        constraint.OFFERING_DOCUMENT_SUB_TYPE,
        constraint.JURISDICTION,
        constraint.ASSET_TYPE,
      );
      const etoTermsConstraints = await ETOTermsConstraints.deployed();
      // save address
      deployedAddresses.push(etoTermsConstraints.address);

      console.log("Adding to terms constraints collection in universe");
      await universe.setCollectionsInterfaces(
        [knownInterfaces.etoTermsConstraints],
        [etoTermsConstraints.address],
        [true],
      );
    }
  });
};