require("babel-register");
const registerSingletons = require("../test/helpers/registerSingletons").default;
const roles = require("../test/helpers/roles").default;
const knownInterfaces = require("../test/helpers/knownInterfaces").default;
const { TriState } = require("../test/helpers/triState");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // do not deploy testing network
  if (CONFIG.shouldSkipDeployment) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const EthereumForkArbiter = artifacts.require(CONFIG.artifacts.ETHEREUM_FORK_ARBITER);
  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const EuroTokenController = artifacts.require(CONFIG.artifacts.EURO_TOKEN_CONTROLLER);
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
  const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const SimpleExchange = artifacts.require(CONFIG.artifacts.SIMPLE_EXCHANGE);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);

  deployer.then(async () => {
    // take all ICBM addresses from commitment contract
    const commitment = await Commitment.deployed();
    const accessPolicy = await RoleBasedAccessPolicy.at(await commitment.accessPolicy());
    const forkArbiter = await EthereumForkArbiter.at(await commitment.ethereumForkArbiter());
    const icbmEtherLock = await ICBMLockedAccount.at(await commitment.etherLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await commitment.euroLock());
    const neumark = await Neumark.at(await commitment.neumark());

    // deployer will set some permissions so access is required
    const DEPLOYER = getDeployerAccount(network, accounts);
    console.log(`Checking if DEPLOYER ${DEPLOYER} has access to accessPolicy`);
    const hasAccess = await accessPolicy.allowed.call(
      DEPLOYER,
      roles.accessController,
      accessPolicy.address,
      "",
    );
    if (!hasAccess === true) {
      throw new Error("DEPLOYER must be able to change permissions to run this script");
    }
    console.log("Universe deploying...");
    await deployer.deploy(Universe, accessPolicy.address, forkArbiter.address);
    const universe = await Universe.deployed();
    console.log("IdentityRegistry deploying...");
    await deployer.deploy(IdentityRegistry, universe.address);
    const identityRegistry = await IdentityRegistry.deployed();
    console.log("Deploying EtherToken");
    await deployer.deploy(EtherToken, accessPolicy.address);
    const etherToken = await EtherToken.deployed();
    console.log("Deploying EuroTokenController");
    await deployer.deploy(EuroTokenController, universe.address);
    const tokenController = await EuroTokenController.deployed();
    console.log("Deploying EuroToken");
    await deployer.deploy(EuroToken, accessPolicy.address, tokenController.address);
    const euroToken = await EuroToken.deployed();
    console.log("Deploying LockedAccounts");
    await deployer.deploy(
      LockedAccount,
      universe.address,
      neumark.address,
      etherToken.address,
      icbmEtherLock.address,
    );
    const etherLock = await LockedAccount.deployed();
    await deployer.deploy(
      LockedAccount,
      universe.address,
      neumark.address,
      euroToken.address,
      icbmEuroLock.address,
    );
    const euroLock = await LockedAccount.deployed();
    console.log("Deploying SimpleExchange");
    await deployer.deploy(
      SimpleExchange,
      accessPolicy.address,
      euroToken.address,
      etherToken.address,
    );
    const simpleExchange = await SimpleExchange.deployed();

    console.log("Setting permissions to Universe");
    await accessPolicy.setUserRole(
      CONFIG.addresses.UNIVERSE_MANAGER,
      roles.universeManager,
      universe.address,
      TriState.Allow,
    );

    console.log("Add singletons to Universe");
    const interfaces = [
      {
        ki: knownInterfaces.etherToken,
        addr: etherToken.address,
      },
      {
        ki: knownInterfaces.euroToken,
        addr: euroToken.address,
      },
      {
        ki: knownInterfaces.euroLock,
        addr: euroLock.address,
      },
      {
        ki: knownInterfaces.etherLock,
        addr: etherLock.address,
      },
      {
        ki: knownInterfaces.gasExchange,
        addr: simpleExchange.address,
      },
      {
        ki: knownInterfaces.icbmEtherLock,
        addr: icbmEtherLock.address,
      },
      {
        ki: knownInterfaces.icbmEuroLock,
        addr: icbmEuroLock.address,
      },
      {
        ki: knownInterfaces.identityRegistry,
        addr: identityRegistry.address,
      },
      {
        ki: knownInterfaces.tokenExchangeRateOracle,
        addr: simpleExchange.address,
      },
      {
        ki: knownInterfaces.feeDisbursal,
        addr: CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
      },
    ];
    await registerSingletons(universe, CONFIG.addresses.UNIVERSE_MANAGER, interfaces);
  });
};
