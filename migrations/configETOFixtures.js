import { web3, Q18, daysToSeconds } from "../test/helpers/constants";

const defEtoTerms = {
  shareholderTerms: {
    GENERAL_VOTING_RULE: new web3.BigNumber(1),
    TAG_ALONG_VOTING_RULE: new web3.BigNumber(2),
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.mul(0),
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: new web3.BigNumber(daysToSeconds(10)),
    RESTRICTED_ACT_VOTING_DURATION: new web3.BigNumber(daysToSeconds(14)),
    VOTING_FINALIZATION_DURATION: new web3.BigNumber(daysToSeconds(5)),
    TOKENHOLDERS_QUORUM_FRAC: Q18.mul(0.5),
    VOTING_MAJORITY_FRAC: Q18.mul(0.5),
  },
  durTerms: {
    WHITELIST_DURATION: new web3.BigNumber(daysToSeconds(7)),
    PUBLIC_DURATION: new web3.BigNumber(daysToSeconds(14)),
    SIGNING_DURATION: new web3.BigNumber(daysToSeconds(14)),
    CLAIM_DURATION: new web3.BigNumber(daysToSeconds(10)),
  },
  tokenTerms: {
    MIN_NUMBER_OF_TOKENS: new web3.BigNumber(1000 * 10000),
    MAX_NUMBER_OF_TOKENS: new web3.BigNumber(3452 * 10000),
    TOKEN_PRICE_EUR_ULPS: Q18.mul("0.32376189"),
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(1534 * 10000),
  },
  etoTerms: {
    DURATION_TERMS: null,
    TOKEN_TERMS: null,
    EXISTING_COMPANY_SHARES: new web3.BigNumber(40976),
    MIN_TICKET_EUR_ULPS: Q18.mul(100),
    MAX_TICKET_EUR_ULPS: Q18.mul(10000000),
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    IS_CROWDFUNDING: false,
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmVbzgZ4Ape7LVqZbsChmoqanj1npfmLR4SG7FezZ3MqS9",
    PROSPECTUS_URL: "ipfs:QmQYWyx6WWwCYqBnJ74ruogTTHfKoscQRHU5eJFKDD22mT",
    SHAREHOLDER_RIGHTS: null,
    EQUITY_TOKEN_NAME: "Quintessence",
    EQUITY_TOKEN_SYMBOL: "QTT",
    SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
    WHITELIST_DISCOUNT_FRAC: Q18.mul(0.3),
  },
  reservationAndAcquisitionAgreement: "ipfs:QmdV6wnSBku1ho1hLwqeSvuaN9HD1E6E7jhyQHdWteRRWz",
  companyTokenHolderAgreement: "ipfs:QmRCwEaTf6dxSPwDqGEs9nZ6hbtvZdSCaTTWFzoFQYjkwo",
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
  const copy = Object.assign({}, defEtoTerms);
  copy.name = name;
  return copy;
}
