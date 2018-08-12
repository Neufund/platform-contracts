require("babel-register");
const fs = require("fs");
const { join } = require("path");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./config").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;
const deployETO = require("./deployETO").deployETO;
const checkETO = require("./deployETO").checkETO;
const publicETOTerms = require("./configETOFixtures").publicETOTerms;
const dayInSeconds = require("../test/helpers/constants").dayInSeconds;
const stringify = require("../test/helpers/constants").stringify;
const CommitmentState = require("../test/ETO/commitmentState").CommitmentState;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const fas = getFixtureAccounts(accounts);
  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    const universe = await Universe.deployed();

    const [etoCommitment, equityToken, , etoTerms] = await deployETO(
      artifacts,
      DEPLOYER,
      CONFIG,
      universe,
      fas.NOMINEE_NEUMINI.address,
      fas.ISSUER_PUBLIC.address,
      publicETOTerms.etoTerms,
      publicETOTerms.shareholderTerms,
      publicETOTerms.durTerms,
    );
    // nominee sets agreement
    console.log("Nominee sets agreements");
    await etoCommitment.amendAgreement(publicETOTerms.reservationAndAcquisitionAgreement, {
      from: fas.NOMINEE_NEUMINI.address,
    });
    await equityToken.amendAgreement(publicETOTerms.companyTokenHolderAgreement, {
      from: fas.NOMINEE_NEUMINI.address,
    });
    await checkETO(artifacts, CONFIG, etoCommitment.address);
    // todo: setup whitelist
    // setup and move into whitelist
    console.log("Setting start date and going into whitelist");
    const startDate = new web3.BigNumber(Math.floor(new Date() / 1000) - 3 * dayInSeconds);
    await etoCommitment._mockStartDate(etoTerms.address, equityToken.address, startDate);
    await etoCommitment.handleStateTransitions();
    let state = (await etoCommitment.state()).toNumber();
    if (state !== CommitmentState.Whitelist) {
      throw new Error(
        `eto commitment ${etoCommitment.address} not in state ${
          CommitmentState.Whitelist
        } but in ${state}`,
      );
    }
    // todo: invest from whitelist
    console.log("Going to public");
    const whitelistD = publicETOTerms.durTerms.WHITELIST_DURATION.add(1);
    await etoCommitment._mockShiftBackTime(whitelistD);
    await etoCommitment.handleStateTransitions();
    state = (await etoCommitment.state()).toNumber();
    if (state !== CommitmentState.Public) {
      throw new Error(
        `eto commitment ${etoCommitment.address} not in state ${
          CommitmentState.Public
        } but in ${state}`,
      );
    }
    // todo: public investments
    // console.log(await etoCommitment.startOfStates());
    // write eto fixtures description
    const describedETOs = {};
    const desc = await describeETO(etoCommitment, publicETOTerms, state);
    describedETOs[etoCommitment.address] = stringify(desc);

    const path = join(__dirname, "../build/eto_fixtures.json");
    fs.writeFile(path, JSON.stringify(describedETOs), err => {
      if (err) throw new Error(err);
    });
    console.log(`ETOs described in ${path}`);
    // throw new Error("STOP");
  });
};

async function describeETO(etoCommitment, etoDefinition, state, whitelist, investors) {
  const desc = {
    address: etoCommitment.address,
    name: etoDefinition.name,
    state,
    startDate: await etoCommitment.startOf(1),
    definition: etoDefinition,
  };
  if (whitelist) {
    desc.whitelist = whitelist;
  }
  if (investors) {
    desc.investors = investors;
  }
  return desc;
}
