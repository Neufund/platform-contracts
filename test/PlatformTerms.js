import {expect} from "chai";
import {prettyPrintGasCost} from "./helpers/gasUtils";
import {divRound} from "./helpers/unitConverter";

const PlatformTerms = artifacts.require("PlatformTerms");

const Q18 = web3.toBigNumber("10").pow(18);
const days = sec => sec * 60 * 60 * 24;
const constantsExpectations = [
  ["PLATFORM_FEE_FRACTION", Q18.mul(0.03)],
  ["TOKEN_PARTICIPATION_FEE_FRACTION", Q18.mul(0.02)],
  ["MIN_OFFER_DURATION_DAYS", days(1)],
  ["MAX_OFFER_DURATION_DAYS", days(90)],
  ["MIN_TICKET_EUR_ULPS", Q18.mul(300)],
  // todo: fill remaining contants to be tested below
];

contract("PlatformTerms", ([_]) => {
  let platformTerms;

  before(async () => {
    platformTerms = await PlatformTerms.new();
  });

  it("should deploy", async () => {
    await prettyPrintGasCost("PlatformTerms deploy", platformTerms);
  });

  it("should have all the constants", async () => {
    for (let ii = 0; ii < constantsExpectations.length; ii += 1) {
      // console.log(constantsExpectations[ii][0]);
      const c = await platformTerms[constantsExpectations[ii][0]]();
      expect(c).to.be.bignumber.eq(constantsExpectations[ii][1]);
    }
  });

  it("should calculate platform fee correctly", async () => {
    const amount = Q18.mul(1928.818172);
    const feeAmount = await platformTerms.calculatePlatformFee(amount);
    const fee = await platformTerms.PLATFORM_FEE_FRACTION();
    expect(feeAmount).to.be.bignumber.eq(divRound(amount.mul(fee), Q18));
  });

  it("should calculate platform token fee correctly", async () => {
    // tokens have 0 precision
    const amountInt = new web3.BigNumber("7128918927");
    const feeAmount = await platformTerms.calculatePlatformTokenFee(amountInt);
    const fee = await platformTerms.TOKEN_PARTICIPATION_FEE_FRACTION();
    expect(feeAmount).to.be.bignumber.eq(amountInt.mul(fee.div(Q18)).round(0, 4));
  });

  it("should calculate neumark share");
});
