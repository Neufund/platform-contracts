require("babel-register");
const getConfig = require("./config").getConfig;
const roles = require("../test/helpers/roles").default;
// const getDeployerAccount = require("./config").getDeployerAccount;

const { TriState } = require("../test/helpers/triState");

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // skip fixtures on live deployment
  if (CONFIG.shouldSkipDeployment||CONFIG.isLiveDeployment) return;
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);

  // const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    const commitment = await Commitment.deployed();
    const euroToken = await ICBMEuroToken.deployed();
    const neumark = await Neumark.deployed();
    const accessPolicy = await RoleBasedAccessPolicy.deployed();
    console.log("set Commitment to public phase");
    await commitment._mockTransitionTo(1);
    await commitment._mockTransitionTo(2);
    console.log("commit ETH");
    await commitment.commit({ from: accounts[1], value: CONFIG.Q18.mul(61.1289798) });
    await commitment.commit({ from: accounts[3], value: CONFIG.Q18.mul(61.1289798) });
    console.log("commit EUR");
    let amountEur = CONFIG.Q18.mul(1781267);
    await euroToken.deposit(accounts[2], amountEur);
    await euroToken.approve(commitment.address, amountEur, { from: accounts[2] });
    await commitment.commitEuro({from: accounts[2]});
    amountEur = CONFIG.Q18.mul(71827);
    await euroToken.deposit(accounts[3], amountEur);
    await euroToken.approve(commitment.address, amountEur, { from: accounts[3] });
    await commitment.commitEuro({from: accounts[3]});
    console.log("set Commitment to final phase");
    await commitment._mockTransitionTo(3);
    // const finalized = await commitment.state();
    // const agreement = await commitment.currentAgreement();
    // console.log(agreement);
    console.log("drop permissions from icbm contracts");
    await accessPolicy.setUserRole(
      commitment.address,
      roles.neumarkIssuer,
      neumark.address,
      TriState.Unset,
    );
    await accessPolicy.setUserRole(
      commitment.address,
      roles.transferAdmin,
      neumark.address,
      TriState.Unset,
    );
  });
};
