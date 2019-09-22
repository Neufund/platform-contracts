import { web3, Q18, daysToSeconds, recoverBigNumbers } from "../test/helpers/constants";

const getETOConstraintFixtureAndAddressByName = require("./configETOTermsFixtures")
  .getFixtureAndAddressByName;

export const defEtoTerms = {
  shareholderTerms: {
    GENERAL_VOTING_RULE: new web3.BigNumber(1),
    TAG_ALONG_VOTING_RULE: new web3.BigNumber(2),
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.mul(0.5),
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: new web3.BigNumber(daysToSeconds(10)),
    RESTRICTED_ACT_VOTING_DURATION: new web3.BigNumber(daysToSeconds(14)),
    VOTING_FINALIZATION_DURATION: new web3.BigNumber(daysToSeconds(5)),
    SHAREHOLDERS_VOTING_QUORUM_FRAC: Q18.mul(0.5),
    VOTING_MAJORITY_FRAC: Q18.mul(0.5),
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmNPyPao7dEsQzKarCYCyGyDrutzWyACDMcq8HbQ1eGt2E",
  },
  durTerms: {
    WHITELIST_DURATION: new web3.BigNumber(daysToSeconds(7)),
    PUBLIC_DURATION: new web3.BigNumber(daysToSeconds(14)),
    SIGNING_DURATION: new web3.BigNumber(daysToSeconds(14)),
    CLAIM_DURATION: new web3.BigNumber(daysToSeconds(10)),
  },
  tokenTerms: {
    EQUITY_TOKEN_NAME: "Quintessence",
    EQUITY_TOKEN_SYMBOL: "QTT",
    MIN_NUMBER_OF_TOKENS: new web3.BigNumber(1000 * 10000),
    MAX_NUMBER_OF_TOKENS: new web3.BigNumber(3452 * 10000),
    TOKEN_PRICE_EUR_ULPS: Q18.mul("0.32376189"),
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(1534 * 10000),
    SHARE_NOMINAL_VALUE_ULPS: Q18,
    SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
    EQUITY_TOKENS_PER_SHARE: new web3.BigNumber("10000"),
  },
  etoTerms: {
    DURATION_TERMS: null,
    TOKEN_TERMS: null,
    SHARE_CAPITAL_CURRENCY_CODE: "EUR",
    EXISTING_SHARE_CAPITAL: Q18.mul(40976),
    MIN_TICKET_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_EUR_ULPS: Q18.mul(5000000),
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmWKa6zVZjZu3x2CtJnSNTHUwWMeAcyfv9iZDnoawmULeT",
    SHAREHOLDER_RIGHTS: null,
    WHITELIST_DISCOUNT_FRAC: Q18.mul(0.3),
    PUBLIC_DISCOUNT_FRAC: Q18.mul(0),
  },
  etoTermsConstraints: "mini eto li",
  reservationAndAcquisitionAgreement: "ipfs:QmQsmERwxd9p4njM91aaT5nVhF6q1G3V35JYAzpvFMKrxp",
  companyTokenHolderAgreement: "ipfs:QmVEJvxmo4M5ugvfSQfKzejW8cvXsWe8261MpGChov7DQt",
};

