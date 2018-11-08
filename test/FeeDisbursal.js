import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployEtherTokenUniverse,
  deployFeeDisbursalUniverse,
  deployNeumarkUniverse,
} from "./helpers/deployContracts";
import { TriState, GLOBAL } from "./helpers/triState";
import roles from "./helpers/roles";
import { toBytes32, Q18 } from "./helpers/constants";
import { identityClaims } from "./helpers/identityClaims";
import increaseTime from "./helpers/increaseTime";
import { knownInterfaces } from "./helpers/knownInterfaces";

const RoleBasedAccessPolicy = artifacts.require("RoleBasedAccessPolicy");

contract("FeeDisbursal", ([_, masterManager, disburser, ...investors]) => {
  let universe;

  before(async () => {
    [universe] = await deployUniverse(masterManager, masterManager);
  });

  describe("specific tests", () => {
    let feeDisbursal;
    let feeDisbursalController;
    let etherToken;
    let identityRegistry;
    let neumark;
    let accessPolicy;

    /**
     * Setup
     */
    beforeEach(async () => {
      identityRegistry = await deployIdentityRegistry(universe, masterManager, masterManager);
      etherToken = await deployEtherTokenUniverse(universe, masterManager);
      [feeDisbursal, feeDisbursalController] = await deployFeeDisbursalUniverse(
        universe,
        masterManager,
      );
      neumark = await deployNeumarkUniverse(universe, masterManager);

      // set policy for the disburser
      accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
      await accessPolicy.setUserRole(disburser, roles.disburser, GLOBAL, TriState.Allow);
    });

    /**
     * Helpers
     */
    // send some neumarks to an investor and verify claims
    async function prepareInvestor(investor, neumarks, isVerified) {
      await neumark.issueForEuro(neumarks, { from: masterManager });
      await neumark.distribute(investor, neumarks, { from: masterManager });
      const balance = await neumark.balanceOf(masterManager);
      await neumark.burn.uint256(balance, { from: masterManager });
      if (isVerified) {
        await identityRegistry.setClaims(
          investor,
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          { from: masterManager },
        );
      }
    }

    /**
     * Assertion helpers
     */
    async function assertClaimable(token, investor, index, expectedAmount) {
      const [claimableAmount] = await feeDisbursal.claimable(token.address, investor, index);
      expect(claimableAmount).to.be.bignumber.equal(expectedAmount);
    }

    async function assertTokenBalance(token, investor, expectedAmount) {
      const balance = await token.balanceOf(investor);
      expect(balance).to.be.bignumber.equal(expectedAmount);
    }

    async function assertDisbursalCount(token, expectedCount) {
      const count = await feeDisbursal.getDisbursalCount(token.address);
      expect(count).to.be.bignumber.equal(expectedCount);
    }

    /**
     * Tests
     */
    it("should deploy", async () => {
      await prettyPrintGasCost("FeeDisbursal deploy", feeDisbursal);
      await prettyPrintGasCost("FeeDisbursalController deploy", feeDisbursalController);
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

    // happy path
    it("should disburse tokens to investors", async () => {
      // prepare some investors
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await prepareInvestor(investors[1], Q18.mul(300), true);
      await prepareInvestor(investors[2], Q18.mul(500), true);
      await assertDisbursalCount(etherToken, 0);

      // disburse some ether tokens from the disburser
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(100), 0, {
        from: disburser,
        value: Q18.mul(100),
      });
      // there now should be the full amount of ethertokens as well as the count of disbursals for this token here
      await assertTokenBalance(etherToken, feeDisbursal.address, Q18.mul(100));
      await assertDisbursalCount(etherToken, 1);

      increaseTime(60 * 60 * 24);

      // now the investors should have some claimable fee on this token
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(20));
      await assertClaimable(etherToken, investors[1], 1000, Q18.mul(30));
      await assertClaimable(etherToken, investors[2], 1000, Q18.mul(50));

      // disburse some more ether
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(150), 0, {
        from: disburser,
        value: Q18.mul(150),
      });
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(250), 0, {
        from: disburser,
        value: Q18.mul(250),
      });
      // the last two disbursals should have been merged, so we now have 2 disbursals in total
      await assertDisbursalCount(etherToken, 2);

      increaseTime(60 * 60 * 24);

      // now the investors should have some claimable fee on this token
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(100));
      await assertClaimable(etherToken, investors[1], 1000, Q18.mul(150));
      await assertClaimable(etherToken, investors[2], 1000, Q18.mul(250));

      // claim first and check claimable balances
      await feeDisbursal.claim(etherToken.address, Q18, { from: investors[0] });
      await assertClaimable(etherToken, investors[0], 1000, 0);
      await assertClaimable(etherToken, investors[1], 1000, Q18.mul(150));
      await assertClaimable(etherToken, investors[2], 1000, Q18.mul(250));

      // claim the rest
      await feeDisbursal.claim(etherToken.address, Q18, { from: investors[1] });
      await feeDisbursal.claim(etherToken.address, Q18, { from: investors[2] });
      await assertClaimable(etherToken, investors[1], 1000, 0);
      await assertClaimable(etherToken, investors[2], 1000, 0);

      // assert token balances after payout
      await assertTokenBalance(etherToken, investors[0], Q18.mul(100));
      await assertTokenBalance(etherToken, investors[1], Q18.mul(150));
      await assertTokenBalance(etherToken, investors[2], Q18.mul(250));

      // all ether is payed out now
      await assertTokenBalance(etherToken, feeDisbursal.address, Q18.mul(0));
    });

    /**
     * Access control checks
     */
    it("should only allow valid disbursers", async () => {
      // we need at least one investor
      await prepareInvestor(investors[0], Q18.mul(200), true);
      const testDisburser = investors[1];
      // without role or being eto commitment, this won't work
      await expect(
        etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
          from: testDisburser,
          value: Q18.mul(100),
        }),
      ).to.revert;
      // eto commitment interface will work
      await universe.setCollectionInterface(
        knownInterfaces.commitmentInterface,
        testDisburser,
        true,
        {
          from: masterManager,
        },
      );
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: testDisburser,
        value: Q18.mul(100),
      });
      increaseTime(60 * 60 * 24);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(1));
      // reset, should not work anymore
      await universe.setCollectionInterface(
        knownInterfaces.commitmentInterface,
        testDisburser,
        false,
        {
          from: masterManager,
        },
      );
      await expect(
        etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
          from: testDisburser,
          value: Q18.mul(100),
        }),
      ).to.revert;
      // token controller will work
      await universe.setCollectionInterface(
        knownInterfaces.equityTokenControllerInterface,
        testDisburser,
        true,
        {
          from: masterManager,
        },
      );
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: testDisburser,
        value: Q18.mul(100),
      });
      increaseTime(60 * 60 * 24);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(2));
      // reset, should not work anymore
      await universe.setCollectionInterface(
        knownInterfaces.equityTokenControllerInterface,
        testDisburser,
        false,
        {
          from: masterManager,
        },
      );
      await expect(
        etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
          from: testDisburser,
          value: Q18.mul(100),
        }),
      ).to.revert;
      // disburser role will work
      await accessPolicy.setUserRole(testDisburser, roles.disburser, GLOBAL, TriState.Allow);
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: testDisburser,
        value: Q18.mul(100),
      });
      increaseTime(60 * 60 * 24);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(3));
      // qed :)
    });
  });
});
