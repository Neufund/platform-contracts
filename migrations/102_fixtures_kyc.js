require("babel-register");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;
const getDeployerAccount = require("./config").getDeployerAccount;
const toBytes32 = require("../test/helpers/constants").toBytes32;
const serializeClaims = require("../test/helpers/identityClaims").serializeClaims;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const DEPLOYER = getDeployerAccount(network, accounts);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const IdentityRegistry = artifacts.require(CONFIG.artifacts.IDENTITY_REGISTRY);
  deployer.then(async () => {
    const fas = getFixtureAccounts();

    console.log("Add KYC claims to fixtures accounts");
    const requireKyc = Object.keys(fas).filter(fa => fas[fa].identityClaims !== undefined);

    const requireKycAddresses = requireKyc.map(fa => fas[fa].address);

    const zeroClaims = requireKyc.map(() => toBytes32("0x0"));
    const verifiedClaims = requireKyc.map(fa => {
      const claims = fas[fa].identityClaims;

      return serializeClaims(
        claims.isVerified,
        claims.isSophisticatedInvestor,
        claims.hasBankAccount,
        claims.accountFrozen,
      );
    });

    const universe = await Universe.deployed();
    const identityRegistry = await IdentityRegistry.at(await universe.identityRegistry());
    await identityRegistry.setMultipleClaims(requireKycAddresses, zeroClaims, verifiedClaims, {
      from: DEPLOYER,
    });

    const claims = await identityRegistry.getClaims(requireKycAddresses[3]);
    if (claims !== verifiedClaims[3]) {
      throw new Error("claims could not be set");
    }
  });
};
