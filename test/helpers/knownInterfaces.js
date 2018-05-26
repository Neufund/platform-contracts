const sha3Web3 = require("web3/lib/utils/sha3");

function sha3(s) {
  return `0x${sha3Web3(s)}`;
}

export default {
  accessPolicy: sha3("IAccessPolicy").slice(0, 10),
  forkArbiter: sha3("IEthereumForkArbiter").slice(0, 10),
  neumark: sha3("Neumark").slice(0, 10),
  etherToken: sha3("EtherToken").slice(0, 10),
  euroToken: sha3("EuroToken").slice(0, 10),
  identityRegistry: sha3("IIdentityRegistry").slice(0, 10),
  tokenExchangeRateOracle: sha3("ITokenExchangeRateOracle").slice(0, 10),
  feeDisbursal: sha3("IFeeDisbursal").slice(0, 10),
  tokenExchange: sha3("ITokenExchange").slice(0, 10),
  gasExchange: sha3("IGasTokenExchange").slice(0, 10),
  euroLock: sha3("LockedAccount:Euro").slice(0, 10),
  etherLock: sha3("LockedAccount:Ether").slice(0, 10),
  icbmEuroLock: sha3("ICBMLockedAccount:Euro").slice(0, 10),
  icbmEtherLock: sha3("ICBMLockedAccount:Ether").slice(0, 10),
  icbmEtherToken: sha3("ICBMEtherToken").slice(0, 10),
  icbmEuroToken: sha3("ICBMEuroToken").slice(0, 10),
  icbmCommitment: sha3("ICBMCommitment").slice(0, 10),
  commitmentInterface: sha3("ICommitment").slice(0, 10),
  platformTerms: sha3("PlatformTerms").slice(0, 10),
  equityTokenInterface: sha3("IEquityToken").slice(0, 10),
  equityTokenControllerInterface: sha3("IEquityTokenController").slice(0, 10),
};
