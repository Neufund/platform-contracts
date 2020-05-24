const confirm = require("node-ask").confirm;
const promisify = require("../test/helpers/utils").promisify;

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
