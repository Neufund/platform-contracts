export default {
  accessPolicy: web3.sha3("IAccessPolicy").slice(0, 10),
  forkArbiter: web3.sha3("IEthereumForkArbiter").slice(0, 10),
  neumark: web3.sha3("Neumark").slice(0, 10),
  etherToken: web3.sha3("EtherToken").slice(0, 10),
  euroToken: web3.sha3("EuroToken").slice(0, 10),
  identityRegistry: web3.sha3("IIdentityRegistry").slice(0, 10),
  tokenExchangeRateOracle: web3.sha3("ITokenExchangeRateOracle").slice(0, 10),
  feeDisbursal: web3.sha3("IFeeDisbursal").slice(0, 10),
  tokenExchange: web3.sha3("ITokenExchange").slice(0, 10),
  gasExchange: web3.sha3("IGasTokenExchange").slice(0, 10),
  euroLock: web3.sha3("LockedAccount:Euro").slice(0, 10),
  etherLock: web3.sha3("LockedAccount:Ether").slice(0, 10),
  icbmEuroLock: web3.sha3("ICBMLockedAccount:Euro").slice(0, 10),
  icbmEtherLock: web3.sha3("ICBMLockedAccount:Ether").slice(0, 10),
  commitmentInterface: web3.sha3("ICommitment").slice(0, 10)
};
