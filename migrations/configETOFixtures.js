import { BigNumber } from "../test/helpers/bignumber";
import { web3, Q18, daysToSeconds } from "../test/helpers/constants";

const defEtoTerms = {
  shareholderTerms: {
    GENERAL_VOTING_RULE: new BigNumber(1),
    TAG_ALONG_VOTING_RULE: new BigNumber(2),
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.times(0.5),
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: new BigNumber(daysToSeconds(10)),
    RESTRICTED_ACT_VOTING_DURATION: new BigNumber(daysToSeconds(14)),
    VOTING_FINALIZATION_DURATION: new BigNumber(daysToSeconds(5)),
    TOKENHOLDERS_QUORUM_FRAC: Q18.times(0.5),
    VOTING_MAJORITY_FRAC: Q18.times(0.5),
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmNPyPao7dEsQzKarCYCyGyDrutzWyACDMcq8HbQ1eGt2E",
  },
  durTerms: {
    WHITELIST_DURATION: new BigNumber(daysToSeconds(7)),
    PUBLIC_DURATION: new BigNumber(daysToSeconds(14)),
    SIGNING_DURATION: new BigNumber(daysToSeconds(14)),
    CLAIM_DURATION: new BigNumber(daysToSeconds(10)),
  },
  tokenTerms: {
    MIN_NUMBER_OF_TOKENS: new BigNumber(1000 * 10000),
    MAX_NUMBER_OF_TOKENS: new BigNumber(3452 * 10000),
    TOKEN_PRICE_EUR_ULPS: Q18.times("0.32376189"),
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new BigNumber(1534 * 10000),
  },
  etoTerms: {
    DURATION_TERMS: null,
    TOKEN_TERMS: null,
    EXISTING_COMPANY_SHARES: new BigNumber(40976),
    MIN_TICKET_EUR_ULPS: Q18.times(100),
    MAX_TICKET_EUR_ULPS: Q18.times(10000000),
    ALLOW_RETAIL_INVESTORS: true,
    ENABLE_TRANSFERS_ON_SUCCESS: false,
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmWKa6zVZjZu3x2CtJnSNTHUwWMeAcyfv9iZDnoawmULeT",
    SHAREHOLDER_RIGHTS: null,
    EQUITY_TOKEN_NAME: "Quintessence",
    EQUITY_TOKEN_SYMBOL: "QTT",
    SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
    WHITELIST_DISCOUNT_FRAC: Q18.times(0.3),
    PUBLIC_DISCOUNT_FRAC: Q18.times(0),
  },
  reservationAndAcquisitionAgreement: "ipfs:QmQsmERwxd9p4njM91aaT5nVhF6q1G3V35JYAzpvFMKrxp",
  companyTokenHolderAgreement: "ipfs:QmVEJvxmo4M5ugvfSQfKzejW8cvXsWe8261MpGChov7DQt",
};

const defEtoHwniTerms = {
  shareholderTerms: {
    GENERAL_VOTING_RULE: new BigNumber(1),
    TAG_ALONG_VOTING_RULE: new BigNumber(2),
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.times(0.5),
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: new BigNumber(daysToSeconds(10)),
    RESTRICTED_ACT_VOTING_DURATION: new BigNumber(daysToSeconds(14)),
    VOTING_FINALIZATION_DURATION: new BigNumber(daysToSeconds(5)),
    TOKENHOLDERS_QUORUM_FRAC: Q18.times(0.5),
    VOTING_MAJORITY_FRAC: Q18.times(0.5),
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmNPyPao7dEsQzKarCYCyGyDrutzWyACDMcq8HbQ1eGt2E",
  },
  durTerms: {
    WHITELIST_DURATION: new BigNumber(daysToSeconds(8)),
    PUBLIC_DURATION: new BigNumber(daysToSeconds(10)),
    SIGNING_DURATION: new BigNumber(daysToSeconds(18)),
    CLAIM_DURATION: new BigNumber(daysToSeconds(10)),
  },
  tokenTerms: {
    MIN_NUMBER_OF_TOKENS: new BigNumber(1000 * 10000),
    MAX_NUMBER_OF_TOKENS: new BigNumber(3452 * 10000),
    TOKEN_PRICE_EUR_ULPS: Q18.times("0.42376189"),
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new BigNumber(1534 * 10000),
  },
  etoTerms: {
    DURATION_TERMS: null,
    TOKEN_TERMS: null,
    EXISTING_COMPANY_SHARES: new BigNumber(41976),
    MIN_TICKET_EUR_ULPS: Q18.times(100000),
    MAX_TICKET_EUR_ULPS: Q18.times(10000000),
    ALLOW_RETAIL_INVESTORS: false,
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmWKa6zVZjZu3x2CtJnSNTHUwWMeAcyfv9iZDnoawmULeT",
    SHAREHOLDER_RIGHTS: null,
    EQUITY_TOKEN_NAME: "Rich",
    EQUITY_TOKEN_SYMBOL: "RCH",
    SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
    WHITELIST_DISCOUNT_FRAC: Q18.times(0.3),
    PUBLIC_DISCOUNT_FRAC: Q18.times(0.2),
  },
  reservationAndAcquisitionAgreement: "ipfs:QmQsmERwxd9p4njM91aaT5nVhF6q1G3V35JYAzpvFMKrxp",
  companyTokenHolderAgreement: "ipfs:QmVEJvxmo4M5ugvfSQfKzejW8cvXsWe8261MpGChov7DQt",
};

// function cloneObject(obj) {
//     const clone = {};
//     for(const i in obj) {
//         if(obj[i] !== null &&  typeof(obj[i]) === "object")
//             clone[i] = cloneObject(obj[i]);
//         else
//             clone[i] = obj[i];
//     }
//     return clone;
// }

export function prepareEtoTerms(name) {
  const terms = name === "ETOInWhitelistState" ? defEtoHwniTerms : defEtoTerms;
  const copy = Object.assign({}, terms);
  copy.name = name;
  return copy;
}
