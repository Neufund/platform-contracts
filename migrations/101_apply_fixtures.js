require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const toBytes32 = require("../test/helpers/constants").toBytes32;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const roles = require("../test/helpers/roles").default;
const { TriState } = require("../test/helpers/triState");

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const DEPLOYER = getDeployerAccount(network, accounts);

  const SimpleExchange = artifacts.require(CONFIG.artifacts.GAS_EXCHANGE);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const ITokenExchangeRateOracle = artifacts.require(CONFIG.artifacts.TOKEN_EXCHANGE_RATE_ORACLE);
  const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const LockedAccount = artifacts.require(CONFIG.artifacts.LOCKED_ACCOUNT);
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);

  deployer.then(async () => {
    // skip for pure live deployment
    if (CONFIG.isLiveDeployment && !CONFIG.ISOLATED_UNIVERSE) return;
    // executed in test deployment and in ISOLATED_UNIVERSE

    const universe = await Universe.deployed();
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    const euroToken = await EuroToken.at(await universe.euroToken());
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
    const simpleExchange = await SimpleExchange.at(await universe.gasExchange());
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const etherLock = await LockedAccount.at(await universe.etherLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());

    console.log("make KYC for platform wallet");
    await identityRegistry.setClaims(
      CONFIG.addresses.PLATFORM_OPERATOR_WALLET,
      "0",
      toBytes32("0x5"),
      {
        from: DEPLOYER,
      },
    );

    console.log("set platform operator rep global role (req by isolated universe)");
    await createAccessPolicy(accessPolicy, [
      // global role for legal rep
      {
        subject: CONFIG.addresses.PLATFORM_OPERATOR_REPRESENTATIVE,
        role: roles.platformOperatorRepresentative,
      },
    ]);

    console.log("send ether to simple exchange");
    await simpleExchange.send(CONFIG.Q18.mul(10), { from: DEPLOYER });

    console.log(
      `amending agreement for EuroToken ${euroToken.address} and Universe ${universe.address}`,
    );
    await euroToken.amendAgreement("ipfs:QmdE8jb4FoSRdu5HnJU8Fum6YFmpKQSo733TAWD2owJohK");
    await universe.amendAgreement("ipfs:QmS3qGWqvruywjM7Lp82LiyoyqDQbArdXveC5JA5m54Qfv");

    console.log("amending agreement for LockedAccounts");
    await euroLock.amendAgreement("ipfs:QmPLDBY3ba93xvNxk85DXjDTQsdYqEDHr9g3C8uLuF7Nxf");
    await etherLock.amendAgreement("ipfs:QmPLDBY3ba93xvNxk85DXjDTQsdYqEDHr9g3C8uLuF7Nxf");

    if (CONFIG.ISOLATED_UNIVERSE) return;
    // executed only in test deployment
    await createAccessPolicy(accessPolicy, [
      { subject: DEPLOYER, role: roles.eurtDepositManager },
      { subject: DEPLOYER, role: roles.whitelistAdmin },
    ]);

    console.log("set Euro LockedAccount migration");
    await icbmEuroLock.enableMigration(euroLock.address);
    if ((await icbmEuroLock.currentMigrationTarget()) !== euroLock.address) {
      throw new Error("cannot set migrations for EuroLock");
    }

    console.log("set Ether LockedAccount migration");
    await icbmEtherLock.enableMigration(etherLock.address);
    if ((await icbmEtherLock.currentMigrationTarget()) !== etherLock.address) {
      throw new Error("cannot set migrations for EtherLock");
    }

    console.log("set actual ETH and NEU to EUR price");
    const EUR_ETH_RATE = CONFIG.Q18.mul(new web3.BigNumber("360.9828182"));
    const EUR_NEU_RATE = CONFIG.Q18.mul(new web3.BigNumber("0.2828182"));
    const euroTokenAddress = await universe.euroToken();
    const etherTokenAddress = await universe.etherToken();
    const neuTokenAddress = await universe.neumark();
    await simpleExchange.setExchangeRate(etherTokenAddress, euroTokenAddress, EUR_ETH_RATE, {
      from: DEPLOYER,
    });
    await simpleExchange.setExchangeRate(neuTokenAddress, euroTokenAddress, EUR_NEU_RATE, {
      from: DEPLOYER,
    });
    const tokenRateOracle = await ITokenExchangeRateOracle.at(
      await universe.tokenExchangeRateOracle(),
    );

    const currentNEURate = await tokenRateOracle.getExchangeRate(neuTokenAddress, euroTokenAddress);
    if (!currentNEURate[0].eq(EUR_NEU_RATE)) {
      throw new Error("could not set EUR/NEU rate");
    }

    console.log("DEPLOYER can create snapshots");
    await accessPolicy.setUserRole(DEPLOYER, roles.snapshotCreator, "0x0", TriState.Allow);

    console.log(
      `INTERNAL_ETO_LISTING_API ${CONFIG.addresses.INTERNAL_ETO_LISTING_API} can modify whitelist`,
    );
    await accessPolicy.setUserRole(
      CONFIG.addresses.INTERNAL_ETO_LISTING_API,
      roles.whitelistAdmin,
      "0x0",
      TriState.Allow,
    );
  });
};
