require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);

  deployer.then(async () => {
    // skip for pure live deployment
    if (CONFIG.isLiveDeployment && !CONFIG.ISOLATED_UNIVERSE) return;

    const universe = await Universe.deployed();
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());
    const icbmEuroToken = await ICBMEuroToken.at(await icbmEuroLock.assetToken());

    const fas = getFixtureAccounts(accounts);

    console.log("let euroLock to receive and send old euro token");
    await icbmEuroToken.setAllowedTransferFrom(euroLock.address, true);
    await icbmEuroToken.setAllowedTransferTo(euroLock.address, true);

    console.log("migrating locked accounts");
    for (const f of Object.keys(fas)) {
      if (fas[f].icbmMigrations && fas[f].icbmMigrations.etherToken) {
        await icbmEtherLock.migrate({ from: fas[f].address });
        const lockedEthbalanceResult = await icbmEtherLock.balanceOf(fas[f].address);
        console.log(
          `Account ${f} has ${lockedEthbalanceResult[0].div(CONFIG.Q18).toString()} ETH-T locked.`,
        );
      }

      if (fas[f].icbmMigrations && fas[f].icbmMigrations.euroToken) {
        await icbmEuroLock.migrate({ from: fas[f].address });
        const lockedEuroBalanceResult = await icbmEtherLock.balanceOf(fas[f].address);
        console.log(
          `Account ${f} has ${lockedEuroBalanceResult[0].div(CONFIG.Q18).toString()} EUR-T locked.`,
        );
      }
    }
  });
};
