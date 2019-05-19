require("babel-register");
const confirm = require("node-ask").confirm;
const getConfig = require("./config").getConfig;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const { join } = require("path");
const fs = require("fs");

const promisify = require("../test/helpers/evmCommands").promisify;

const constraints = require("./config").constraints;
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

    const describedConstraints = {};
    for (const constraint of constraints) {
      console.log(`Deploying EtoTermsConstraints: ${constraint.NAME}`);
      const updatedConstraint = {
        ...constraint,
        TOKEN_OFFERING_OPERATOR: CONFIG[constraint.TOKEN_OFFERING_OPERATOR],
      };
      await deployer.deploy(
        ETOTermsConstraints,
        updatedConstraint.CAN_SET_TRANSFERABILITY,
        updatedConstraint.HAS_NOMINEE,
        updatedConstraint.MIN_TICKET_SIZE_EUR_ULPS,
        updatedConstraint.MAX_TICKET_SIZE_EUR_ULPS,
        updatedConstraint.MIN_INVESTMENT_AMOUNT_EUR_ULPS,
        updatedConstraint.MAX_INVESTMENT_AMOUNT_EUR_ULPS,
        updatedConstraint.NAME,
        updatedConstraint.OFFERING_DOCUMENT_TYPE,
        updatedConstraint.OFFERING_DOCUMENT_SUB_TYPE,
        updatedConstraint.JURISDICTION,
        updatedConstraint.ASSET_TYPE,
        updatedConstraint.TOKEN_OFFERING_OPERATOR,
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

      describedConstraints[etoTermsConstraints.address] = updatedConstraint;
    }

    // save information to fixtures file
    const etoConstraintsFixturesPath = join(
      __dirname,
      "../build/eto_terms_contraints_fixtures.json",
    );
    fs.writeFile(etoConstraintsFixturesPath, JSON.stringify(describedConstraints, null, 2), err => {
      if (err) throw new Error(err);
    });
    console.log(`ETO constraints described in ${etoConstraintsFixturesPath}`);
  });
};
