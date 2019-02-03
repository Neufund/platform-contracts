// lists all artifacts that are deployed in migrations (without mocks which are configured in truffle.js)
export const artifacts = {
  ROLE_BASED_ACCESS_POLICY: "RoleBasedAccessPolicy",
  ETHEREUM_FORK_ARBITER: "EthereumForkArbiter",
  NEUMARK: "Neumark",
  ICBM_LOCKED_ACCOUNT: "ICBMLockedAccount",
  ICBM_ETHER_TOKEN: "ICBMEtherToken",
  ICBM_EURO_TOKEN: "ICBMEuroToken",
  ICBM_COMMITMENT: "ICBMCommitment",
  UNIVERSE: "Universe",
  LOCKED_ACCOUNT: "LockedAccount",
  ETHER_TOKEN: "EtherToken",
  EURO_TOKEN: "EuroToken",
  EURO_TOKEN_CONTROLLER: "EuroTokenController",
  IDENTITY_REGISTRY: "IdentityRegistry",
  GAS_EXCHANGE: "SimpleExchange",
  PLATFORM_TERMS: "PlatformTerms",
  STANDARD_ETO_COMMITMENT: "ETOCommitment",
  STANDARD_EQUITY_TOKEN: "EquityToken",
  PLACEHOLDER_EQUITY_TOKEN_CONTROLLER: "PlaceholderEquityTokenController",
  STANDARD_ETO_TERMS: "ETOTerms",
  STANDARD_SHAREHOLDER_RIGHTS: "ShareholderRights",
  STANDARD_DURATION_TERMS: "ETODurationTerms",
  STANDARD_TOKEN_TERMS: "ETOTokenTerms",
  FEE_DISBURSAL: "FeeDisbursal",
  FEE_DISBURSAL_CONTROLLER: "FeeDisbursalController",
  // interfaces used in migrations
  TOKEN_EXCHANGE_RATE_ORACLE: "ITokenExchangeRateOracle",
  // not implemented
  // PLATFORM_PORTFOLIO: "IPlatformPortfolio"
};
