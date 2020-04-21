const Web3 = require("web3");

export const web3 = new Web3();
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const decimalBase = new web3.BigNumber("10");
export const ZERO_BN = new web3.BigNumber("0");
export const Q18 = decimalBase.pow(18);
export const hourInSeconds = 60 * 60;
export const dayInSeconds = 24 * hourInSeconds;
export const monthInSeconds = 30 * dayInSeconds;
export const daysToSeconds = sec => sec * dayInSeconds;
export const hoursToSeconds = sec => sec * hourInSeconds;
// default scale and power of equity token as used by fixtures and default test terms
// allow to override from env variable to run ETO tests several scales
export const defEquityTokenDecimals = new web3.BigNumber(process.env.EQUITY_TOKEN_DECIMALS || "18");
export const defEquityTokenPower = decimalBase.pow(defEquityTokenDecimals);
// default tokens per share used as above
export const defaultTokensPerShare = defEquityTokenPower.mul(new web3.BigNumber("1000000"));