export const hnwiEtoDeSecurityTerms = {
  shareholderTerms: {
    GENERAL_VOTING_RULE: new web3.BigNumber(1),
    TAG_ALONG_VOTING_RULE: new web3.BigNumber(2),
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.mul(0.5),
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: new web3.BigNumber(daysToSeconds(10)),
    RESTRICTED_ACT_VOTING_DURATION: new web3.BigNumber(daysToSeconds(14)),
    VOTING_FINALIZATION_DURATION: new web3.BigNumber(daysToSeconds(5)),
    SHAREHOLDERS_VOTING_QUORUM_FRAC: Q18.mul(0.5),
    VOTING_MAJORITY_FRAC: Q18.mul(0.5),
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmNPyPao7dEsQzKarCYCyGyDrutzWyACDMcq8HbQ1eGt2E",
  },
  durTerms: {
    WHITELIST_DURATION: new web3.BigNumber(daysToSeconds(8)),
    PUBLIC_DURATION: new web3.BigNumber(daysToSeconds(10)),
    SIGNING_DURATION: new web3.BigNumber(daysToSeconds(18)),
    CLAIM_DURATION: new web3.BigNumber(daysToSeconds(10)),
  },
  tokenTerms: {
    EQUITY_TOKEN_NAME: "Rich",
    EQUITY_TOKEN_SYMBOL: "RCH",
    MIN_NUMBER_OF_TOKENS: new web3.BigNumber(1000 * 10000),
    MAX_NUMBER_OF_TOKENS: new web3.BigNumber(3452 * 10000),
    TOKEN_PRICE_EUR_ULPS: Q18.mul("0.42376189"),
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(1534 * 10000),
    SHARE_NOMINAL_VALUE_ULPS: Q18,
    SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
    EQUITY_TOKENS_PER_SHARE: new web3.BigNumber("10000"),
  },
  etoTerms: {
    ETO_TERMS_CONSTRAINTS: null,
    DURATION_TERMS: null,
    TOKEN_TERMS: null,
    SHARE_CAPITAL_CURRENCY_CODE: "EUR",
    EXISTING_SHARE_CAPITAL: Q18.mul(41976),
    MIN_TICKET_EUR_ULPS: Q18.mul(100000),
    MAX_TICKET_EUR_ULPS: Q18.mul(10000000),
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmWKa6zVZjZu3x2CtJnSNTHUwWMeAcyfv9iZDnoawmULeT",
    SHAREHOLDER_RIGHTS: null,
    WHITELIST_DISCOUNT_FRAC: Q18.mul(0.3),
    PUBLIC_DISCOUNT_FRAC: Q18.mul(0.2),
  },
  etoTermsConstraints: "hnwi eto de security",
  reservationAndAcquisitionAgreement: "ipfs:QmQsmERwxd9p4njM91aaT5nVhF6q1G3V35JYAzpvFMKrxp",
  companyTokenHolderAgreement: "ipfs:QmVEJvxmo4M5ugvfSQfKzejW8cvXsWe8261MpGChov7DQt",
};

export const retailEtoDeVmaTerms = {
  etoTerms: {
    SHARE_CAPITAL_CURRENCY_CODE: "EUR",
    EXISTING_SHARE_CAPITAL: Q18.mul("9000"),
    MIN_TICKET_EUR_ULPS: "10000000000000000000",
    MAX_TICKET_EUR_ULPS: "10000000000000000000000000",
    ENABLE_TRANSFERS_ON_SUCCESS: false,
    WHITELIST_DISCOUNT_FRAC: "300000000000000000",
    PUBLIC_DISCOUNT_FRAC: "0",
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmcoZxecpVUaWCG2CjdNucNtRzKsCYBGaTkC54eW6MkRg3",
  },
  shareholderTerms: {
    GENERAL_VOTING_RULE: "1",
    TAG_ALONG_VOTING_RULE: "2",
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: "0",
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: "864000",
    RESTRICTED_ACT_VOTING_DURATION: "1209600",
    VOTING_FINALIZATION_DURATION: "604800",
    SHAREHOLDERS_VOTING_QUORUM_FRAC: "500000000000000000",
    VOTING_MAJORITY_FRAC: "500000000000000000",
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmdJQ9mrepd6mNQ6KTyoPwPELhbRZnN4pYUVyg2VY2vTG1",
  },
  durTerms: {
    WHITELIST_DURATION: "604800",
    PUBLIC_DURATION: "2592000",
    SIGNING_DURATION: "5097600",
    CLAIM_DURATION: "864000",
  },
  tokenTerms: {
    EQUITY_TOKEN_NAME: "NOMERA",
    EQUITY_TOKEN_SYMBOL: "NOM",
    MIN_NUMBER_OF_TOKENS: "10000000",
    MAX_NUMBER_OF_TOKENS: "15000000",
    TOKEN_PRICE_EUR_ULPS: "666666666666666667",
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: "15000000",
    SHARE_NOMINAL_VALUE_ULPS: "1000000000000000000",
    SHARE_NOMINAL_VALUE_EUR_ULPS: "1000000000000000000",
    EQUITY_TOKENS_PER_SHARE: new web3.BigNumber("10000"),
  },
  etoTermsConstraints: "retail eto de vma",
  reservationAndAcquisitionAgreement: "ipfs:QmQsmERwxd9p4njM91aaT5nVhF6q1G3V35JYAzpvFMKrxp",
  companyTokenHolderAgreement: "ipfs:QmVEJvxmo4M5ugvfSQfKzejW8cvXsWe8261MpGChov7DQt",
};

