const fs = require("fs");
const { join } = require("path");
const confirm = require("node-ask").confirm;
const promisify = require("../test/helpers/utils").promisify;
const { dayInSeconds, DAY_SNAPSHOT } = require("../test/helpers/constants");

export async function initializeMigrationStep(config, artifacts, web3) {
  const Universe = artifacts.require(config.artifacts.UNIVERSE);

  // recover universe
  if (config.isLiveDeployment && !config.UNIVERSE_ADDRESS) {
    throw Error("On live deployment UNIVERSE_ADDRESS must be set");
  }
  if (config.isLiveDeployment) {
    console.log("LIVE DEPLOYMENT");
    console.log("Deployment parameters:");
    console.log(`Recovered UNIVERSE: ${config.UNIVERSE_ADDRESS}`);
    console.log(config);
    if (!(await confirm("Are you sure you want to deploy? [y/n]"))) {
      throw new Error("Aborting!");
    }
  }
  let universe;
  if (config.UNIVERSE_ADDRESS) {
    universe = await Universe.at(config.UNIVERSE_ADDRESS);
  } else {
    universe = await Universe.deployed();
  }
  // set initial block
  if (global._initialBlockNo === undefined) {
    global._initialBlockNo = await promisify(web3.eth.getBlockNumber)();
  }

  return universe;
}

export function loadEtoFixtures() {
  const etoFixturesPath = join(__dirname, "../build/eto_fixtures.json");
  return JSON.parse(fs.readFileSync(etoFixturesPath));
}

export function getEtoFixtureByName(etoFixtures, name) {
  return etoFixtures[Object.keys(etoFixtures).find(k => etoFixtures[k].name === name)];
}

export async function shiftBackTime(
  etoCommitment,
  tokenController,
  votingCenter,
  equityToken,
  delta,
) {
  console.log(
    `shifting contract set of issuer ${await tokenController.companyLegalRepresentative()}
    by ${delta} s`,
  );
  // shifts all internal timestamp in ETO-related group of contracts
  if (equityToken) {
    // equity token may only by shifted by full days
    if (delta % dayInSeconds > 0) {
      throw new Error(
        `shift time on equity token must be in full days, is ${delta / dayInSeconds}`,
      );
    }
    const days = delta / dayInSeconds;
    await equityToken._decreaseSnapshots(DAY_SNAPSHOT.mul(days));
  }
  await etoCommitment._mockShiftBackTime(delta);
  await tokenController._mockShiftBackTime(delta);
  // shift all ongoing voting proposals
  if (votingCenter) {
    const resolutionIds = await tokenController.resolutionsList();
    for (const rid of resolutionIds) {
      const hasProposal = await votingCenter.hasProposal(rid);
      if (hasProposal) {
        console.log(`shifting proposal ${rid} by ${delta} s`);
        await votingCenter._shiftProposalDeadlines(rid, delta);
      }
    }
  }
}
