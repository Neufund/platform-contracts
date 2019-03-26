require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./config").getFixtureAccounts;
const promisify = require("../test/helpers/evmCommands").promisify;
const getDeployerAccount = require("./config").getDeployerAccount;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  // skip fixtures on live deployment
  if (CONFIG.isLiveDeployment) return;

  const fas = getFixtureAccounts(accounts);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);

  deployer.then(async () => {
    const commitment = await Commitment.deployed();
    const euroToken = await ICBMEuroToken.deployed();
    console.log("set Commitment to public phase");
    await commitment._mockTransitionTo(1);
    await commitment._mockTransitionTo(2);

    const DEPLOYER = getDeployerAccount(network, accounts);

    console.log("add ether to test accounts");
    for (const f of Object.keys(fas)) {
      await promisify(web3.eth.sendTransaction)({
        from: DEPLOYER,
        to: fas[f].address,
        value: CONFIG.Q18.mul(1000000),
      });
    }

    console.log("commit ETH");
    await commitment.commit({
      from: fas.INV_ETH_ICBM_NO_KYC.address,
      value: CONFIG.Q18.mul(161.1289798),
    });
    await commitment.commit({
      from: fas.INV_ETH_ICBM_NO_KYC_2.address,
      value: CONFIG.Q18.mul(167.1289798),
    });
    await commitment.commit({
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address,
      value: CONFIG.Q18.mul(218.1289798),
    });
    await commitment.commit({
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP.address,
      value: CONFIG.Q18.mul(218.1289798),
    });
    await commitment.commit({
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP_HAS_NEUR_AND_NO_ETH.address,
      value: CONFIG.Q18.mul(218.1289798),
    });
    await commitment.commit({
      from: fas.INV_ICBM_ETH_M_HAS_KYC.address,
      value: CONFIG.Q18.mul(1211.1289798),
    });
    await commitment.commit({
      from: fas.INV_ICBM_ETH_M_HAS_KYC_DUP_2.address,
      value: CONFIG.Q18.mul(1211.1289798),
    });
    await commitment.commit({
      from: fas.INV_ICBM_ETH_M_HAS_KYC_DUP_HAS_NEURO.address,
      value: CONFIG.Q18.mul(1211.1289798),
    });
    await commitment.commit({
      from: fas.INV_ICBM_ETH_M_HAS_KYC_DUP.address,
      value: CONFIG.Q18.mul(1211.1289798),
    });
    console.log("commit EUR");
    let amountEur = CONFIG.Q18.mul(1781267);
    await euroToken.deposit(fas.INV_EUR_ICBM_HAS_KYC.address, amountEur);
    await euroToken.approve(commitment.address, amountEur, {
      from: fas.INV_EUR_ICBM_HAS_KYC.address,
    });
    await commitment.commitEuro({ from: fas.INV_EUR_ICBM_HAS_KYC.address });
    amountEur = CONFIG.Q18.mul(71827);
    await euroToken.deposit(fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address, amountEur);
    await euroToken.deposit(fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP.address, amountEur);
    await euroToken.deposit(
      fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP_HAS_NEUR_AND_NO_ETH.address,
      amountEur,
    );
    await euroToken.approve(commitment.address, amountEur, {
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address,
    });
    await euroToken.approve(commitment.address, amountEur, {
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP.address,
    });
    await euroToken.approve(commitment.address, amountEur, {
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP_HAS_NEUR_AND_NO_ETH.address,
    });
    await commitment.commitEuro({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address });
    await commitment.commitEuro({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP.address });
    await commitment.commitEuro({
      from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC_DUP_HAS_NEUR_AND_NO_ETH.address,
    });
    amountEur = CONFIG.Q18.mul(812988.1988);
    await euroToken.deposit(fas.INV_ICBM_EUR_M_HAS_KYC.address, amountEur);
    await euroToken.approve(commitment.address, amountEur, {
      from: fas.INV_ICBM_EUR_M_HAS_KYC.address,
    });
    await commitment.commitEuro({ from: fas.INV_ICBM_EUR_M_HAS_KYC.address });
    console.log("set Commitment to final phase");
    await commitment._mockTransitionTo(3);
  });
};
