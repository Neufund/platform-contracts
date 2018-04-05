require("babel-register");
const getConfig = require("./config").getConfig;
const confirm = require("node-ask").confirm;
const moment = require("moment");

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // do not deploy testing network
  if (CONFIG.shouldSkipDeployment) return;

  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const EthereumForkArbiter = artifacts.require(CONFIG.artifacts.ETHEREUM_FORK_ARBITER);
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const ICBMEtherToken = artifacts.require(CONFIG.artifacts.ICBM_ETHER_TOKEN);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);

  console.log("----------------------------------");
  console.log("Deployment parameters:");
  console.log(CONFIG);
  const startDate = moment.unix(CONFIG.START_DATE);
  console.log(`START_DATE is ${startDate.format()} (local) ${startDate.utc().format()} (UTC)`);
  console.log("----------------------------------");

  deployer.then(async () => {
    // check deployment date
    if (CONFIG.START_DATE - new Date().getTime() / 1000 < 24 * 60 * 60) {
      console.log(`Commitment will start in less then 24h. `);
    }
    console.log(`network is ${network}`);
    if (CONFIG.isLiveDeployment) {
      console.log("LIVE DEPLOYMENT");
      if (!await confirm("Are you sure you want to deploy? [y/n] ")) {
        throw new Error("Aborting!");
      }
    }
    console.log("AccessPolicy deployment...");
    await deployer.deploy(RoleBasedAccessPolicy);
    const accessPolicy = await RoleBasedAccessPolicy.deployed();

    console.log("EthereumForkArbiter deployment...");
    await deployer.deploy(EthereumForkArbiter, accessPolicy.address);
    const ethereumForkArbiter = await EthereumForkArbiter.deployed();

    console.log("Neumark deploying...");
    await deployer.deploy(Neumark, accessPolicy.address, ethereumForkArbiter.address);
    const neumark = await Neumark.deployed();

    console.log("ICBMEtherToken deploying...");
    await deployer.deploy(ICBMEtherToken, accessPolicy.address);
    const etherToken = await ICBMEtherToken.deployed();

    console.log("ICBMEuroToken deploying...");
    await deployer.deploy(ICBMEuroToken, accessPolicy.address);
    const euroToken = await ICBMEuroToken.deployed();

    console.log("ICBMLockedAccount(ICBMEtherToken) deploying...");
    await deployer.deploy(
      ICBMLockedAccount,
      accessPolicy.address,
      etherToken.address,
      neumark.address,
      CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
      CONFIG.LOCK_DURATION,
      CONFIG.PENALTY_FRACTION,
    );
    const etherLock = await ICBMLockedAccount.deployed();

    console.log("ICBMLockedAccount(ICBMEuroToken) deploying...");
    await deployer.deploy(
      ICBMLockedAccount,
      accessPolicy.address,
      euroToken.address,
      neumark.address,
      CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
      CONFIG.LOCK_DURATION,
      CONFIG.PENALTY_FRACTION,
    );
    const euroLock = await ICBMLockedAccount.deployed();

    console.log("Commitment deploying...");
    await deployer.deploy(
      Commitment,
      accessPolicy.address,
      ethereumForkArbiter.address,
      CONFIG.START_DATE,
      CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
      neumark.address,
      etherToken.address,
      euroToken.address,
      etherLock.address,
      euroLock.address,
      CONFIG.CAP_EUR,
      CONFIG.MIN_TICKET_EUR,
      CONFIG.ETH_EUR_FRACTION,
    );
    const commitment = await Commitment.deployed();

    console.log("Contracts deployed!");
  });
};
