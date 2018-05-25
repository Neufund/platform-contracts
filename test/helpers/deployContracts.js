import { TriState, GLOBAL } from "./triState";
import roles from "./roles";
import knownInterfaces from "./knownInterfaces";
import createAccessPolicy from "./createAccessPolicy";

const Neumark = artifacts.require("Neumark");
const EthereumForkArbiter = artifacts.require("EthereumForkArbiter");
const Universe = artifacts.require("Universe");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const RoleBasedAccessPolicy = artifacts.require("RoleBasedAccessPolicy");
const EtherToken = artifacts.require("EtherToken");
const EuroToken = artifacts.require("EuroToken");
const EuroTokenController = artifacts.require("EuroTokenController");
const SimpleExchange = artifacts.require("SimpleExchange");

export const dayInSeconds = 24 * 60 * 60;
export const monthInSeconds = 30 * dayInSeconds;

export function toBytes32(hex) {
  return `0x${web3.padLeft(hex.slice(2), 64)}`;
}

export async function deployAccessControl(initialRules) {
  const accessPolicy = await RoleBasedAccessPolicy.new();
  await createAccessPolicy(accessPolicy, initialRules);
  return accessPolicy;
}

export async function deployControlContracts() {
  const accessPolicy = await RoleBasedAccessPolicy.new();
  const forkArbiter = await EthereumForkArbiter.new(accessPolicy.address);
  return [accessPolicy, forkArbiter];
}

export async function deployUniverse(platformOperatorRepresentative, universeManager) {
  const [accessPolicy, forkArbiter] = await deployControlContracts();
  const universe = await Universe.new(accessPolicy.address, forkArbiter.address);
  // platform wide rep
  await accessPolicy.setUserRole(
    platformOperatorRepresentative,
    roles.platformOperatorRepresentative,
    GLOBAL,
    TriState.Allow,
  );
  // universe manager on universe contract
  await accessPolicy.setUserRole(
    universeManager,
    roles.universeManager,
    universe.address,
    TriState.Allow,
  );
  return universe;
}

export async function deployIdentityRegistry(universe, universeManager, identityManager) {
  const identityRegistry = await IdentityRegistry.new(universe.address);
  await universe.setSingleton(knownInterfaces.identityRegistry, identityRegistry.address, {
    from: universeManager,
  });
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  await accessPolicy.setUserRole(
    identityManager,
    roles.identityManager,
    identityRegistry.address,
    TriState.Allow,
  );

  return identityRegistry;
}

export async function deployNeumark(accessPolicy, forkArbiter) {
  const neumark = await Neumark.new(accessPolicy.address, forkArbiter.address);
  await createAccessPolicy(accessPolicy, [
    { role: roles.snapshotCreator, object: neumark.address },
    { role: roles.neumarkIssuer, object: neumark.address },
    { role: roles.neumarkBurner, object: neumark.address },
    { role: roles.transferAdmin, object: neumark.address },
    { role: roles.platformOperatorRepresentative, object: neumark.address },
  ]);
  await neumark.amendAgreement("ipfs:QmPXME1oRtoT627YKaDPDQ3PwA8tdP9rWuAAweLzqSwAWT");
  return neumark;
}

export async function deployNeumarkUniverse(universe, universeManager) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const forkArbiter = await EthereumForkArbiter.at(await universe.forkArbiter());
  const neumark = await deployNeumark(accessPolicy, forkArbiter);
  await universe.setSingleton(knownInterfaces.neumark, neumark.address, {
    from: universeManager,
  });
  return neumark;
}

export async function deployEtherTokenUniverse(universe, universeManager) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const token = await EtherToken.new(accessPolicy.address);
  await universe.setSingleton(knownInterfaces.etherToken, token.address, {
    from: universeManager,
  });
  return token;
}

export async function deployEuroTokenUniverse(
  universe,
  universeManager,
  eurtLegalManager,
  depositManager,
  minDepositAmountEurUlps,
  minWithdrawAmountEurUlps,
  maxSimpleExchangeAllowanceEurUlps,
) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const tokenController = await EuroTokenController.new(universe.address);
  const euroToken = await EuroToken.new(accessPolicy.address, tokenController.address);
  await universe.setSingleton(knownInterfaces.euroToken, euroToken.address, {
    from: universeManager,
  });
  // set permissions on token controller and euro token
  await createAccessPolicy(accessPolicy, [
    { subject: depositManager, role: roles.eurtDepositManager },
    { subject: eurtLegalManager, role: roles.eurtLegalManager },
  ]);
  // apply setting on token controller
  await tokenController.applySettings(
    minDepositAmountEurUlps,
    minWithdrawAmountEurUlps,
    maxSimpleExchangeAllowanceEurUlps,
    { from: eurtLegalManager },
  );
  return [euroToken, tokenController];
}

export async function deploySimpleExchangeUniverse(universe,
                                                   universeManager,
                                                   etherToken,
                                                   euroToken,
                                                   gasExchangeManager,
                                                   tokenOracleManager,) {
  const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
  const simpleExchange = await SimpleExchange.new(
    accessPolicy.address,
    euroToken.address,
    etherToken.address,
  );
  await universe.setSingleton(knownInterfaces.tokenExchangeRateOracle, simpleExchange.address, {
    from: universeManager,
  });
  await universe.setSingleton(knownInterfaces.gasExchange, simpleExchange.address, {
    from: universeManager,
  });
  await createAccessPolicy(accessPolicy, [
    {
      subject: tokenOracleManager,
      role: roles.tokenRateOracle,
      object: simpleExchange.address,
    },
    {
      subject: gasExchangeManager,
      role: roles.gasExchange,
      object: simpleExchange.address,
    },
  ]);
  return simpleExchange;
}
