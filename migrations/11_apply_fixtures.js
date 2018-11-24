require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./config").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;
const promisify = require("../test/helpers/evmCommands").promisify;
const toBytes32 = require("../test/helpers/constants").toBytes32;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const roles = require("../test/helpers/roles").default;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;

  const DEPLOYER = getDeployerAccount(network, accounts);

  const SimpleExchange = artifacts.require(CONFIG.artifacts.GAS_EXCHANGE);
  const EtherToken = artifacts.require(CONFIG.artifacts.ETHER_TOKEN);
  const EuroToken = artifacts.require(CONFIG.artifacts.EURO_TOKEN);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
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
    const etherToken = await EtherToken.at(await universe.etherToken());
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
    const simpleExchange = await SimpleExchange.at(await universe.gasExchange());
    const euroLock = await LockedAccount.at(await universe.euroLock());
    const etherLock = await LockedAccount.at(await universe.etherLock());
    const icbmEuroLock = await ICBMLockedAccount.at(await universe.icbmEuroLock());
    const icbmEtherLock = await ICBMLockedAccount.at(await universe.icbmEtherLock());
    const icbmEuroToken = await ICBMEuroToken.at(await icbmEuroLock.assetToken());

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
    await euroToken.amendAgreement("ipfs:QmVMd3EaJm9SaYf6zZQnSexFCEDY5fCuGpMdtoUadZFCEX");
    await universe.amendAgreement("ipfs:QmZP5jN7W7oG7Kh4HsYPNtJ6naGTC3PHGx7vUgbTTGU7kN");

    console.log("amending agreement for LockedAccounts");
    await euroLock.amendAgreement("ipfs:QmPLDBY3ba93xvNxk85DXjDTQsdYqEDHr9g3C8uLuF7Nxf");
    await etherLock.amendAgreement("ipfs:QmPLDBY3ba93xvNxk85DXjDTQsdYqEDHr9g3C8uLuF7Nxf");

    if (CONFIG.ISOLATED_UNIVERSE) return;
    // executed only in test deployment
    await createAccessPolicy(
      accessPolicy,
      [{ subject: DEPLOYER, role: roles.eurtDepositManager }],
      [],
    );
    const fas = getFixtureAccounts(accounts);
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

    // setup fixture accounts
    console.log("deposit in EtherToken");
    await etherToken.deposit({
      from: fas.INV_HAS_ETH_T_NO_KYC.address,
      value: CONFIG.Q18.mul(1187.198273981),
    });
    await etherToken.deposit({
      from: fas.INV_EUR_ICBM_HAS_KYC.address,
      value: CONFIG.Q18.mul(387.198273981),
    });

    console.log("set KYC, sophisiticated, bankAccount");
    const requireKYC = Object.keys(fas)
      .filter(fa => fas[fa].verified)
      .map(fa => fas[fa].address);
    const zeroClaims = requireKYC.map(() => toBytes32("0x0"));
    const verifiedClaims = requireKYC.map(() => toBytes32("0x1"));
    // special verified claims
    verifiedClaims[2] = toBytes32("0x7");
    verifiedClaims[3] = toBytes32("0x5");
    await identityRegistry.setMultipleClaims(requireKYC, zeroClaims, verifiedClaims, {
      from: DEPLOYER,
    });
    const claims = await identityRegistry.getClaims(requireKYC[3]);
    if (claims !== verifiedClaims[3]) {
      throw new Error("claims could not be set");
    }

    console.log("deposit in EuroToken");
    await euroToken.deposit(fas.INV_HAS_EUR_HAS_KYC.address, CONFIG.Q18.mul(10278127.1988), "0x0", {
      from: DEPLOYER,
    });
    await euroToken.deposit(fas.INV_ICBM_EUR_M_HAS_KYC.address, CONFIG.Q18.mul(1271.1988), "0x0", {
      from: DEPLOYER,
    });

    console.log("let euroLock to receive and send old euro token");
    await icbmEuroToken.setAllowedTransferFrom(euroLock.address, true);
    await icbmEuroToken.setAllowedTransferTo(euroLock.address, true);

    console.log("migrating locked accounts");
    await icbmEtherLock.migrate({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address });
    await icbmEtherLock.migrate({ from: fas.INV_ICBM_ETH_M_HAS_KYC.address });
    await icbmEuroLock.migrate({ from: fas.INV_ETH_EUR_ICBM_M_HAS_KYC.address });
    await icbmEuroLock.migrate({ from: fas.INV_ICBM_EUR_M_HAS_KYC.address });

    console.log("add ether to test accounts");
    for (const f of Object.keys(fas)) {
      await promisify(web3.eth.sendTransaction)({
        from: DEPLOYER,
        to: fas[f].address,
        value: CONFIG.Q18.mul(14.21182),
      });
    }
  });
};
