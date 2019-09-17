/* eslint-disable no-console */
/* eslint-disable no-continue */

require("babel-register");
const commandLineArgs = require("command-line-args");
const confirm = require("node-ask").confirm;
const roles = require("../test/helpers/roles").default;
const fs = require("fs");
const { join } = require("path");
const deployETOTermsConstraintsUniverse = require("../test/helpers/deployTerms")
  .deployETOTermsConstraintsUniverse;
const { explainTerms, printConstants, good, wrong } = require("./helpers");
const getConfig = require("../migrations/config").getConfig;
const getDeployerAccount = require("../migrations/config").getDeployerAccount;
const recoverBigNumbers = require("../test/helpers/constants").recoverBigNumbers;
const promisify = require("../test/helpers/evmCommands").promisify;
const Q18 = require("../test/helpers/constants").Q18;

module.exports = async function deploy() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "universe", type: String },
    { name: "definition", type: String },
    { name: "usemock", type: Boolean },
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
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const etoTermsContraintsArtifactName = options.usemock
    ? "MockETOTermsConstraints"
    : "ETOTermsConstraints";
  const ETOTermsConstraints = artifacts.require(etoTermsContraintsArtifactName);

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const universe = await Universe.at(options.universe);
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());

  const path = join(__dirname, "..", options.definition);
  const contents = fs.readFileSync(path);
  const constraints = JSON.parse(contents);

  const updatedConstraints = recoverBigNumbers({
    ...constraints,
    TOKEN_OFFERING_OPERATOR: CONFIG[constraints.TOKEN_OFFERING_OPERATOR],
  });
  console.log(`using artifact: ${etoTermsContraintsArtifactName}`);
  explainTerms("etoTermsConstraints", updatedConstraints);
  if (!(await confirm("Are you sure you want to deploy? [y/n] "))) {
    throw new Error("Aborting!");
  }
  const canManageUniverse = await accessPolicy.allowed.call(
    DEPLOYER,
    roles.universeManager,
    universe.address,
    "",
  );
  console.log(
    `Checking if DEPLOYER ${DEPLOYER} manages Universe`,
    ...(canManageUniverse ? good("YES") : wrong("NO")),
  );
  const deployerBalance = await promisify(Universe.web3.eth.getBalance)(DEPLOYER);
  const deployerHasBalance = deployerBalance.gte(CONFIG.Q18.mul(0.5));
  const deployerBalanceEth = deployerBalance.div(Q18).round(4, 4);
  console.log(
    `Checking if DEPLOYER ${DEPLOYER} has 0.5 ETH`,
    ...(deployerHasBalance
      ? good(deployerBalanceEth.toNumber())
      : wrong(deployerBalanceEth.toNumber())),
  );

  if (!canManageUniverse || !deployerHasBalance) {
    throw new Error("Initial checks failed");
  }

  const [instance] = await deployETOTermsConstraintsUniverse(
    DEPLOYER,
    universe,
    ETOTermsConstraints,
    updatedConstraints,
  );
  await printConstants(instance);
  console.log(`ETOTermsConstraints deployed at ${instance.address}`);
};
