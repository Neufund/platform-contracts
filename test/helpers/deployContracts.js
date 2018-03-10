import { TriState, EVERYONE, GLOBAL } from "./triState";
import roles from "./roles";
import knownInterfaces from "./knownInterfaces";
import createAccessPolicy from "./createAccessPolicy";

const Neumark = artifacts.require("Neumark");
const EthereumForkArbiter = artifacts.require("EthereumForkArbiter");
const Universe = artifacts.require("Universe");
const IdentityRegistry = artifacts.require("IdentityRegistry");
const RoleBasedAccessPolicy = artifacts.require("RoleBasedAccessPolicy");

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
  await accessPolicy.setUserRole(EVERYONE, roles.snapshotCreator, neumark.address, TriState.Allow);
  await accessPolicy.setUserRole(EVERYONE, roles.neumarkIssuer, neumark.address, TriState.Allow);
  await accessPolicy.setUserRole(EVERYONE, roles.neumarkBurner, neumark.address, TriState.Allow);
  await accessPolicy.setUserRole(EVERYONE, roles.transferAdmin, neumark.address, TriState.Allow);
  await accessPolicy.setUserRole(
    EVERYONE,
    roles.platformOperatorRepresentative,
    neumark.address,
    TriState.Allow,
  );
  await neumark.amendAgreement("ipfs:QmPXME1oRtoT627YKaDPDQ3PwA8tdP9rWuAAweLzqSwAWT");

  return neumark;
}
