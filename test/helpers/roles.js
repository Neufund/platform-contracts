const sha3Web3 = require("web3/lib/utils/sha3");

function sha3(s) {
  return `0x${sha3Web3(s)}`;
}

export default {
  accessController: sha3("AccessController"),
  example: sha3("Example"),
  platformOperatorRepresentative: sha3("PlatformOperatorRepresentative"),
  lockedAccountAdmin: sha3("LockedAccountAdmin"),
  neumarkBurner: sha3("NeumarkBurner"),
  neumarkIssuer: sha3("NeumarkIssuer"),
  reclaimer: sha3("Reclaimer"),
  snapshotCreator: sha3("SnapshotCreator"),
  transferAdmin: sha3("TransferAdmin"),
  whitelistAdmin: sha3("WhitelistAdmin"),
  eurtDepositManager: sha3("EurtDepositManager"),
  universeManager: sha3("UniverseManager"),
  identityManager: sha3("IdentityManager"),
  eurtLegalManager: sha3("EurtLegalManager"),
  gasExchange: sha3("GasExchange"),
  tokenRateOracle: sha3("TokenRateOracle"),
  disburser: sha3("Disburser"),
};
