require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;
const Q18 = require("../test/helpers/constants").Q18;
const promisify = require("../test/helpers/utils").promisify;
const { loadEtoFixtures, getEtoFixtureByName } = require("./helpers");

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
  const EquityToken = artifacts.require(CONFIG.artifacts.STANDARD_EQUITY_TOKEN);

  deployer.then(async () => {
    const fas = getFixtureAccounts(accounts);
    const sender = fas.INV_HAS_EUR_HAS_KYC.address;
    const receiver = fas.INV_HAS_ETH_T_NO_KYC.address;

    const universe = await Universe.deployed();
    const etherToken = await EtherToken.at(await universe.etherToken());
    const neumark = await Neumark.at(await universe.neumark());

    // send ETH to someone
    await promisify(web3.eth.sendTransaction)({
      from: sender,
      to: receiver,
      value: Q18.mul(2.2812),
      gasPrice: 100,
      gas: 21000,
    });
    // send NEU to someone
    await neumark.transfer(receiver, Q18.mul(65.3761), { from: sender });
    // send claimed token to someone
    const etoFixtures = loadEtoFixtures();
    const claimFixture = getEtoFixtureByName(etoFixtures, "ETOInClaimState");
    const equityToken = await EquityToken.at(claimFixture.equityToken);
    // const tokenController = await SingleEquityTokenController.at(await equityToken.tokenController());
    // console.log(await tokenController.onTransfer(sender, sender, receiver, 7));
    await equityToken.transfer(receiver, 7, { from: sender });
    // withdraw and send
    await etherToken.withdrawAndSend(receiver, Q18.mul(1.7621), {
      from: sender,
      value: Q18.mul(0.7621),
    });
    // send to itself via token and native
    await neumark.transfer(sender, Q18.mul(1.1), { from: sender });
    await promisify(web3.eth.sendTransaction)({
      from: sender,
      to: sender,
      value: Q18.mul(0.1213),
      gasPrice: 100,
      gas: 21000,
    });
  });
};
