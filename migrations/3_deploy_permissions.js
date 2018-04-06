require("babel-register");
const getConfig = require("./config").getConfig;
const getDeployerAccount = require("./config").getDeployerAccount;
const { TriState, EVERYONE, GLOBAL } = require("../test/helpers/triState");
const roles = require("../test/helpers/roles").default;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipDeployment) return;

  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const Neumark = artifacts.require(CONFIG.artifacts.NEUMARK);
  const ICBMLockedAccount = artifacts.require(CONFIG.artifacts.ICBM_LOCKED_ACCOUNT);
  const ICBMEuroToken = artifacts.require(CONFIG.artifacts.ICBM_EURO_TOKEN);
  const Commitment = artifacts.require(CONFIG.artifacts.ICBM_COMMITMENT);
  const DEPLOYER = getDeployerAccount(network, accounts);

  deployer.then(async () => {
    const accessPolicy = await RoleBasedAccessPolicy.deployed();
    const neumark = await Neumark.deployed();
    const euroToken = await ICBMEuroToken.deployed();
    const euroLock = await ICBMLockedAccount.deployed();
    const commitment = await Commitment.deployed();

    console.log("Seting permissions");
    console.log(roles);
    // allow commitment contract to issue Neumarks
    await accessPolicy.setUserRole(
      commitment.address,
      roles.neumarkIssuer,
      neumark.address,
      TriState.Allow,
    );
    // allow commitment contract to enable Neumark trading after ICBM
    await accessPolicy.setUserRole(
      commitment.address,
      roles.transferAdmin,
      neumark.address,
      TriState.Allow,
    );
    // allow anyone to burn their neumarks
    await accessPolicy.setUserRole(
      EVERYONE,
      roles.neumarkBurner,
      neumark.address,
      TriState.Allow,
    );

    await accessPolicy.setUserRole(
      CONFIG.addresses.LOCKED_ACCOUNT_ADMIN,
      roles.lockedAccountAdmin,
      GLOBAL,
      TriState.Allow,
    );
    await accessPolicy.setUserRole(
      CONFIG.addresses.WHITELIST_ADMIN,
      roles.whitelistAdmin,
      commitment.address,
      TriState.Allow,
    );
    await accessPolicy.setUserRole(
      CONFIG.addresses.PLATFORM_OPERATOR_REPRESENTATIVE,
      roles.platformOperatorRepresentative,
      GLOBAL,
      TriState.Allow,
    );
    await accessPolicy.setUserRole(
      CONFIG.addresses.EURT_DEPOSIT_MANAGER,
      roles.eurtDepositManager,
      euroToken.address,
      TriState.Allow,
    );

    // deposit role to yourself during deployment and relinquish control later
    await accessPolicy.setUserRole(
      DEPLOYER,
      roles.eurtDepositManager,
      euroToken.address,
      TriState.Allow,
    );

    console.log("ICBMEuroToken deposit permissions");
    await euroToken.setAllowedTransferFrom(commitment.address, true);
    await euroToken.setAllowedTransferTo(commitment.address, true);
    await euroToken.setAllowedTransferTo(euroLock.address, true);
    await euroToken.setAllowedTransferFrom(euroLock.address, true);
  });
};
