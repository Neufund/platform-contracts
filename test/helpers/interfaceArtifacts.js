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
  [knownInterfaces.tokenExchangeRateOracle]: deployableArtifacts.SIMPLE_EXCHANGE,
  [knownInterfaces.gasExchange]: deployableArtifacts.SIMPLE_EXCHANGE,
  [knownInterfaces.feeDisbursal]: "",
  [knownInterfaces.tokenExchange]: "",
  [knownInterfaces.icbmEuroLock]: deployableArtifacts.ICBM_LOCKED_ACCOUNT,
  [knownInterfaces.icbmEtherLock]: deployableArtifacts.ICBM_LOCKED_ACCOUNT,
  [knownInterfaces.icbmEuroToken]: deployableArtifacts.ICBM_EURO_TOKEN,
  [knownInterfaces.icbmEtherToken]: deployableArtifacts.ICBM_ETHER_TOKEN,
  [knownInterfaces.icbmCommitment]: deployableArtifacts.ICBM_COMMITMENT,
  [knownInterfaces.commitmentInterface]: "",
}
