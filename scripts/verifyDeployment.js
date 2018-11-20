/* eslint-disable no-console */

require("babel-register");
const commandLineArgs = require("command-line-args");
const getConfig = require("../migrations/config").getConfig;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const deserializeClaims = require("../test/helpers/identityClaims").deserializeClaims;
const promisify = require("../test/helpers/evmCommands").promisify;
const stringify = require("../test/helpers/constants").stringify;

function wrong(s) {
  return ["\x1b[31m", s, "\x1b[0m"];
}

function good(s) {
  return ["\x1b[32m", s, "\x1b[0m"];
}

async function checkAgreement(contract, agreementName) {
  // amendment count is new function, does not work with NEU
  // const count = await contract.amendmentsCount();
  let hasAgreement;
  try {
    const firstAgreement = await contract.pastAgreement(0);
    hasAgreement = firstAgreement[1].gt(0);
  } catch (e) {
    hasAgreement = false;
  }
  const url = !hasAgreement ? "NOT SET" : (await contract.currentAgreement())[2];
  console.log(agreementName, ...(!hasAgreement ? wrong(url) : good(url)));
}

async function printConstants(contract) {
  for (const func of contract.abi) {
    if (func.type === "function" && func.constant && func.inputs.length === 0) {
      try {
        const output = await contract[func.name]();
        const display = stringify({ v: output }).v;
        console.log(`${func.name}:`, ...good(display));
      } catch (e) {
        console.log(`${func.name}`, ...wrong("REVERTED"));
      }
    }
  }
}