export const miniEtoLiTerms = {
  etoTerms: {
    SHARE_CAPITAL_CURRENCY_CODE: "EUR",
    EXISTING_SHARE_CAPITAL: Q18.mul("5000"),
    MIN_TICKET_EUR_ULPS: "10000000000000000000",
    MAX_TICKET_EUR_ULPS: "5000000000000000000000000",
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    WHITELIST_DISCOUNT_FRAC: "400000000000000000",
    PUBLIC_DISCOUNT_FRAC: "0",
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmZrZrjMeGAGbKgnfo8HjAo2EsYNJ8bVjpvWTt8y1FMf5N",
  },
  shareholderTerms: {
    GENERAL_VOTING_RULE: "1",
    TAG_ALONG_VOTING_RULE: "2",
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: "0",
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: "864000",
    RESTRICTED_ACT_VOTING_DURATION: "1209600",
    VOTING_FINALIZATION_DURATION: "604800",
    SHAREHOLDERS_VOTING_QUORUM_FRAC: "500000000000000000",
    VOTING_MAJORITY_FRAC: "500000000000000000",
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmNzSHHHqe6NQbB3NnxmWvzyLHNjovU8cBxyJRWHDVGFfE",
  },
  durTerms: {
    WHITELIST_DURATION: "604800",
    PUBLIC_DURATION: "2592000",
    SIGNING_DURATION: "5184000",
    CLAIM_DURATION: "864000",
  },
  tokenTerms: {
    EQUITY_TOKEN_NAME: "Blok",
    EQUITY_TOKEN_SYMBOL: "BLKK",
    MIN_NUMBER_OF_TOKENS: "5000000",
    MAX_NUMBER_OF_TOKENS: "6000000",
    TOKEN_PRICE_EUR_ULPS: "600000000000000000",
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: "5500000",
    SHARE_NOMINAL_VALUE_ULPS: "1000000000000000000",
    SHARE_NOMINAL_VALUE_EUR_ULPS: "1000000000000000000",
    EQUITY_TOKENS_PER_SHARE: new web3.BigNumber("10000"),
  },
  etoTermsConstraints: "mini eto li",
  reservationAndAcquisitionAgreement: "ipfs:QmQsmERwxd9p4njM91aaT5nVhF6q1G3V35JYAzpvFMKrxp",
  companyTokenHolderAgreement: "ipfs:QmVEJvxmo4M5ugvfSQfKzejW8cvXsWe8261MpGChov7DQt",
};

export const miniEtoLiNominalValueTerms = {
  etoTerms: {
    SHARE_CAPITAL_CURRENCY_CODE: "PLN",
    EXISTING_SHARE_CAPITAL: Q18.mul("27800"),
    MIN_TICKET_EUR_ULPS: Q18.mul("100"),
    MAX_TICKET_EUR_ULPS: Q18.mul("5000000"),
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    WHITELIST_DISCOUNT_FRAC: Q18.mul("0.1"),
    PUBLIC_DISCOUNT_FRAC: "0",
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmZrZrjMeGAGbKgnfo8HjAo2EsYNJ8bVjpvWTt8y1FMf5N",
  },
  shareholderTerms: {
    GENERAL_VOTING_RULE: "1",
    TAG_ALONG_VOTING_RULE: "2",
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: "0",
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: "864000",
    RESTRICTED_ACT_VOTING_DURATION: "1209600",
    VOTING_FINALIZATION_DURATION: "604800",
    SHAREHOLDERS_VOTING_QUORUM_FRAC: Q18.mul("0.1"),
    VOTING_MAJORITY_FRAC: Q18.mul("0.5"),
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmNzSHHHqe6NQbB3NnxmWvzyLHNjovU8cBxyJRWHDVGFfE",
  },
  durTerms: {
    WHITELIST_DURATION: "604800",
    PUBLIC_DURATION: "2592000",
    SIGNING_DURATION: "5184000",
    CLAIM_DURATION: "864000",
  },
  tokenTerms: {
    EQUITY_TOKEN_NAME: "6-SHARES",
    EQUITY_TOKEN_SYMBOL: "SSH",
    MIN_NUMBER_OF_TOKENS: "6000000",
    MAX_NUMBER_OF_TOKENS: "30000000",
    TOKEN_PRICE_EUR_ULPS: Q18.mul("0.161870503597122302"),
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: "30000000",
    SHARE_NOMINAL_VALUE_ULPS: Q18.mul("100"),
    SHARE_NOMINAL_VALUE_EUR_ULPS: Q18.mul("13.5"),
    EQUITY_TOKENS_PER_SHARE: new web3.BigNumber("1000000"),
  },
  etoTermsConstraints: "mini eto li",
  reservationAndAcquisitionAgreement: "ipfs:QmQsmERwxd9p4njM91aaT5nVhF6q1G3V35JYAzpvFMKrxp",
  companyTokenHolderAgreement: "ipfs:QmVEJvxmo4M5ugvfSQfKzejW8cvXsWe8261MpGChov7DQt",
};

