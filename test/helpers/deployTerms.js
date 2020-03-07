import {
  daysToSeconds,
  Q18,
  web3,
  findConstructor,
  camelCase,
  defaultTokensPerShare,
  defEquityTokenDecimals,
} from "./constants";
import { knownInterfaces } from "../helpers/knownInterfaces";

export const defaultShareholderTerms = {
  GENERAL_VOTING_RULE: new web3.BigNumber(1),
  TAG_ALONG_VOTING_RULE: new web3.BigNumber(2),
  LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.mul(1.5),
  HAS_FOUNDERS_VESTING: true,
  GENERAL_VOTING_DURATION: new web3.BigNumber(daysToSeconds(10)),
  RESTRICTED_ACT_VOTING_DURATION: new web3.BigNumber(daysToSeconds(14)),
  VOTING_FINALIZATION_DURATION: new web3.BigNumber(daysToSeconds(5)),
  SHAREHOLDERS_VOTING_QUORUM_FRAC: Q18.mul(0.1),
  VOTING_MAJORITY_FRAC: Q18.mul(0.1),
  INVESTMENT_AGREEMENT_TEMPLATE_URL: "9032ujidjosa9012809919293",
};

export const defDurTerms = {
  WHITELIST_DURATION: new web3.BigNumber(daysToSeconds(7)),
  PUBLIC_DURATION: new web3.BigNumber(daysToSeconds(30)),
  SIGNING_DURATION: new web3.BigNumber(daysToSeconds(14)),
  CLAIM_DURATION: new web3.BigNumber(daysToSeconds(10)),
};

export const defTokenTerms = {
  EQUITY_TOKEN_NAME: "Quintessence",
  EQUITY_TOKEN_SYMBOL: "FFT",
  MIN_NUMBER_OF_TOKENS: defaultTokensPerShare.mul(20),
  MAX_NUMBER_OF_TOKENS: defaultTokensPerShare.mul(100),
  TOKEN_PRICE_EUR_ULPS: Q18.mul("0.12376189651788"),
  MAX_NUMBER_OF_TOKENS_IN_WHITELIST: defaultTokensPerShare.mul(40),
  SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
  SHARE_NOMINAL_VALUE_ULPS: Q18.mul("4.24566"),
  EQUITY_TOKENS_PER_SHARE: defaultTokensPerShare,
  EQUITY_TOKEN_DECIMALS: defEquityTokenDecimals,
};

export const defEtoTerms = {
  DURATION_TERMS: null,
  TOKEN_TERMS: null,
  SHARE_CAPITAL_CURRENCY_CODE: "PLN",
  EXISTING_SHARE_CAPITAL: Q18.mul(32000),
  MIN_TICKET_EUR_ULPS: Q18.mul(500),
  MAX_TICKET_EUR_ULPS: Q18.mul(1000000),
  ENABLE_TRANSFERS_ON_SUCCESS: false,
  INVESTOR_OFFERING_DOCUMENT_URL: "893289290300923809jdkljoi3",
  SHAREHOLDER_RIGHTS: null,
  WHITELIST_DISCOUNT_FRAC: Q18.mul("0.3"),
  PUBLIC_DISCOUNT_FRAC: Q18.mul(0),
};

export const defTermsConstraints = {
  CAN_SET_TRANSFERABILITY: true,
  HAS_NOMINEE: true,
  MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
  // unlimited
  MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
  MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
  // unlimited
  MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
  NAME: "Some Constraints",
  OFFERING_DOCUMENT_TYPE: new web3.BigNumber(1),
  OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(1),
  JURISDICTION: "DE",
  ASSET_TYPE: new web3.BigNumber(0),
  TOKEN_OFFERING_OPERATOR: "0xC5a96Db085dDA36FfBE390f455315D30D6D3DC52",
};