module.exports = async function inspectETO() {
  const optionDefinitions = [
    { name: "network", type: String },
    { name: "universe", type: String },
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

  const config = getConfig(web3, options.network, []);
  console.log(config);

  // get artifacts
  const Universe = artifacts.require(config.artifacts.UNIVERSE);
  const Neumark = artifacts.require(config.artifacts.NEUMARK);
  const RoleBasedAccessPolicy = artifacts.require(config.artifacts.ROLE_BASED_ACCESS_POLICY);
  const LockedAccount = artifacts.require(config.artifacts.LOCKED_ACCOUNT);
  const ICBMLockedAccount = artifacts.require(config.artifacts.ICBM_LOCKED_ACCOUNT);
  const EuroToken = artifacts.require(config.artifacts.EURO_TOKEN);
  const EuroTokenController = artifacts.require(config.artifacts.EURO_TOKEN_CONTROLLER);
  const ICBMEuroToken = artifacts.require(config.artifacts.ICBM_EURO_TOKEN);
  const IdentityRegistry = artifacts.require(config.artifacts.IDENTITY_REGISTRY);
  const ITokenExchangeRateOracle = artifacts.require(config.artifacts.TOKEN_EXCHANGE_RATE_ORACLE);
  const PlatformTerms = artifacts.require(config.artifacts.PLATFORM_TERMS);

  // find universe
  const universe = await Universe.at(options.universe);
  // is isolated?
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const neumarkAddress = await universe.neumark();
  const neumark = await Neumark.at(neumarkAddress);
  // neumark may have a separate access control in isolated universe
  const neuAccessPolicy = await RoleBasedAccessPolicy.at(await neumark.accessPolicy());
  console.log(await neumark.accessPolicy());
  console.log(
    `Isolated universe...${neuAccessPolicy.address === accessPolicy.address ? "NO" : "YES"}`,
  );
  await checkAgreement(universe, "Universe has ToS");
  // check if locked account migration is correctly enabled
  const [
    euroLockAddress,
    etherLockAddress,
    icbmEuroLockAddress,
    icbmEtherLockAddress,
  ] = await universe.getManySingletons([
    knownInterfaces.euroLock,
    knownInterfaces.etherLock,
    knownInterfaces.icbmEuroLock,
    knownInterfaces.icbmEtherLock,
  ]);
  const euroLock = await LockedAccount.at(euroLockAddress);
  const etherLock = await LockedAccount.at(etherLockAddress);
  const icbmEuroLock = await ICBMLockedAccount.at(icbmEuroLockAddress);
  const icbmEtherLock = await ICBMLockedAccount.at(icbmEtherLockAddress);
  const icbmEuroLockMigrationTarget = await icbmEuroLock.currentMigrationTarget();
  console.log(
    "ICBM Euro Lock has correct migration target",
    ...(icbmEuroLockMigrationTarget !== euroLockAddress
      ? wrong(`invalid: ${icbmEuroLockMigrationTarget}`)
      : good(icbmEuroLockMigrationTarget)),
  );
  const euroLockMigrationSource = await euroLock.currentMigrationSource();
  console.log(
    "Euro Lock has correct migration source",
    ...(euroLockMigrationSource !== icbmEuroLockAddress
      ? wrong(`invalid: ${euroLockMigrationSource}`)
      : good(euroLockMigrationSource)),
  );

  const icbmEtherLockMigrationTarget = await icbmEtherLock.currentMigrationTarget();
  console.log(
    "ICBM Ether Lock has correct migration target",
    ...(icbmEtherLockMigrationTarget !== etherLockAddress
      ? wrong(`invalid: ${icbmEtherLockMigrationTarget}`)
      : good(icbmEtherLockMigrationTarget)),
  );
  const etherLockMigrationSource = await etherLock.currentMigrationSource();
  console.log(
    "Ether Lock has correct migration source",
    ...(etherLockMigrationSource !== icbmEtherLockAddress
      ? wrong(`invalid: ${etherLockMigrationSource}`)
      : good(etherLockMigrationSource)),
  );
  // check if old euro token console.log("let euroLock to receive and send old euro token");
  const [
    euroTokenAddress,
    etherTokenAddress,
    icbmEuroTokenAddress,
  ] = await universe.getManySingletons([
    knownInterfaces.euroToken,
    knownInterfaces.etherToken,
    knownInterfaces.icbmEuroToken,
  ]);
  const euroToken = await EuroToken.at(euroTokenAddress);
  const icbmEuroToken = await ICBMEuroToken.at(icbmEuroTokenAddress);
  console.log(
    "Euro Lock can transfer FROM ICBM Euro Token",
    ...((await icbmEuroToken.allowedTransferFrom(euroLock.address)) ? good("YES") : wrong("NO")),
  );
  console.log(
    "Euro Lock can transfer TO ICBM Euro Token",
    ...((await icbmEuroToken.allowedTransferTo(euroLock.address)) ? good("YES") : wrong("NO")),
  );
  // check if PLATFORM_OPERATOR_WALLET is Verified
  const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
  console.log(`Platform Operator wallet is ${config.addresses.PLATFORM_OPERATOR_WALLET}`);
  const powClaims = await identityRegistry.getClaims(config.addresses.PLATFORM_OPERATOR_WALLET);
  const powDeserializedClaims = deserializeClaims(powClaims);
  const powIsVerified = Object.assign(...powDeserializedClaims).isVerified;
  console.log(
    `Checking if PLATFORM_OPERATOR_WALLET ${config.addresses.PLATFORM_OPERATOR_WALLET} is verified`,
    ...(powIsVerified ? good("YES") : wrong("NO")),
  );
  const powHasBankAccount = Object.assign(...powDeserializedClaims).hasBankAccount;
  console.log(
    `Checking if PLATFORM_OPERATOR_WALLET ${
      config.addresses.PLATFORM_OPERATOR_WALLET
    } is has bank account`,
    ...(powHasBankAccount ? good("YES") : wrong("NO")),
  );
  // check if various agreements are attached
  await checkAgreement(euroToken, "EuroToken Agreement");
  await checkAgreement(euroLock, "EuroLock Agreement");
  await checkAgreement(etherLock, "EtherLock Agreement");
  await checkAgreement(neumark, "Neumark Agreement");
  // check current EUR rate
  const rateOracle = await ITokenExchangeRateOracle.at(await universe.tokenExchangeRateOracle());
  const platformTerms = await PlatformTerms.at(await universe.platformTerms());
  const ethRate = await rateOracle.getExchangeRate(etherTokenAddress, euroTokenAddress);
  const rateExpirationDelta = await platformTerms.TOKEN_RATE_EXPIRES_AFTER();
  const now = new web3.BigNumber(Math.floor(new Date() / 1000));
  console.log("Obtained eth to eur rate ", ethRate[0].div(config.Q18).toNumber());
  const isRateExpired = ethRate[1].lte(now.sub(rateExpirationDelta));
  console.log("Checking if rate not expired", ...(!isRateExpired ? good("YES") : wrong("NO")));
  console.log("---------------------------------------------");
  // todo: check euro token controller settings and allowed transfers in euro token

  console.log("---------------------------------------------");
  // check balances of various services
  const transactingServices = {
    EURT_DEPOSIT_MANAGER: config.addresses.EURT_DEPOSIT_MANAGER,
    IDENTITY_MANAGER: config.addresses.IDENTITY_MANAGER,
    GAS_EXCHANGE: config.addresses.GAS_EXCHANGE,
    TOKEN_RATE_ORACLE: config.addresses.TOKEN_RATE_ORACLE,
    "GAS EXCHANGE CONTRACT": await universe.gasExchange(),
  };
  for (const service of Object.keys(transactingServices)) {
    const serviceBalance = await promisify(web3.eth.getBalance)(transactingServices[service]);
    console.log(
      `Service ${service} (${transactingServices[service]}) has balance ${serviceBalance
        .div(config.Q18)
        .toNumber()}`,
    );
  }
  console.log("---------------------------------------------");
  console.log("Balances of various managing accounts");
  for (const addr of Object.keys(config.addresses)) {
    const serviceBalance = await promisify(web3.eth.getBalance)(config.addresses[addr]);
    console.log(
      `Service ${addr} (${config.addresses[addr]}) has balance ${serviceBalance
        .div(config.Q18)
        .toNumber()}`,
    );
  }
  console.log("---------------------------------------------");
  console.log("Dump Universe:");
  await printConstants(universe);
  console.log("---------------------------------------------");
  console.log("Dump Platform Terms:");
  await printConstants(platformTerms);
  console.log("---------------------------------------------");
  console.log("Dump Euro Token Controller:");
  const tokenController = await EuroTokenController.at(await euroToken.tokenController());
  async function allowsTransferTo(c) {
    const addr = await universe[c]();
    const allowed = await tokenController.allowedTransferTo(addr);
    console.log(`Allows transfer TO ${c} (${addr})`, ...(allowed ? good("YES") : wrong("NO")));
  }
  await allowsTransferTo("feeDisbursal");
  await allowsTransferTo("euroLock");
  await allowsTransferTo("gasExchange");
  async function allowsTransferFrom(c) {
    const addr = await universe[c]();
    const allowed = await tokenController.allowedTransferFrom(addr);
    console.log(`Allows transfer FROM ${c} (${addr})`, ...(allowed ? good("YES") : wrong("NO")));
  }
  await allowsTransferFrom("feeDisbursal");
  await allowsTransferFrom("euroLock");
  await allowsTransferFrom("gasExchange");
  console.log();
  const minDeposit = await tokenController.minDepositAmountEurUlps();
  console.log(`Euro Token Controller min deposit ${minDeposit.div(config.Q18).toNumber()}`);
  const minWithdraw = await tokenController.minWithdrawAmountEurUlps();
  console.log(`Euro Token Controller min withdraw ${minWithdraw.div(config.Q18).toNumber()}`);
  const maxAllowance = await tokenController.maxSimpleExchangeAllowanceEurUlps();
  console.log(
    `Euro Token Controller max simple exchange ${maxAllowance.div(config.Q18).toNumber()}`,
  );
};
