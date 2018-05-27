import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { divRound } from "./helpers/unitConverter";
import { deployUniverse, deployPlatformTerms } from "./helpers/deployContracts";

const Q18 = web3.toBigNumber("10").pow(18);

contract("PlatformTerms", ([_, admin]) => {
  let platformTerms;
  let defaultTerms;
  let termsKeys;

  beforeEach(async () => {
    const [universe] = await deployUniverse(admin, admin);
    [platformTerms, defaultTerms, termsKeys] = await deployPlatformTerms(universe, admin);
  });

  it("should deploy", async () => {
    await prettyPrintGasCost("PlatformTerms deploy", platformTerms);
  });

  async function verifyTerms(c, keys, dict) {
    for (const f of keys) {
      const rv = await c[f]();
      if (rv instanceof Object) {
        expect(rv, f).to.be.bignumber.eq(dict[f]);
      } else {
        expect(rv, f).to.eq(dict[f]);
      }
    }
  }

  it("should have all the constants", async () => {
    await verifyTerms(platformTerms, termsKeys, defaultTerms);
  });

  it("should calculate platform fee correctly", async () => {
    const amount = Q18.mul(1928.818172);
    const feeAmount = await platformTerms.calculatePlatformFee(amount);
    const fee = defaultTerms.PLATFORM_FEE_FRACTION;
    expect(feeAmount).to.be.bignumber.eq(divRound(amount.mul(fee), Q18));
  });

  it("should calculate platform token fee correctly", async () => {
    // tokens have 0 precision
    const amountInt = new web3.BigNumber("7128918927");
    const feeAmount = await platformTerms.calculatePlatformTokenFee(amountInt);
    const fee = defaultTerms.TOKEN_PARTICIPATION_FEE_FRACTION;
    expect(feeAmount).to.be.bignumber.eq(amountInt.mul(fee.div(Q18)).round(0, 4));
  });

  it("should calculate neumark share");
});
