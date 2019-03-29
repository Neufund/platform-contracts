require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const Q18 = require("../test/helpers/constants").Q18;
const { TriState, GLOBAL } = require("../test/helpers/triState");
const roles = require("../test/helpers/roles").default;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);

  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    const universe = await Universe.deployed();
    const feeDisbursalAddress = await universe.feeDisbursal();
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    const etherToken = await EtherToken.at(await universe.etherToken());
    const euroToken = await EuroToken.at(await universe.euroToken());
    const neumark = await Neumark.at(await universe.neumark());
    // make deployer to be able to disburse
    await accessPolicy.setUserRole(DEPLOYER, roles.disburser, GLOBAL, TriState.Allow);

    // advance snapshot so payout is distributed (payouts from ETO)
    await neumark.createSnapshot();

    // distribute into next snapshot
    console.log("Disbursing some ETH to NEU holders");
    const ethDisbursalAmount = Q18.times(128.12812);
    await etherToken.depositAndTransfer(feeDisbursalAddress, ethDisbursalAmount, "", {
      value: ethDisbursalAmount,
    });
    console.log("Disbursing some EUR to NEU holders");
    const eurDisbursalAmount = Q18.times(110000.12812);
    await euroToken.depositAndTransfer(
      DEPLOYER,
      feeDisbursalAddress,
      eurDisbursalAmount,
      eurDisbursalAmount,
      "",
      "",
    );
    console.log("**Please note that disbursal seals 00:00 UTC or Neumark::createSnapshot**");
  });
};
