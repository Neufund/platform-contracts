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
const ITokenExchangeRateOracle = artifacts.require("ITokenExchangeRateOracle");
const IGasExchange = artifacts.require("IGasExchange");
const PlatformTerms = artifacts.require("PlatformTerms");
const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ShareholderRights = artifacts.require("ShareholderRights");

const Q18 = web3.toBigNumber("10").pow(18);

export const dayInSeconds = 24 * 60 * 60;
export const monthInSeconds = 30 * dayInSeconds;
export const daysToSeconds = sec => sec * dayInSeconds;

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
  return [universe, accessPolicy, forkArbiter];
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

export async function deploySimpleExchangeUniverse(
  universe,
  universeManager,
  etherToken,
  euroToken,
  gasExchangeManager,
  tokenOracleManager,
) {
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
  return [
    await IGasExchange.at(simpleExchange.address),
    await ITokenExchangeRateOracle.at(simpleExchange.address),
    simpleExchange,
  ];
}

export async function deployPlatformTerms(universe, universeManager, overrideTerms) {
  const defaultTerms = {
    PLATFORM_FEE_FRACTION: Q18.mul(0.03),
    TOKEN_PARTICIPATION_FEE_FRACTION: Q18.mul(0.02),
    MIN_OFFER_DURATION_DAYS: daysToSeconds(1),
    MAX_OFFER_DURATION_DAYS: daysToSeconds(90),
    MIN_TICKET_EUR_ULPS: Q18.mul(300),
    EQUITY_TOKENS_PER_SHARE: 10000,
    // todo: fill remaining contants to be tested below
  };

  const terms = Object.assign(defaultTerms, overrideTerms || {});
  const termsKeys = Object.keys(terms);
  const termsValues = termsKeys.map(v => terms[v]);

  const platformTerms = await PlatformTerms.new();
  await universe.setSingleton(knownInterfaces.platformTerms, platformTerms.address, {
    from: universeManager,
  });

  return [platformTerms, terms, termsKeys, termsValues];
}

export async function deployShareholderRights(overrideTerms) {
  const defaultShareholderTerms = {
    GENERAL_VOTING_RULE: 1,
    TAG_ALONG_VOTING_RULE: 2,
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.mul(1.5),
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: daysToSeconds(10),
    RESTRICTED_ACT_VOTING_DURATION: daysToSeconds(14),
    VOTING_FINALIZATION: daysToSeconds(5),
    TOKENHOLDERS_QUORUM_FRAC: Q18.mul(0.1),
  };
  const shareholderTerms = Object.assign(defaultShareholderTerms, overrideTerms || {});
  const shareholderTermsKeys = Object.keys(shareholderTerms);
  const shareholderTermsValues = shareholderTermsKeys.map(v => shareholderTerms[v]);
  const shareholderRights = await ShareholderRights.new.apply(this, shareholderTermsValues);

  return [shareholderRights, shareholderTerms, shareholderTermsKeys, shareholderTermsValues];
}

export async function deployDurationTerms(overrideTerms) {
  const defDurTerms = {
    WHITELIST_DURATION: daysToSeconds(7),
    PUBLIC_DURATION: daysToSeconds(30),
    SIGNING_DURATION: daysToSeconds(14),
    CLAIM_DURATION: daysToSeconds(10),
  };
  const durTerms = Object.assign(defDurTerms, overrideTerms || {});
  const durationTermsKeys = Object.keys(durTerms);
  const durationTermsValues = durationTermsKeys.map(v => durTerms[v]);
  const etoDurationTerms = await ETODurationTerms.new.apply(this, durationTermsValues);

  return [etoDurationTerms, durTerms, durationTermsKeys, durationTermsValues];
}

export async function deployETOTerms(durationTerms, shareholderRights, overrideTerms) {
  const defTerms = {
    DURATION_TERMS: null,
    EXISTING_COMPANY_SHARES: 32000,
    MIN_NUMBER_OF_TOKENS: 5000 * 10000,
    MAX_NUMBER_OF_TOKENS: 10000 * 10000,
    TOKEN_PRICE_EUR_ULPS: Q18.mul(0.0001),
    MIN_TICKET_EUR_ULPS: Q18.mul(500),
    MAX_TICKET_EUR_ULPS: Q18.mul(1000000),
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    IS_CROWDFUNDING: false,
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "9032ujidjosa9012809919293",
    PROSPECTUS_URL: "893289290300923809jdkljoi3",
    SHAREHOLDER_RIGHTS: null,
    EQUITY_TOKEN_NAME: "Quintessence",
    EQUITY_TOKEN_SYMBOL: "FFT",
    SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
  };
  const terms = Object.assign(defTerms, overrideTerms || {});
  const termsKeys = Object.keys(terms);
  terms.DURATION_TERMS = durationTerms.address;
  terms.SHAREHOLDER_RIGHTS = shareholderRights.address;
  const termsValues = termsKeys.map(v => terms[v]);
  const etoTerms = await ETOTerms.new.apply(this, termsValues);

  return [etoTerms, terms, termsKeys, termsValues];
}
