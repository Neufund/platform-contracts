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
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);

  deployer.then(async () => {
    // skip for pure live deployment
    if (CONFIG.isLiveDeployment && !CONFIG.ISOLATED_UNIVERSE) return;

    const universe = await Universe.deployed();
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const etherLock = await LockedAccount.at(await universe.etherLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());
    const icbmEuroToken = await ICBMEuroToken.at(await icbmEuroLock.assetToken());
    const neumark = await Neumark.at(await universe.neumark());

    const fas = getFixtureAccounts(accounts);

    console.log("let euroLock to receive and send old euro token");
    await icbmEuroToken.setAllowedTransferFrom(euroLock.address, true);
    await icbmEuroToken.setAllowedTransferTo(euroLock.address, true);

    console.log("migrating locked accounts");
    for (const f of Object.keys(fas)) {
      if (fas[f].icbmMigrations && fas[f].icbmMigrations.etherToken) {
        await icbmEtherLock.migrate({ from: fas[f].address });
        const lockedEthbalanceResult = await etherLock.balanceOf(fas[f].address);
        console.log(
          `Account ${f} has ${lockedEthbalanceResult[0].div(CONFIG.Q18).toString()} ETH-T locked.`,
        );
      }

      if (fas[f].icbmMigrations && fas[f].icbmMigrations.euroToken) {
        await icbmEuroLock.migrate({ from: fas[f].address });
        const lockedEuroBalanceResult = await euroLock.balanceOf(fas[f].address);
        console.log(
          `Account ${f} has ${lockedEuroBalanceResult[0].div(CONFIG.Q18).toString()} EUR-T locked.`,
        );
      }
    }

    async function unlock(lockedAccount, name, currency, lockType) {
      console.log(`${name} unlocks ${lockType} ${currency}`);
      let balance = await lockedAccount.balanceOf(fas[name].address);
      // return NEU to locked account
      await neumark.approveAndCall(lockedAccount.address, balance[1], "", {
        from: fas[name].address,
      });
      console.log(
        `Account ${name} has ${balance[0]
          .div(CONFIG.Q18)
          .toString()} ${lockType} ${currency} unlocked.`,
      );
      balance = await lockedAccount.balanceOf(fas[name].address);
      if (balance[0].gt(0)) {
        throw new Error(`Cannot unlock ${lockType} ${currency} ${fas[name].address}`);
      }
    }

    console.log("refund locked accounts");
    for (const f of Object.keys(fas)) {
      if (fas[f].icbmCommitment && fas[f].icbmCommitment.unlockEther) {
        await unlock(icbmEtherLock, f, "ETH", "ICBM");
      }

      if (fas[f].icbmCommitment && fas[f].icbmCommitment.unlockEuro) {
        await unlock(icbmEuroLock, f, "EUR", "ICBM");
      }

      if (fas[f].icbmMigrations && fas[f].icbmMigrations.unlockEther) {
        await unlock(etherLock, f, "ETH", "");
      }

      if (fas[f].icbmMigrations && fas[f].icbmMigrations.unlockEuro) {
        await unlock(euroLock, f, "EUR", "");
      }
    }
  });
};
