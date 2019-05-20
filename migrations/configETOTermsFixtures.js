import { web3, Q18 } from "../test/helpers/constants";
import {
  OfferingDocumentType,
  OfferingDocumentSubType,
  AssetType,
} from "../test/helpers/termsConstants";

export const constraints = [
  {
    NAME: "hnwi eto de vma",
    CAN_SET_TRANSFERABILITY: false,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(200000),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(OfferingDocumentType.Memorandum),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(OfferingDocumentSubType.Regular),
    JURISDICTION: "DE",
    ASSET_TYPE: new web3.BigNumber(AssetType.VMA),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_DE",
    _deploymentMetadata: { step: 1, available: true },
  },
  {
    NAME: "hnwi eto li security",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(100000),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(OfferingDocumentType.Memorandum),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(OfferingDocumentSubType.Regular),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(AssetType.Security),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_LI",
    _deploymentMetadata: { step: 1, available: true },
  },
  // must stay commented out until we can seto max and min durations in eto constrainst
  // which is required by private etos
  /*
  {
    NAME: "private eto li",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(0),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(0),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_LI",
    _deploymentMetadata: { step: 2, available: true},
  },
  */
  {
    NAME: "mini eto li",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(5000000),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(OfferingDocumentType.Memorandum),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(OfferingDocumentSubType.Regular),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(AssetType.Security),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_LI",
    _deploymentMetadata: { step: 1, available: true },
  },
  // do not create products based on lean prospectus yet, we do not know real parameters
  /*
  {
    NAME: "eu-sme eto li",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(20000000),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(OfferingDocumentType.Prospectus),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(OfferingDocumentSubType.Lean),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(AssetType.Security),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_LI",
    _deploymentMetadata: { step: 2, available: true},
  },
  */
  {
    NAME: "retail eto li security",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(OfferingDocumentType.Prospectus),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(OfferingDocumentSubType.Regular),
    JURISDICTION: "DE",
    ASSET_TYPE: new web3.BigNumber(AssetType.Security),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_LI",
    _deploymentMetadata: { step: 1, available: true },
  },
  {
    NAME: "retail eto li vma",
    CAN_SET_TRANSFERABILITY: false,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(OfferingDocumentType.Prospectus),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(OfferingDocumentSubType.Regular),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(AssetType.VMA),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_LI",
    _deploymentMetadata: { step: 1, available: true },
  },
  {
    NAME: "hnwi eto de security",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(100000),
    MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(OfferingDocumentType.Memorandum),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(OfferingDocumentSubType.Regular),
    JURISDICTION: "DE",
    ASSET_TYPE: new web3.BigNumber(AssetType.Security),
    TOKEN_OFFERING_OPERATOR: "TOKEN_OFFERING_OPERATOR_LI",
    _deploymentMetadata: { step: 1, available: false },
  },
];

// this will be populated in migration step 12 and then can be used when deploying mock ETOs
export const deployedAddresses = [];

export const getFixtureAndAddressByName = name => {
  for (let i = 0; i < constraints.length; i += 1)
    if (constraints[i].NAME === name)
      return {
        constraintFixture: constraints[i],
        constraintAddress: deployedAddresses[i],
      };
  throw new Error(`Constraint with name ${name} not found`);
};