export function validateTerms(artifact, terms) {
  const constructor = findConstructor(artifact);
  const camelTerms = {};
  // could not find any good way to do dictionary comprehension
  Object.keys(terms).map(k => {
    camelTerms[camelCase(k)] = terms[k];
    return k;
  });
  if (Object.keys(terms).length !== constructor.inputs.length) {
    throw new Error(
      `No. params in terms not equal no. inputs in constructor of ${artifact.contract_name}`,
    );
  }
  const termsValues = [];
  let idx = 0;
  for (const input of constructor.inputs) {
    if (!(input.name in camelTerms)) {
      throw new Error(
        // eslint-disable-next-line max-len
        `Input at ${idx} name in constructor "${input.name}" could not be found in terms of ${artifact.contract_name}`,
      );
    }
    let typeMatch = false;
    const termValue = camelTerms[input.name];
    switch (input.type) {
      case "address":
      case "string":
        typeMatch = typeof termValue === "string";
        break;
      case "uint8":
      case "uint32":
      case "uint256":
      case "uint128":
        if (typeof termValue === "object") {
          typeMatch = termValue.constructor.name.includes("BigNumber");
        }
        break;
      case "bool":
        typeMatch = typeof termValue === "boolean";
        break;
      default:
        throw new Error(
          `Unsupported abi type ${input.type} name ${input.name} of ${artifact.contract_name}`,
        );
    }
    if (!typeMatch) {
      throw new Error(
        // eslint-disable-next-line max-len
        `Type mismatch type ${input.type} name ${input.name} value ${termValue} of ${artifact.contract_name}`,
      );
    }
    termsValues.push(termValue);
    idx += 1;
  }
  return [Object.keys(terms), termsValues];
}

export async function deployShareholderRights(artifact, terms, fullTerms) {
  const defaults = fullTerms ? {} : defaultShareholderTerms;
  const shareholderTerms = Object.assign({}, defaults, terms || {});
  const [shareholderTermsKeys, shareholderTermsValues] = validateTerms(artifact, shareholderTerms);
  const shareholderRights = await artifact.new.apply(this, shareholderTermsValues);
  return [shareholderRights, shareholderTerms, shareholderTermsKeys, shareholderTermsValues];
}

export async function deployDurationTerms(artifact, terms, fullTerms) {
  const defaults = fullTerms ? {} : defDurTerms;
  const durTerms = Object.assign({}, defaults, terms || {});
  const [durationTermsKeys, durationTermsValues] = validateTerms(artifact, durTerms);
  const etoDurationTerms = await artifact.new.apply(this, durationTermsValues);
  return [etoDurationTerms, durTerms, durationTermsKeys, durationTermsValues];
}

export async function deployTokenTerms(artifact, terms, fullTerms) {
  const defaults = fullTerms ? {} : defTokenTerms;
  const tokenTerms = Object.assign({}, defaults, terms || {});
  const [tokenTermsKeys, tokenTermsValues] = validateTerms(artifact, tokenTerms);
  const etoTokenTerms = await artifact.new.apply(this, tokenTermsValues);
  return [etoTokenTerms, tokenTerms, tokenTermsKeys, tokenTermsValues];
}

export async function deployETOTerms(
  universe,
  artifact,
  durationTerms,
  tokenTerms,
  shareholderRights,
  termsConstraints,
  terms,
  fullTerms,
) {
  const defaults = fullTerms ? {} : defEtoTerms;
  const etoTerms = Object.assign({}, defaults, terms || {});
  etoTerms.UNIVERSE = universe.address;
  etoTerms.DURATION_TERMS = durationTerms.address;
  etoTerms.TOKEN_TERMS = tokenTerms.address;
  etoTerms.SHAREHOLDER_RIGHTS = shareholderRights.address;
  etoTerms.ETO_TERMS_CONSTRAINTS = termsConstraints.address;
  const [termsKeys, termsValues] = validateTerms(artifact, etoTerms);
  const deployedTerms = await artifact.new.apply(this, termsValues);
  return [deployedTerms, etoTerms, termsKeys, termsValues];
}

export async function deployETOTermsConstraints(artifact, terms, fullTerms) {
  const defaults = fullTerms ? {} : defTermsConstraints;
  const constraintsTerms = Object.assign({}, defaults, terms || {});
  const [constraintsTermsKeys, constraintsTermsValues] = validateTerms(artifact, constraintsTerms);
  const etoTermsConstraints = await artifact.new.apply(this, constraintsTermsValues);
  return [etoTermsConstraints, constraintsTerms, constraintsTermsKeys, constraintsTermsValues];
}

export async function deployETOTermsConstraintsUniverse(admin, universe, artifact, terms) {
  const [
    etoTermsConstraints,
    constraintsTerms,
    constraintsTermsKeys,
    constraintsTermsValues,
  ] = await deployETOTermsConstraints(artifact, terms);
  // add the constraints to the universe
  await universe.setCollectionsInterfaces(
    [knownInterfaces.etoTermsConstraints],
    [etoTermsConstraints.address],
    [true],
    { from: admin },
  );
  return [etoTermsConstraints, constraintsTerms, constraintsTermsKeys, constraintsTermsValues];
}
