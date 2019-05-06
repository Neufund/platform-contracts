import { web3, Q18 } from "../test/helpers/constants";

const two = new web3.BigNumber(2);
const intMax = two.pow(256) - 1;

export const constraints = [
  // HNWI ETO DE
  {
    NAME: "hnwi eto de",
    CAN_SET_TRANSFERABILITY: false,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(200000),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: intMax,
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(0),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "DE",
    ASSET_TYPE: new web3.BigNumber(1),
  },
  // HNWI ETO LI
  {
    NAME: "hnwi eto li",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(100000),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: intMax,
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(0),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(0),
  },
  // PRIVATE ETO LI
  {
    NAME: "private eto li",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: intMax,
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(0),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(0),
  },
  // MINI ETO LI
  {
    NAME: "private eto li",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(5000000),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(0),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "li",
    ASSET_TYPE: new web3.BigNumber(0),
  },
  // EU-SME ETO LI
  {
    NAME: "eu-sme eto li",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(20000000),
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(1),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(1),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(0),
  },
  // RETAIL ETO DE
  {
    NAME: "retail eto li security",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: intMax,
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(1),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "DE",
    ASSET_TYPE: new web3.BigNumber(0),
  },
  // RETAIL ETO LI 2
  {
    NAME: "retail eto li vma",
    CAN_SET_TRANSFERABILITY: false,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: intMax,
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(0),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "LI",
    ASSET_TYPE: new web3.BigNumber(1),
  },
  // FF ETO
  {
    NAME: "retail eto li vma",
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(100000),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: intMax,
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(0),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(0),
    JURISDICTION: "DE",
    ASSET_TYPE: new web3.BigNumber(0),
  },
];

// this will be populated in migration step 12 and then can be used when deploying mock ETOs
export const deployedAddresses = [];