require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const DEPLOYER = getDeployerAccount(network, accounts);

  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);

  deployer.then(async () => {
    // skip for pure live deployment
    if (CONFIG.isLiveDeployment && !CONFIG.ISOLATED_UNIVERSE) return;

    const universe = await Universe.deployed();
    const euroToken = await EuroToken.at(await universe.euroToken());
    const etherToken = await EtherToken.at(await universe.etherToken());
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());
    const icbmEuroToken = await ICBMEuroToken.at(await icbmEuroLock.assetToken());

    const fas = getFixtureAccounts(accounts);
    // setup fixture accounts
    console.log("deposit in EtherToken");
    await etherToken.deposit({
      from: fas.INV_HAS_ETH_T_NO_KYC.address,
      value: CONFIG.Q18.mul(1187.198273981),
    });
    await etherToken.deposit({
      from: fas.INV_EUR_ICBM_HAS_KYC.address,
      value: CONFIG.Q18.mul(387.198273981),
    });

    await etherToken.deposit({
      from: fas.INV_EUR_ICBM_HAS_KYC_2.address,
      value: CONFIG.Q18.mul(387.198273981),
    });

    console.log("deposit in EuroToken");
    await euroToken.deposit(fas.INV_HAS_EUR_HAS_KYC.address, CONFIG.Q18.mul(10278127.1988), "0x0", {
      from: DEPLOYER,
    });
    await euroToken.deposit(fas.INV_ICBM_EUR_M_HAS_KYC.address, CONFIG.Q18.mul(1271.1988), "0x0", {
      from: DEPLOYER,
    });

    console.log("let euroLock to receive and send old euro token");
    await icbmEuroToken.setAllowedTransferFrom(euroLock.address, true);
    await icbmEuroToken.setAllowedTransferTo(euroLock.address, true);

    console.log("migrating locked accounts");
    await icbmEtherLock.migrate({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address });
    await icbmEtherLock.migrate({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP.address });
    await icbmEtherLock.migrate({
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP_HAS_NEUR_AND_NO_ETH.address,
    });
    await icbmEtherLock.migrate({ from: fas.INV_ICBM_ETH_M_HAS_KYC.address });
    await icbmEtherLock.migrate({ from: fas.INV_ICBM_ETH_M_HAS_KYC_DUP.address });
    await icbmEtherLock.migrate({ from: fas.INV_ICBM_ETH_M_HAS_KYC_DUP_2.address });
    await icbmEtherLock.migrate({ from: fas.INV_ICBM_ETH_M_HAS_KYC_DUP_HAS_NEURO.address });
    await icbmEuroLock.migrate({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address });
    await icbmEuroLock.migrate({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP.address });
    await icbmEuroLock.migrate({ from: fas.INV_ICBM_ETH_M_HAS_KYC_DUP_HAS_NEURO.address });
    await icbmEuroLock.migrate({
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP_HAS_NEUR_AND_NO_ETH.address,
    });
    await icbmEuroLock.migrate({ from: fas.INV_ICBM_EUR_M_HAS_KYC.address });
  });
};
