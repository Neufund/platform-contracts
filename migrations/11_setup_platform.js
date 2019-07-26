require("babel-register");
const getConfig = require("./config").getConfig;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const getDeployerAccount = require("./config").getDeployerAccount;
const roles = require("../test/helpers/roles").default;
const promisify = require("../test/helpers/evmCommands").promisify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const EuroTokenController = artifacts.require(CONFIG.artifacts.EURO_TOKEN_CONTROLLER);
  const SimpleExchange = artifacts.require(CONFIG.artifacts.GAS_EXCHANGE);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);

  deployer.then(async () => {
    const universe = await Universe.deployed();
    const euroToken = await EuroToken.at(await universe.euroToken());
    const tokenController = await EuroTokenController.at(await euroToken.tokenController());
    const simpleExchange = await SimpleExchange.at(await universe.gasExchange());
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());

    console.log("give deployer permissions to various roles, to be relinquished later");
    const DEPLOYER = getDeployerAccount(network, accounts);
    await createAccessPolicy(
      accessPolicy,
      [
        { subject: DEPLOYER, role: roles.eurtLegalManager },
        { subject: DEPLOYER, role: roles.eurtDepositManager },
        { subject: DEPLOYER, role: roles.identityManager },
        { subject: DEPLOYER, role: roles.tokenRateOracle },
      ],
      [],
    );

    console.log("Apply euro token controller settings");
    await tokenController.applySettings(
      CONFIG.MIN_DEPOSIT_AMOUNT_EUR_ULPS,
      CONFIG.MIN_WITHDRAW_AMOUNT_EUR_ULPS,
      CONFIG.MAX_SIMPLE_EXCHANGE_ALLOWANCE_EUR_ULPS,
    );
    console.log("Setup euro token deposti manager and fees");
    await tokenController.changeDepositManager(DEPLOYER);
    await tokenController.applyFeeSettings(
      CONFIG.EURT_DEPOSIT_FEE_FRAC,
      CONFIG.EURT_WITHDRAWAL_FEE_FRAC,
    );
    await tokenController.changeDepositManager(CONFIG.addresses.EURT_DEPOSIT_MANAGER);
    console.log("add platform wallet as reclaimer to simple exchange");
    await createAccessPolicy(accessPolicy, [
      {
        subject: CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
        role: roles.reclaimer,
        object: simpleExchange.address,
      },
    ]);
    console.log("send ether to services transacting on Ethereum");
    const transactingServices = [
      CONFIG.addresses.EURT_DEPOSIT_MANAGER,
      CONFIG.addresses.IDENTITY_MANAGER,
      CONFIG.addresses.GAS_EXCHANGE,
      CONFIG.addresses.TOKEN_RATE_ORACLE,
      CONFIG.addresses.GAS_STIPEND_SERVICE,
      CONFIG.addresses.INTERNAL_ETO_LISTING_API,
    ];
    const serviceInitialBalance = CONFIG.Q18.mul(CONFIG.isLiveDeployment ? 0.5 : 100);
    for (const service of transactingServices) {
      const serviceBalance = await promisify(web3.eth.getBalance)(service);
      if (serviceBalance.lt(serviceInitialBalance)) {
        const missingBalance = serviceInitialBalance.sub(serviceBalance);
        console.log(`Sending ${missingBalance.toNumber()} to ${service}`);
        await promisify(web3.eth.sendTransaction)({
          from: DEPLOYER,
          to: service,
          value: missingBalance,
        });
      } else {
        console.log(`Service ${service} has ${serviceBalance.toNumber()} already`);
      }
    }
  });
};
