import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployEtherTokenUniverse,
  deployFeeDisbursal,
} from "./helpers/deployContracts";

contract("FeeDisbursal", ([_, masterManager, ...investors]) => {
  let universe;

  before(async () => {
    [universe] = await deployUniverse(masterManager, masterManager);
  });

  describe("specific tests", () => {
    let feeDisbursal;
    let etherToken;

    beforeEach(async () => {
      await deployIdentityRegistry(universe, masterManager, masterManager);
      etherToken = await deployEtherTokenUniverse(universe, masterManager);
      feeDisbursal = await deployFeeDisbursal(universe, masterManager);
    });

    it("should deploy", async () => {
      await prettyPrintGasCost("FeeDisbursal deploy", feeDisbursal);
    });

    it("should have zero claimable ether tokens for random address", async () => {
      let [claimableAmount, lastIndex] = await feeDisbursal.claimable(
        etherToken.address,
        investors[0],
        1000,
      );
      expect(claimableAmount.toNumber()).to.be.equal(0);
      expect(lastIndex.toNumber()).to.be.equal(0);
      [claimableAmount, lastIndex] = await feeDisbursal.claimable(
        etherToken.address,
        investors[1],
        1000,
      );
      expect(claimableAmount.toNumber()).to.be.equal(0);
      expect(lastIndex.toNumber()).to.be.equal(0);
    });
  });
});
