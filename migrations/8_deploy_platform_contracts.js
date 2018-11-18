require("babel-register");
const confirm = require("node-ask").confirm;
const registerSingletons = require("../test/helpers/registerSingletons").default;
const roles = require("../test/helpers/roles").default;
const knownInterfaces = require("../test/helpers/knownInterfaces").knownInterfaces;
const { TriState } = require("../test/helpers/triState");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const promisify = require("../test/helpers/evmCommands").promisify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

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
  const SimpleExchange = artifacts.require(CONFIG.artifacts.GAS_EXCHANGE);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);
  const PlatformTerms = artifacts.require(CONFIG.artifacts.PLATFORM_TERMS);

  deployer.then(async () => {
    // set initial block
    global._initialBlockNo = await promisify(web3.eth.getBlockNumber)();
    // take all ICBM addresses from commitment contract
    if (CONFIG.isLiveDeployment && !CONFIG.ICBM_COMMITMENT_ADDRESS) {
      throw Error("On live deployment ICBM_COMMITMENT_ADDRESS must be set");
    }
    // must have ether to deploy and initialize services
    const DEPLOYER = getDeployerAccount(network, accounts);
    console.log("checking if DEPLOYER has enough ETH");
    const deployerBalance = await promisify(web3.eth.getBalance)(DEPLOYER);
    if (deployerBalance.lt(CONFIG.Q18.mul(5))) {
      throw new Error(
        `DEPLOYER ${DEPLOYER} requires min 5 ETH balance, has ${deployerBalance.toNumber()}`,
      );
    }
    // obtain commitment contract
    let commitment;
    if (CONFIG.ICBM_COMMITMENT_ADDRESS) {
      console.log(`Deploying over ICBM contracts: Commitment ${CONFIG.ICBM_COMMITMENT_ADDRESS} `);
      commitment = await Commitment.at(CONFIG.ICBM_COMMITMENT_ADDRESS);
    } else {
      commitment = await Commitment.deployed();
    }
    let accessPolicy;
    // isolated universe will attach separate access controller to Universe and via this to platform contracts
    if (CONFIG.ISOLATED_UNIVERSE) {
      console.log(`Re-deploying RoleBasedAccessPolicy to isolate Universe`);
      await deployer.deploy(RoleBasedAccessPolicy);
      accessPolicy = await RoleBasedAccessPolicy.deployed();
    } else {
      const accessPolicyAddress = await commitment.accessPolicy();
      console.log(`Using ICBM RoleBasedAccessPolicy ${accessPolicyAddress} in ICBM Commitment`);
      accessPolicy = await RoleBasedAccessPolicy.at(accessPolicyAddress);
    }
    const forkArbiter = await EthereumForkArbiter.at(await commitment.ethereumForkArbiter());
    const icbmEtherLock = await ICBMLockedAccount.at(await commitment.etherLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await commitment.euroLock());
    const neumark = await Neumark.at(await commitment.neumark());

    // deployer will set some permissions so access is required
    console.log(`Checking if DEPLOYER ${DEPLOYER} has access to accessPolicy`);
    const hasAccess = await accessPolicy.allowed.call(
      DEPLOYER,
      roles.accessController,
      accessPolicy.address,
      "",
    );
    if (!hasAccess === true) {
      throw new Error(
        `DEPLOYER needs ${roles.accessController} on ${accessPolicy.address} to run this script`,
      );
    }
    if (CONFIG.isLiveDeployment) {
      console.log("LIVE DEPLOYMENT");
      console.log("Deployment parameters:");
      console.log(CONFIG);
      if (!(await confirm("Are you sure you want to deploy? [y/n] "))) {
        throw new Error("Aborting!");
      }
    }
    console.log("Universe deploying...");
    await deployer.deploy(Universe, accessPolicy.address, forkArbiter.address);
    const universe = await Universe.deployed();
    console.log("Platform Terms deploying...");
    await deployer.deploy(PlatformTerms);
    const platformTerms = await PlatformTerms.deployed();
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
    await deployer.deploy(
      EuroToken,
      accessPolicy.address,
      forkArbiter.address,
      tokenController.address,
    );
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
    await createAccessPolicy(accessPolicy, [
      // allow deployer temporarily, later drop
      {
        subject: DEPLOYER,
        role: roles.universeManager,
        object: universe.address,
        state: TriState.Allow,
      },
    ]);
    console.log("Add singletons to Universe");
    const interfaces = [
      {
        ki: knownInterfaces.neumark,
        addr: neumark.address,
      },
      {
        ki: knownInterfaces.etherToken,
        addr: etherToken.address,
      },
      {
        ki: knownInterfaces.euroToken,
        addr: euroToken.address,
      },
      {
        ki: knownInterfaces.euroTokenController,
        addr: tokenController.address,
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
      {
        ki: knownInterfaces.platformPortfolio,
        addr: CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
      },
      {
        ki: knownInterfaces.icbmEuroToken,
        addr: await icbmEuroLock.assetToken(),
      },
      {
        ki: knownInterfaces.icbmEtherToken,
        addr: await icbmEtherLock.assetToken(),
      },
      {
        ki: knownInterfaces.icbmCommitment,
        addr: commitment.address,
      },
      {
        ki: knownInterfaces.platformTerms,
        addr: platformTerms.address,
      },
    ];
    await registerSingletons(universe, DEPLOYER, interfaces);
  });
};
