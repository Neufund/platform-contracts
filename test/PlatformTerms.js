import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { divRound, etherToWei } from "./helpers/unitConverter";
import { deployUniverse, deployPlatformTerms } from "./helpers/deployContracts";
import { contractId, Q18 } from "./helpers/constants";

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
    expect((await platformTerms.contractId())[0]).to.eq(contractId("PlatformTerms"));
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

  it("should calculate neumark share when reward is 0 wei", async () => {
    const reward = 0;
    const [platformShares, shares] = await platformTerms.calculateNeumarkDistribution(reward);

    expect(shares.plus(platformShares)).to.be.bignumber.eq(reward);
    expect(shares).to.be.bignumber.eq(0);
    expect(platformShares).to.be.bignumber.eq(0);
  });
  it("should calculate neumark share when reward is 1 wei", async () => {
    const reward = 1;
    const [platformShares, shares] = await platformTerms.calculateNeumarkDistribution(1);

    expect(shares.plus(platformShares)).to.be.bignumber.eq(reward);
    expect(shares).to.be.bignumber.eq(1);
    expect(platformShares).to.be.bignumber.eq(0);
  });

  it("should calculate neumark share when reward is 1 ether", async () => {
    const reward = etherToWei(1);
    const [platformShares, shares] = await platformTerms.calculateNeumarkDistribution(reward);

    expect(shares.plus(platformShares)).to.be.bignumber.eq(reward);
    expect(shares).to.be.bignumber.eq(etherToWei(0.5));
    expect(platformShares).to.be.bignumber.eq(etherToWei(0.5));
  });

  it("should calculate neumark share when reward is undevisible", async () => {
    const reward = etherToWei(1).plus(1);
    const [platformShares, shares] = await platformTerms.calculateNeumarkDistribution(reward);

    expect(shares.plus(platformShares)).to.be.bignumber.eq(reward);
    expect(shares)
      .to.be.bignumber.eq(etherToWei(0.5).plus(1))
      .gt(platformShares);
    expect(platformShares).to.be.bignumber.eq(etherToWei(0.5));
  });

  const upTo40DecimalPlacesList = [...Array(41).keys()];
  const BigNumber = web3.BigNumber;
  upTo40DecimalPlacesList.forEach(decimalPlaces => {
    it(`should set distribution when reward has ${decimalPlaces} decimals`, async () => {
      BigNumber.config({ DECIMAL_PLACES: decimalPlaces });
      const randomReward = BigNumber.random().times(new BigNumber(10).pow(decimalPlaces));

      const [platformShares, shares] = await platformTerms.calculateNeumarkDistribution(
        randomReward,
      );

      expect(shares.plus(platformShares)).to.be.bignumber.eq(randomReward);
      expect(shares).to.be.bignumber.gte(platformShares);
      expect(platformShares).to.be.bignumber.lte(shares);
    });
  });
});
