require("babel-register");
const getConfig = require("./config").getConfig;
const roles = require("../test/helpers/roles").default;
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const { TriState } = require("../test/helpers/triState");
const getDeployerAccount = require("./config").getDeployerAccount;
const knownInterfaces = require("../test/helpers/knownInterfaces").default;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  // do not deploy testing network
  if (CONFIG.shouldSkipDeployment) return;

  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);

  deployer.then(async () => {
    const universe = await Universe.deployed();
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    const commitmentAddress = await universe.getSingleton(knownInterfaces.icbmCommitment);
    const neumarkAddress = await universe.neumark();
    const tokenOracleAddress = await universe.tokenExchangeRateOracle();
    const gasExchangeAddress = await universe.gasExchange();

    console.log("drop permissions from icbm contracts");
    await createAccessPolicy(accessPolicy, [
      {
        subject: commitmentAddress,
        role: roles.neumarkIssuer,
        object: neumarkAddress,
        state: TriState.Unset,
      },
      {
        subject: commitmentAddress,
        role: roles.transferAdmin,
        object: neumarkAddress,
        state: TriState.Unset,
      },
    ]);

    console.log("set platform permissions");
    await createAccessPolicy(accessPolicy, [
      // global role for identity manager
      { subject: CONFIG.addresses.IDENTITY_MANAGER, role: roles.identityManager },
      // global role for euro token legal manager
      { subject: CONFIG.addresses.EURT_LEGAL_MANAGER, role: roles.eurtLegalManager },
      // global role for euro token deposit manager
      { subject: CONFIG.addresses.EURT_DEPOSIT_MANAGER, role: roles.eurtDepositManager },
      {
        subject: CONFIG.addresses.TOKEN_RATE_ORACLE,
        role: roles.tokenRateOracle,
        object: tokenOracleAddress,
      },
      {
        subject: CONFIG.addresses.GAS_EXCHANGE,
        role: roles.gasExchange,
        object: gasExchangeAddress,
      },
    ]);

    console.log("give deployer permissions to setup eur-t, to be relinquished later");
    const DEPLOYER = getDeployerAccount(network, accounts);
    await createAccessPolicy(accessPolicy, [{ subject: DEPLOYER, role: roles.eurtLegalManager }]);
  });
};
