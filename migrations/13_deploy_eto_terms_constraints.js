require("babel-register");
const confirm = require("node-ask").confirm;
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const { TriState } = require("../test/helpers/triState");
const roles = require("../test/helpers/roles").default;

const promisify = require("../test/helpers/evmCommands").promisify;
const stringify = require("../test/helpers/constants").stringify;

const constraints = require("./config").constraints;
const deployedAddresses = require("./configETOTermsFixtures").deployedAddresses;
const describedConstraints = require("./configETOTermsFixtures").describedConstraints;
const toChecksumAddress = require("web3-utils").toChecksumAddress;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const PlatformTerms = artifacts.require(CONFIG.artifacts.PLATFORM_TERMS);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const ETOTermsConstraints = artifacts.require(CONFIG.artifacts.ETO_TERMS_CONSTRAINTS);
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

    console.log("Temporary permission to change universe");
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    await createAccessPolicy(accessPolicy, [
      // temporary access to universe, will be dropped in finalize
      {
        subject: DEPLOYER,
        role: roles.universeManager,
        object: universe.address,
        state: TriState.Allow,
      },
    ]);

    const newlyDeployedConstraints = [];

    // deploy only 1 pack of products
    for (const constraint of constraints.filter(c => c._deploymentMetadata.step === 1)) {
      console.log(`Deploying EtoTermsConstraints: ${constraint.NAME}`);
      const updatedConstraint = {
        ...constraint,
        TOKEN_OFFERING_OPERATOR: CONFIG.addresses[constraint.TOKEN_OFFERING_OPERATOR],
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
      deployedAddresses.push(toChecksumAddress(etoTermsConstraints.address));
      newlyDeployedConstraints.push(toChecksumAddress(etoTermsConstraints.address));

      describedConstraints[toChecksumAddress(etoTermsConstraints.address)] = stringify(
        updatedConstraint,
      );
    }
    console.log("Adding to terms constraints collection in universe");
    const setCount = newlyDeployedConstraints.length;
    await universe.setCollectionsInterfaces(
      Array(setCount).fill(knownInterfaces.etoTermsConstraints),
      newlyDeployedConstraints,
      Array(setCount).fill(true),
    );
    // not available products should be switched off on production networks
    if (CONFIG.isLiveDeployment) {
      console.log("... and immediately removing because constraints no longer active");
      const unavailableAddresses = newlyDeployedConstraints.filter(
        a => !describedConstraints[a]._deploymentMetadata.available,
      );
      console.log(unavailableAddresses);
      const resetCount = unavailableAddresses.length;
      if (resetCount > 0) {
        await universe.setCollectionsInterfaces(
          Array(resetCount).fill(knownInterfaces.etoTermsConstraints),
          unavailableAddresses,
          Array(resetCount).fill(false),
        );
      }
      console.log("re-deploying PlatformTerms on live network");
      await deployer.deploy(PlatformTerms);
      const platformTerms = await PlatformTerms.deployed();
      await universe.setSingleton(knownInterfaces.platformTerms, platformTerms.address);
    }
  });
};