export const hnwiEtoLiSecurityTerms = {
  etoTerms: {
    ETO_TERMS_CONSTRAINTS: "0x85bEa76f2ec57147F9942f68D896e10d6BCAcf03",
    SHARE_CAPITAL_CURRENCY_CODE: "EUR",
    EXISTING_SHARE_CAPITAL: Q18.mul("10050"),
    MIN_TICKET_EUR_ULPS: "100000000000000000000000",
    MAX_TICKET_EUR_ULPS: "15920398009950248756218905",
    ENABLE_TRANSFERS_ON_SUCCESS: true,
    WHITELIST_DISCOUNT_FRAC: "300000000000000000",
    PUBLIC_DISCOUNT_FRAC: "0",
    INVESTOR_OFFERING_DOCUMENT_URL: "ipfs:QmZrZrjMeGAGbKgnfo8HjAo2EsYNJ8bVjpvWTt8y1FMf5N",
  },
  shareholderTerms: {
    GENERAL_VOTING_RULE: "1",
    TAG_ALONG_VOTING_RULE: "2",
    LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: "0",
    HAS_FOUNDERS_VESTING: true,
    GENERAL_VOTING_DURATION: "864000",
    RESTRICTED_ACT_VOTING_DURATION: "1209600",
    VOTING_FINALIZATION_DURATION: "604800",
    SHAREHOLDERS_VOTING_QUORUM_FRAC: "500000000000000000",
    VOTING_MAJORITY_FRAC: "500000000000000000",
    INVESTMENT_AGREEMENT_TEMPLATE_URL: "ipfs:QmaRkcbpuf8sinZkbHvjnjBNY8J3diRu1aWQuS9kQPkv1S",
  },
  durTerms: {
    WHITELIST_DURATION: "1209600",
    PUBLIC_DURATION: "1209600",
    SIGNING_DURATION: "5184000",
    CLAIM_DURATION: "864000",
  },
  tokenTerms: {
    EQUITY_TOKEN_NAME: "Bionic",
    EQUITY_TOKEN_SYMBOL: "BNIC",
    MIN_NUMBER_OF_TOKENS: "10000000",
    MAX_NUMBER_OF_TOKENS: "20000000",
    TOKEN_PRICE_EUR_ULPS: "796019900497512438",
    MAX_NUMBER_OF_TOKENS_IN_WHITELIST: "20000000",
    SHARE_NOMINAL_VALUE_ULPS: "1000000000000000000",
    SHARE_NOMINAL_VALUE_EUR_ULPS: "1000000000000000000",
    EQUITY_TOKENS_PER_SHARE: new web3.BigNumber("10000"),
  },
  etoTermsConstraints: "hnwi eto li security",
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

export function prepareEtoTerms(name, terms) {
  // resolve eto constraints name
  const { constraintFixture, constraintAddress } = getETOConstraintFixtureAndAddressByName(
    terms.etoTermsConstraints,
  );
  const copy = Object.assign({}, terms);
  copy.name = name;
  // provide correct address in eto terms
  const copyConstraints = Object.assign({}, constraintFixture);
  delete copyConstraints._deploymentMetadata;
  copy.etoTermsConstraints = copyConstraints;
  copy.etoTerms.ETO_TERMS_CONSTRAINTS = constraintAddress;
  return recoverBigNumbers(copy);
}
