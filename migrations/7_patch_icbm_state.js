require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./config").getFixtureAccounts;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // skip fixtures on live deployment
  if (CONFIG.shouldSkipDeployment || CONFIG.isLiveDeployment) return;
  const fas = getFixtureAccounts(accounts);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);

  deployer.then(async () => {
    const commitment = await Commitment.deployed();
    const euroToken = await ICBMEuroToken.deployed();
    console.log("set Commitment to public phase");
    await commitment._mockTransitionTo(1);
    await commitment._mockTransitionTo(2);
    console.log("commit ETH");
    await commitment.commit({
      from: fas.ICBM_ETH_NOT_MIGRATED_NO_KYC,
      value: CONFIG.Q18.mul(61.1289798),
    });
    await commitment.commit({
      from: fas.ICBM_EUR_ETH_NOT_MIGRATED_HAS_KYC,
      value: CONFIG.Q18.mul(18.1289798),
    });
    await commitment.commit({
      from: fas.ICBM_ETH_MIGRATED_NO_KYC,
      value: CONFIG.Q18.mul(11.1289798),
    });
    console.log("commit EUR");
    let amountEur = CONFIG.Q18.mul(1781267);
    await euroToken.deposit(fas.ICBM_EUR_NOT_MIGRATED_HAS_KYC, amountEur);
    await euroToken.approve(commitment.address, amountEur, {
      from: fas.ICBM_EUR_NOT_MIGRATED_HAS_KYC,
    });
    await commitment.commitEuro({ from: fas.ICBM_EUR_NOT_MIGRATED_HAS_KYC });
    amountEur = CONFIG.Q18.mul(71827);
    await euroToken.deposit(fas.ICBM_EUR_ETH_NOT_MIGRATED_HAS_KYC, amountEur);
    await euroToken.approve(commitment.address, amountEur, {
      from: fas.ICBM_EUR_ETH_NOT_MIGRATED_HAS_KYC,
    });
    await commitment.commitEuro({ from: fas.ICBM_EUR_ETH_NOT_MIGRATED_HAS_KYC });
    amountEur = CONFIG.Q18.mul(812988.1988);
    await euroToken.deposit(fas.ICBM_EUR_MIGRATED_HAS_KYC, amountEur);
    await euroToken.approve(commitment.address, amountEur, { from: fas.ICBM_EUR_MIGRATED_HAS_KYC });
    await commitment.commitEuro({ from: fas.ICBM_EUR_MIGRATED_HAS_KYC });
    console.log("set Commitment to final phase");
    await commitment._mockTransitionTo(3);
  });
};
