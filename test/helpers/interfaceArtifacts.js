import knownInterfaces from "./knownInterfaces";
import deployableArtifacts from "./artifacts";

export default {
  [knownInterfaces.accessPolicy]: deployableArtifacts.ROLE_BASED_ACCESS_POLICY,
  [knownInterfaces.forkArbiter]: deployableArtifacts.ETHEREUM_FORK_ARBITER,
  [knownInterfaces.identityRegistry]: deployableArtifacts.IDENTITY_REGISTRY,
  [knownInterfaces.etherToken]: deployableArtifacts.ETHER_TOKEN,
  [knownInterfaces.euroToken]: deployableArtifacts.EURO_TOKEN,
  [knownInterfaces.etherLock]: deployableArtifacts.LOCKED_ACCOUNT,
  [knownInterfaces.euroLock]: deployableArtifacts.LOCKED_ACCOUNT,
  [knownInterfaces.neumark]: deployableArtifacts.NEUMARK,
  [knownInterfaces.tokenExchangeRateOracle]: deployableArtifacts.TOKEN_RATE_ORACLE,
  [knownInterfaces.gasExchange]: deployableArtifacts.GAS_EXCHANGE,
  [knownInterfaces.feeDisbursal]: deployableArtifacts.FEE_DISBURSAL,
  [knownInterfaces.tokenExchange]: "",
  [knownInterfaces.icbmEuroLock]: deployableArtifacts.ICBM_LOCKED_ACCOUNT,
  [knownInterfaces.icbmEtherLock]: deployableArtifacts.ICBM_LOCKED_ACCOUNT,
  [knownInterfaces.icbmEuroToken]: deployableArtifacts.ICBM_EURO_TOKEN,
  [knownInterfaces.icbmEtherToken]: deployableArtifacts.ICBM_ETHER_TOKEN,
  [knownInterfaces.icbmCommitment]: deployableArtifacts.ICBM_COMMITMENT,
  [knownInterfaces.universe]: deployableArtifacts.UNIVERSE,
  [knownInterfaces.commitmentInterface]: deployableArtifacts.COMMITMENT_INTERFACE,
  [knownInterfaces.equityTokenInterface]: deployableArtifacts.EQUITY_TOKEN,
  [knownInterfaces.equityTokenControllerInterface]: deployableArtifacts.EQUITY_TOKEN_CONTROLLER,
};
