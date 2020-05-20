/* eslint-disable no-console */
/* eslint-disable no-continue */

require("babel-register");
const request = require("request-promise-native");
const commandLineArgs = require("command-line-args");
const confirm = require("node-ask").confirm;
const fs = require("fs");
const { join } = require("path");
const deployETO = require("../migrations/deployETO").deployETO;
const canDeployETO = require("../migrations/deployETO").canDeployETO;
const deployGovLib = require("../migrations/deployETO").deployGovLib;
const getConfig = require("../migrations/config").getConfig;
const getDeployerAccount = require("../migrations/config").getDeployerAccount;
const recoverBigNumbers = require("../test/helpers/constants").recoverBigNumbers;
const { explainTerms, printConstants } = require("./helpers");

module.exports = async function deploy() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "universe", type: String },
    { name: "definition", type: String },
    { name: "exec", type: String, multiple: true, defaultOption: true },
  ];

  let options;
  try {
    options = commandLineArgs(optionDefinitions);
  } catch (e) {
    console.log(`Invalid command line: ${e}`);
    console.log("Expected parameters:");
    console.log(optionDefinitions);
    console.log("where definition is a file path or url to eto listing api");
    throw e;
  }

  const CONFIG = getConfig(web3, options.network, []);
  const DEPLOYER = getDeployerAccount(options.network, []);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const ETOTermsConstraints = artifacts.require(CONFIG.artifacts.ETO_TERMS_CONSTRAINTS);
  const universe = await Universe.at(options.universe);

  let parsed;
  if (options.definition.substr(0, 4) === "http") {
    console.log(`Getting eto data from ${options.definition}`);
    const etoData = await request({
      url: options.definition,
      json: true,
    });
    if (etoData.state !== "prospectus_approved") {
      throw new Error(`eto must be in prospectus_approved state, not in ${etoData.state}`);
    }
    parsed = etoData.investment_calculated_values.eto_terms;
    const path = join(
      __dirname,
      "..",
      `terms_${etoData.eto_id}-${etoData.equity_token_symbol}.json`,
    );
    const contents = JSON.stringify(parsed);
    fs.writeFileSync(path, contents);
    console.log(`Obtained etoTerms structure successfully, wrote to ${path}`);
  } else {
    const path = join(__dirname, "..", options.definition);
    const contents = fs.readFileSync(path);
    parsed = JSON.parse(contents);
  }
  // parsed.eto_terms["ETO_TERMS_CONSTRAINTS"] = "0x5a7523368646E116288848074eA2f1bD5DeF0c21";
  const etoTerms = recoverBigNumbers(parsed.eto_terms);
  const tokenholderTerms = recoverBigNumbers(parsed.tokenholder_rights);
  const durTerms = recoverBigNumbers(parsed.duration_terms);
  const tokenTerms = recoverBigNumbers(parsed.token_terms);

  explainTerms("etoTerms", etoTerms);
  explainTerms("tokenholderTerms", tokenholderTerms);
  explainTerms("durTerms", durTerms);
  explainTerms("tokenTerms", tokenTerms);
  console.log("\nETO Terms Constaints:");
  const constraints = await ETOTermsConstraints.at(etoTerms.ETO_TERMS_CONSTRAINTS);
  await printConstants(constraints);
  console.log(`\ncompany: ${parsed.company}`);
  console.log(`nominee: ${parsed.nominee}`);
  console.log(`DEPLOYER is ${DEPLOYER}`);
  if (!(await confirm("Are you sure you want to deploy? [y/n] "))) {
    throw new Error("Aborting!");
  }

  try {
    const [canDeploy, canControlNeu] = await canDeployETO(artifacts, DEPLOYER, CONFIG, universe);
    if (!canDeploy) {
      throw new Error("ETO deployment checks failed");
    }
    const govLib = await deployGovLib(artifacts);
    await deployETO(
      artifacts,
      DEPLOYER,
      CONFIG,
      universe,
      parsed.nominee,
      parsed.company,
      etoTerms,
      tokenholderTerms,
      durTerms,
      tokenTerms,
      etoTerms.ETO_TERMS_CONSTRAINTS,
      govLib,
      canControlNeu,
    );
  } catch (e) {
    console.log(e);
    throw e;
  }
};
