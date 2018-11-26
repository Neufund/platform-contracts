/* eslint-disable no-console */
/* eslint-disable no-continue */

require("babel-register");
const moment = require("moment");
const commandLineArgs = require("command-line-args");
const confirm = require("node-ask").confirm;
const fs = require("fs");
const { join } = require("path");
const deployETO = require("../migrations/deployETO").deployETO;
const getConfig = require("../migrations/config").getConfig;
const getDeployerAccount = require("../migrations/config").getDeployerAccount;

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
    console.log(`Expected parameters:`);
    console.log(optionDefinitions);
    throw e;
  }

  const CONFIG = getConfig(web3, options.network, []);
  const DEPLOYER = getDeployerAccount(options.network, []);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const universe = await Universe.at(options.universe);
  const Q18 = CONFIG.Q18;

  const path = join(__dirname, "..", options.definition);
  const contents = fs.readFileSync(path);
  const parsed = JSON.parse(contents);

  // recover bignumbers

  function recoverBigNumbers(terms) {
    const mod = {};
    for (const k of Object.keys(terms)) {
      if (typeof terms[k] === "string") {
        try {
          mod[k] = new web3.BigNumber(terms[k]);
        } catch (e) {
          mod[k] = terms[k];
        }
        continue;
      }
      if (typeof terms[k] === "boolean") {
        mod[k] = terms[k];
        continue;
      }
      throw new Error(
        `Only boolean and string types are allowed in terms! Integers must be strings: ${k}`,
      );
    }
    return mod;
  }

  function explainTerms(name, terms) {
    console.log(`\n${name}:`);
    for (const k of Object.keys(terms)) {
      if (typeof terms[k] === "object" && terms[k].constructor.name.includes("BigNumber")) {
        if (terms[k].gte(Q18.div(1000))) {
          console.log(
            `${k}: ${terms[k].toString(10)} == ${terms[k].div(Q18).toString(10)} * 10**18`,
          );
        } else if (k.endsWith("_DURATION")) {
          const duration = moment.duration(terms[k].toNumber() * 1000);
          console.log(`${k}: ${terms[k].toString(10)} = ${duration.humanize()}`);
        } else {
          console.log(`${k}: ${terms[k].toString(10)}`);
        }
      } else {
        console.log(`${k}: ${terms[k]}`);
      }
    }
  }

  const etoTerms = recoverBigNumbers(parsed.etoTerms);
  const shareholderTerms = recoverBigNumbers(parsed.shareholderTerms);
  const durTerms = recoverBigNumbers(parsed.durTerms);
  const tokenTerms = recoverBigNumbers(parsed.tokenTerms);

  explainTerms("etoTerms", etoTerms);
  explainTerms("shareholderTerms", shareholderTerms);
  explainTerms("durTerms", durTerms);
  explainTerms("tokenTerms", tokenTerms);
  console.log(`\ncompany: ${parsed.company}`);
  console.log(`nominee: ${parsed.nominee}`);
  console.log(`DEPLOYER is ${DEPLOYER}`);
  if (!(await confirm("Are you sure you want to deploy? [y/n] "))) {
    throw new Error("Aborting!");
  }

  try {
    await deployETO(
      artifacts,
      DEPLOYER,
      CONFIG,
      universe,
      parsed.nominee,
      parsed.company,
      etoTerms,
      shareholderTerms,
      durTerms,
      tokenTerms,
    );
  } catch (e) {
    console.log(e);
    throw e;
  }
};
