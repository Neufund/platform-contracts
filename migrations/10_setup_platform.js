require("babel-register");
const getConfig = require("./config").getConfig;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const getDeployerAccount = require("./config").getDeployerAccount;
const roles = require("../test/helpers/roles").default;
const promisify = require("../test/helpers/evmCommands").promisify;
const toBytes32 = require("../test/helpers/constants").toBytes32;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const EuroTokenController = artifacts.require(CONFIG.artifacts.EURO_TOKEN_CONTROLLER);
  const SimpleExchange = artifacts.require(CONFIG.artifacts.GAS_EXCHANGE);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);

  deployer.then(async () => {
    const universe = await Universe.deployed();
    const euroToken = await EuroToken.at(await universe.euroToken());
    const tokenController = await EuroTokenController.at(await euroToken.tokenController());
    const simpleExchange = await SimpleExchange.at(await universe.gasExchange());
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());

    console.log("give deployer permissions to various roles, to be relinquished later");
    const DEPLOYER = getDeployerAccount(network, accounts);
    await createAccessPolicy(
      accessPolicy,
      [
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
    ];
    for (const service of transactingServices) {
      const serviceBalance = await promisify(web3.eth.getBalance)(service);
      if (serviceBalance.lt(CONFIG.Q18.mul(0.5))) {
        const missingBalance = CONFIG.Q18.mul(0.5).sub(serviceBalance);
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

    if (!CONFIG.isLiveDeployment || CONFIG.ISOLATED_UNIVERSE) {
      console.log("make KYC for platform wallet");
      await identityRegistry.setClaims(
        CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
        "0",
        toBytes32("0x5"),
        {
          from: DEPLOYER,
        },
      );

      console.log("send ether to simple exchange");
      await simpleExchange.send(CONFIG.Q18.mul(10), { from: DEPLOYER });
    }

    if (CONFIG.isLiveDeployment) {
      if (!CONFIG.ISOLATED_UNIVERSE) {
        console.log("---------------------------------------------");
        console.log("On live network, enable LockedAccount migrations manually");
        console.log(
          `On live network, make sure PLATFORM_OPERATOR_WALLET ${
            CONFIG.addresses.PLATFORM_OPERATOR_WALLET
          } has KYC done`,
        );
        console.log(`On live network, send some ether to SimpleExchange`);
        console.log("---------------------------------------------");
      }
    }
  });
};
