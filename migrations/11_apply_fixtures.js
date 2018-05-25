require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./config").getFixtureAccounts;
const roles = require("../test/helpers/roles").default;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const getDeployerAccount = require("./config").getDeployerAccount;

function toBytes32(hex) {
  return `0x${web3.padLeft(hex.slice(2), 64)}`;
}

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // skip fixtures on live deployment
  if (CONFIG.shouldSkipDeployment || CONFIG.isLiveDeployment) return;

  const fas = getFixtureAccounts(accounts);
  const DEPLOYER = getDeployerAccount(network, accounts);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const SimpleExchange = artifacts.require(CONFIG.artifacts.SIMPLE_EXCHANGE);
  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const ITokenExchangeRateOracle = artifacts.require("ITokenExchangeRateOracle");
  const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);

  deployer.then(async () => {
    const universe = await Universe.deployed();

    console.log("set actual ETH/EUR price");
    const EUR_ETH_RATE = CONFIG.Q18.mul(new web3.BigNumber("360.9828182"));
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    const simpleExchange = await SimpleExchange.at(await universe.gasExchange());
    const euroTokenAddress = await universe.euroToken();
    const etherTokenAddress = await universe.etherToken();
    await simpleExchange.setExchangeRate(euroTokenAddress, etherTokenAddress, EUR_ETH_RATE, {
      from: CONFIG.addresses.TOKEN_RATE_ORACLE,
    });
    const tokenRateOracle = await ITokenExchangeRateOracle.at(
      await universe.tokenExchangeRateOracle(),
    );
    const currentRate = await tokenRateOracle.getExchangeRate(euroTokenAddress, etherTokenAddress);
    if (!currentRate[0].eq(EUR_ETH_RATE)) {
      throw new Error("could not set EUR/ETH rate");
    }
    // const revRate = await tokenRateOracle.getExchangeRate(etherTokenAddress, euroTokenAddress);
    // console.log(revRate);

    console.log("deposit in EtherToken");
    const etherToken = await EtherToken.at(await universe.etherToken());
    await etherToken.deposit({ from: fas.HAS_ETH_T_NO_KYC, value: CONFIG.Q18.mul(1187.198273981) });
    await etherToken.deposit({
      from: fas.ICBM_EUR_NOT_MIGRATED_HAS_KYC,
      value: CONFIG.Q18.mul(387.198273981),
    });

    console.log("set KYC, sophisiticated, bankAccount");
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
    await identityRegistry.setMultipleClaims(
      [
        fas.ICBM_EUR_NOT_MIGRATED_HAS_KYC,
        fas.ICBM_EUR_MIGRATED_HAS_KYC,
        fas.ICBM_EUR_ETH_NOT_MIGRATED_HAS_KYC,
        fas.HAS_EUR_HAS_KYC,
      ],
      [toBytes32("0x0"), toBytes32("0x0"), toBytes32("0x0"), toBytes32("0x0")],
      [toBytes32("0x1"), toBytes32("0x1"), toBytes32("0x7"), toBytes32("0x5")],
      { from: CONFIG.addresses.IDENTITY_MANAGER },
    );
    const claims = await identityRegistry.getClaims(fas.HAS_EUR_HAS_KYC);
    if (claims !== toBytes32("0x5")) {
      throw new Error("claims could not be set");
    }

    console.log("deposit in EuroToken");
    const euroToken = await EuroToken.at(await universe.euroToken());
    await euroToken.deposit(fas.HAS_EUR_HAS_KYC, CONFIG.Q18.mul(10278127.1988), {
      from: CONFIG.addresses.EURT_DEPOSIT_MANAGER,
    });
    await euroToken.deposit(fas.ICBM_EUR_MIGRATED_HAS_KYC, CONFIG.Q18.mul(1271.1988), {
      from: CONFIG.addresses.EURT_DEPOSIT_MANAGER,
    });

    console.log("migrating locked accounts");
    // todo: add migrations when tested

    console.log("send ether to simple exchange");
    await simpleExchange.send(CONFIG.Q18.mul(10), { from: DEPLOYER });
    console.log("add platform wallet as reclaimer to simple exchange");
    await createAccessPolicy(accessPolicy, [
      {
        subject: CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
        role: roles.reclaimer,
        object: simpleExchange.address,
      },
    ]);
    console.log("make KYC for platform wallet");
    await identityRegistry.setClaims(
      CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
      "0",
      toBytes32("0x5"),
      {
        from: CONFIG.addresses.IDENTITY_MANAGER,
      },
    );
  });
};
