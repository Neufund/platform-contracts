require("babel-register");
const fs = require("fs");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./fixtures/accounts").getFixtureAccounts;
const stringify = require("../test/helpers/utils").stringify;
const { join } = require("path");
const promisify = require("../test/helpers/utils").promisify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  deployer.then(async () => {
    const fas = getFixtureAccounts(accounts);

    const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
    const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
    const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
    const ICBMEtherToken = artifacts.require(CONFIG.artifacts.ICBM_ETHER_TOKEN);
    const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
    const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
    const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);
    const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
    const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);

    const universe = await Universe.deployed();
    const euroToken = await EuroToken.at(await universe.euroToken());
    const etherToken = await EtherToken.at(await universe.etherToken());
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const etherLock = await LockedAccount.at(await universe.etherLock());
    const neumark = await Neumark.at(await universe.neumark());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());
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

    const describedFixtures = {};
    for (const f of Object.keys(fas)) {
      const desc = await describeFixture(fas[f].address);
      desc.name = f;
      desc.type = fas[f].type;
      desc.definition = fas[f];
      describedFixtures[fas[f].address] = stringify(desc);
    }

    const fixturesPath = join(__dirname, "../build/fixtures.json");
    fs.writeFile(fixturesPath, JSON.stringify(describedFixtures, null, 2), err => {
      if (err) throw new Error(err);
    });
    console.log(`Fixtures described in ${fixturesPath}`);
  });
};
