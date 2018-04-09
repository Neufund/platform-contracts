require("babel-register");
const getConfig = require("./config").getConfig;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // do not deploy testing network
  if (CONFIG.shouldSkipDeployment) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const LockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const EuroTokenController = artifacts.require(CONFIG.artifacts.EURO_TOKEN_CONTROLLER);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);

  deployer.then(async () => {
    const universe = await Universe.deployed();
    const euroToken = await EuroToken.at(await universe.euroToken());
    const tokenController = await EuroTokenController.at(await euroToken.tokenController());

    console.log("Apply euro token controller settings");
    await tokenController.applySettings(
      CONFIG.MIN_DEPOSIT_AMOUNT_EUR_ULPS,
      CONFIG.MIN_WITHDRAW_AMOUNT_EUR_ULPS,
      CONFIG.MAX_SIMPLE_EXCHANGE_ALLOWANCE_EUR_ULPS,
    );

    if (!CONFIG.isLiveDeployment) {
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
    } else {
      console.log("---------------------------------------------");
      console.log("On live network, enable LockedAccount migrations manually");
      console.log("---------------------------------------------");
    }
  });
};
