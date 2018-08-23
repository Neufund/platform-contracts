import { daysToSeconds, Q18, web3, findConstructor, camelCase } from "./constants";

export const defaultShareholderTerms = {
  GENERAL_VOTING_RULE: new web3.BigNumber(1),
  TAG_ALONG_VOTING_RULE: new web3.BigNumber(2),
  LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC: Q18.mul(1.5),
  HAS_FOUNDERS_VESTING: true,
  GENERAL_VOTING_DURATION: new web3.BigNumber(daysToSeconds(10)),
  RESTRICTED_ACT_VOTING_DURATION: new web3.BigNumber(daysToSeconds(14)),
  VOTING_FINALIZATION: new web3.BigNumber(daysToSeconds(5)),
  TOKENHOLDERS_QUORUM_FRAC: Q18.mul(0.1),
};

export const defDurTerms = {
  WHITELIST_DURATION: new web3.BigNumber(daysToSeconds(7)),
  PUBLIC_DURATION: new web3.BigNumber(daysToSeconds(30)),
  SIGNING_DURATION: new web3.BigNumber(daysToSeconds(14)),
  CLAIM_DURATION: new web3.BigNumber(daysToSeconds(10)),
};

export const defTokenTerms = {
  MIN_NUMBER_OF_TOKENS: new web3.BigNumber(2000 * 10000),
  MAX_NUMBER_OF_TOKENS: new web3.BigNumber(10000 * 10000),
  TOKEN_PRICE_EUR_ULPS: Q18.mul("0.12376189"),
};

export const defEtoTerms = {
  DURATION_TERMS: null,
  TOKEN_TERMS: null,
  EXISTING_COMPANY_SHARES: new web3.BigNumber(32000),
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

export function validateTerms(artifact, terms) {
  const constructor = findConstructor(artifact);
  const termsKeys = Object.keys(terms);
  const termsValues = termsKeys.map(v => terms[v]);
  if (termsKeys.length !== constructor.inputs.length) {
    throw new Error(
      `No params in terms not equal no inputs in constructor of ${artifact.contract_name}`,
    );
  }
  let idx = 0;
  for (const input of constructor.inputs) {
    const keyName = camelCase(termsKeys[idx]);
    if (input.name !== keyName) {
      throw new Error(
        `Input at ${idx} name in terms "${keyName}" vs name in constructor "${input.name}" of ${
          artifact.contract_name
        }`,
      );
    }
    let typeMatch = false;
    switch (input.type) {
      case "address":
      case "string":
        typeMatch = typeof termsValues[idx] === "string";
        break;
      case "uint8":
      case "uint32":
      case "uint256":
      case "uint128":
        if (typeof termsValues[idx] === "object") {
          typeMatch = termsValues[idx].constructor.name.includes("BigNumber");
        }
        break;
      case "bool":
        typeMatch = typeof termsValues[idx] === "boolean";
        break;
      default:
        throw new Error(
          `Unsupported abi type ${input.type} name ${input.name} of ${artifact.contract_name}`,
        );
    }
    if (!typeMatch) {
      throw new Error(
        `Type mismatch type ${input.type} name ${input.name} value ${termsValues[idx]} of ${
          artifact.contract_name
        }`,
      );
    }
    idx += 1;
  }
  return [termsKeys, termsValues];
}

export async function deployShareholderRights(artifact, overrideTerms) {
  const shareholderTerms = Object.assign({}, defaultShareholderTerms, overrideTerms || {});
  const [shareholderTermsKeys, shareholderTermsValues] = validateTerms(artifact, shareholderTerms);
  const shareholderRights = await artifact.new.apply(this, shareholderTermsValues);
  return [shareholderRights, shareholderTerms, shareholderTermsKeys, shareholderTermsValues];
}

export async function deployDurationTerms(artifact, overrideTerms) {
  const durTerms = Object.assign({}, defDurTerms, overrideTerms || {});
  const [durationTermsKeys, durationTermsValues] = validateTerms(artifact, durTerms);
  const etoDurationTerms = await artifact.new.apply(this, durationTermsValues);
  return [etoDurationTerms, durTerms, durationTermsKeys, durationTermsValues];
}

export async function deployTokenTerms(artifact, overrideTerms) {
  const tokenTerms = Object.assign({}, defTokenTerms, overrideTerms || {});
  const [tokenTermsKeys, tokenTermsValues] = validateTerms(artifact, tokenTerms);
  const etoTokenTerms = await artifact.new.apply(this, tokenTermsValues);
  return [etoTokenTerms, tokenTerms, tokenTermsKeys, tokenTermsValues];
}

export async function deployETOTerms(
  artifact,
  durationTerms,
  tokenTerms,
  shareholderRights,
  overrideTerms,
) {
  const terms = Object.assign({}, defEtoTerms, overrideTerms || {});
  terms.DURATION_TERMS = durationTerms.address;
  terms.TOKEN_TERMS = tokenTerms.address;
  terms.SHAREHOLDER_RIGHTS = shareholderRights.address;
  const [termsKeys, termsValues] = validateTerms(artifact, terms);
  const etoTerms = await artifact.new.apply(this, termsValues);
  return [etoTerms, terms, termsKeys, termsValues];
}
