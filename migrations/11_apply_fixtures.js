require("babel-register");
const fs = require("fs");
const { join } = require("path");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./config").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;
const promisify = require("../test/helpers/evmCommands").promisify;

function toBytes32(hex) {
  return `0x${web3.padLeft(hex.slice(2), 64)}`;
}

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const fas = getFixtureAccounts(accounts);
  const DEPLOYER = getDeployerAccount(network, accounts);
  const SimpleExchange = artifacts.require(CONFIG.artifacts.GAS_EXCHANGE);
  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const ICBMEtherToken = artifacts.require(CONFIG.artifacts.ICBM_ETHER_TOKEN);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
  const ITokenExchangeRateOracle = artifacts.require(CONFIG.artifacts.TOKEN_RATE_ORACLE);
  const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);

  deployer.then(async () => {
    const universe = await Universe.deployed();

    console.log("set Euro LockedAccount migration");
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    await icbmEuroLock.enableMigration(euroLock.address);
    if ((await icbmEuroLock.currentMigrationTarget()) !== euroLock.address) {
      throw new Error("cannot set migrations for EuroLock");
    }

    console.log("set Ether LockedAccount migration");
    const etherLock = await LockedAccount.at(await universe.etherLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());
    await icbmEtherLock.enableMigration(etherLock.address);
    if ((await icbmEtherLock.currentMigrationTarget()) !== etherLock.address) {
      throw new Error("cannot set migrations for EtherLock");
    }

    console.log("set actual ETH and NEU to EUR price");
    const EUR_ETH_RATE = CONFIG.Q18.mul(new web3.BigNumber("360.9828182"));
    const EUR_NEU_RATE = CONFIG.Q18.mul(new web3.BigNumber("0.2828182"));
    const simpleExchange = await SimpleExchange.at(await universe.gasExchange());
    const euroTokenAddress = await universe.euroToken();
    const etherTokenAddress = await universe.etherToken();
    const neuTokenAddress = await universe.neumark();
    await simpleExchange.setExchangeRate(euroTokenAddress, etherTokenAddress, EUR_ETH_RATE, {
      from: DEPLOYER,
    });
    await simpleExchange.setExchangeRate(euroTokenAddress, neuTokenAddress, EUR_NEU_RATE, {
      from: DEPLOYER,
    });
    const tokenRateOracle = await ITokenExchangeRateOracle.at(
      await universe.tokenExchangeRateOracle(),
    );
    const currentETHRate = await tokenRateOracle.getExchangeRate(
      euroTokenAddress,
      etherTokenAddress,
    );
    if (!currentETHRate[0].eq(EUR_ETH_RATE)) {
      throw new Error("could not set EUR/ETH rate");
    }

    const currentNEURate = await tokenRateOracle.getExchangeRate(euroTokenAddress, neuTokenAddress);
    if (!currentNEURate[0].eq(EUR_NEU_RATE)) {
      throw new Error("could not set EUR/NEU rate");
    }

    // setup fixture accounts
    console.log("deposit in EtherToken");
    const etherToken = await EtherToken.at(await universe.etherToken());
    await etherToken.deposit({ from: fas.HAS_ETH_T_NO_KYC, value: CONFIG.Q18.mul(1187.198273981) });
    await etherToken.deposit({
      from: fas.ICBM_EUR_NOT_MIGRATED_HAS_KYC,
      value: CONFIG.Q18.mul(387.198273981),
    });

    console.log("set KYC, sophisiticated, bankAccount");
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
    await identityRegistry.setMultipleClaims(
      [
        fas.ICBM_EUR_NOT_MIGRATED_HAS_KYC,
        fas.ICBM_EUR_MIGRATED_HAS_KYC,
        fas.ICBM_EUR_ETH_NOT_MIGRATED_HAS_KYC,
        fas.HAS_EUR_HAS_KYC,
        fas.EMPTY_HAS_KYC,
      ],
      [toBytes32("0x0"), toBytes32("0x0"), toBytes32("0x0"), toBytes32("0x0"), toBytes32("0x0")],
      [toBytes32("0x1"), toBytes32("0x1"), toBytes32("0x7"), toBytes32("0x5"), toBytes32("0x1")],
      { from: DEPLOYER },
    );
    const claims = await identityRegistry.getClaims(fas.HAS_EUR_HAS_KYC);
    if (claims !== toBytes32("0x5")) {
      throw new Error("claims could not be set");
    }

    console.log("deposit in EuroToken");
    const euroToken = await EuroToken.at(await universe.euroToken());
    await euroToken.deposit(fas.HAS_EUR_HAS_KYC, CONFIG.Q18.mul(10278127.1988), {
      from: DEPLOYER,
    });
    await euroToken.deposit(fas.ICBM_EUR_MIGRATED_HAS_KYC, CONFIG.Q18.mul(1271.1988), {
      from: DEPLOYER,
    });

    console.log("migrating locked accounts");
    // todo: add migrations when tested

    console.log("add ether to test accounts");
    for (const f of Object.keys(fas)) {
      await promisify(web3.eth.sendTransaction)({
        from: DEPLOYER,
        to: fas[f],
        value: CONFIG.Q18.mul(14.21182),
      });
    }

    const neumark = await Neumark.at(await universe.neumark());
    const icbmEuroToken = await ICBMEuroToken.at(await icbmEuroLock.assetToken());
    const icbmEtherToken = await ICBMEtherToken.at(await icbmEtherLock.assetToken());

    const describeFixture = async address => {
      // get balances: ETH, neu, euro tokens, ethertokens
      const ethBalance = await promisify(web3.eth.getBalance)(address);
      const neuBalance = await neumark.balanceOf(address);
      const euroBalance = await euroToken.balanceOf(address);
      const ethTokenBalance = await etherToken.balanceOf(address);
      const icbmEuroBalance = await icbmEuroToken.balanceOf(address);
      const icbmEthTokenBalance = await icbmEtherToken.balanceOf(address);
      // get statuses of locked accounts
      const euroLockBalance = await euroLock.balanceOf(address);
      const etherLockBalance = await etherLock.balanceOf(address);
      const icbmEuroLockBalance = await icbmEuroLock.balanceOf(address);
      const icbmEtherLockBalance = await icbmEtherLock.balanceOf(address);
      // get identity claims
      const identityClaims = await identityRegistry.getClaims(address);

      return {
        ethBalance,
        neuBalance,
        euroBalance,
        ethTokenBalance,
        icbmEuroBalance,
        icbmEthTokenBalance,
        euroLockBalance,
        etherLockBalance,
        icbmEuroLockBalance,
        icbmEtherLockBalance,
        identityClaims,
      };
    };

    const stringify = o => {
      const op = {};
      for (const p of Object.keys(o)) {
        if (typeof o[p] === "string") {
          op[p] = o[p];
        } else if (typeof o[p][Symbol.iterator] === "function") {
          op[p] = Array.from(o[p]).map(e => e.toString(10));
        } else {
          op[p] = o[p].toString(10);
        }
      }
      return op;
    };

    const describedFixtures = {};
    for (const f of Object.keys(fas)) {
      const desc = await describeFixture(fas[f]);
      desc.name = f;
      describedFixtures[fas[f]] = stringify(desc);
    }

    const path = join(__dirname, "../build/fixtures.json");
    fs.writeFile(path, JSON.stringify(describedFixtures), err => {
      if (err) throw new Error(err);
    });
    console.log(`Fixtures described in ${path}`);
  });
};
