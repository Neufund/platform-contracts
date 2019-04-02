import { web3, Q18 } from "../test/helpers/constants";

const two = new web3.BigNumber(2);
const intMax = two.pow(128);

export const constraints = [
  {
    CAN_SET_TRANSFERABILITY: true,
    HAS_NOMINEE: true,
    MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    MAX_TICKET_SIZE_EUR_ULPS: intMax,
    MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    MAX_INVESTMENT_AMOUNT_EUR_ULPS: intMax,
    NAME: "Some Contraints",
    OFFERING_DOCUMENT_TYPE: new web3.BigNumber(1),
    OFFERING_DOCUMENT_SUB_TYPE: new web3.BigNumber(1),
    JURISDICTION: "de",
    ASSET_TYPE: new web3.BigNumber(0),
  },
];

// this will be populated in migration step 12 and then can be used when deploying mock ETOs
export const deployedAddresses = [];
