import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployEtherTokenUniverse,
  deployFeeDisbursalUniverse,
  deployNeumarkUniverse,
  deployEuroTokenUniverse,
} from "./helpers/deployContracts";
import { TriState, GLOBAL } from "./helpers/triState";
import roles from "./helpers/roles";
import { toBytes32, Q18 } from "./helpers/constants";
import { identityClaims } from "./helpers/identityClaims";
import increaseTime from "./helpers/increaseTime";
import { knownInterfaces } from "./helpers/knownInterfaces";

const EtherToken = artifacts.require("EtherToken");
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
    let euroToken;
    let euroTokenController;

    /**
     * Setup
     */
    beforeEach(async () => {
      identityRegistry = await deployIdentityRegistry(universe, masterManager, masterManager);
      etherToken = await deployEtherTokenUniverse(universe, masterManager);
      [euroToken, euroTokenController] = await deployEuroTokenUniverse(
        universe,
        masterManager,
        masterManager,
        masterManager,
        Q18,
        Q18,
        Q18,
      );
      neumark = await deployNeumarkUniverse(universe, masterManager);

      [feeDisbursal, feeDisbursalController] = await deployFeeDisbursalUniverse(
        universe,
        masterManager,
      );

      // set policy for the disburser
      accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
      await accessPolicy.setUserRole(disburser, roles.disburser, GLOBAL, TriState.Allow);

      // add verified claim for disburser, so he can receive eurotokens
      await identityRegistry.setClaims(
        disburser,
        toBytes32(identityClaims.isNone),
        toBytes32(identityClaims.isVerified),
        { from: masterManager },
      );

      // apply eurotoken controller settings again to update allowed receivers and senders
      await euroTokenController.applySettings(Q18, Q18, Q18, { from: masterManager });
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

    // disburse some ethertokens from the given disburser
    async function disburseEtherToken(sender, amount) {
      return etherToken.depositAndTransfer(feeDisbursal.address, amount, 0, {
        from: sender,
        value: amount,
      });
    }

    async function disburseEuroToken(sender, amount) {
      return euroToken.depositAndTransfer(sender, feeDisbursal.address, amount, amount, 0, 0, {
        from: masterManager,
      });
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
      await assertDisbursalCount(euroToken, 0);

      // disburse some ether tokens from the disburser
      await disburseEtherToken(disburser, Q18.mul(100));
      await disburseEuroToken(disburser, Q18.mul(50));
      // there now should be the full amount of ethertokens as well as the count of disbursals for this token here
      await assertTokenBalance(etherToken, feeDisbursal.address, Q18.mul(100));
      await assertDisbursalCount(etherToken, 1);
      await assertTokenBalance(euroToken, feeDisbursal.address, Q18.mul(50));
      await assertDisbursalCount(euroToken, 1);

      increaseTime(60 * 60 * 24);

      // now the investors should have some claimable fee on this token
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(20));
      await assertClaimable(etherToken, investors[1], 1000, Q18.mul(30));
      await assertClaimable(etherToken, investors[2], 1000, Q18.mul(50));
      await assertClaimable(euroToken, investors[0], 1000, Q18.mul(10));
      await assertClaimable(euroToken, investors[1], 1000, Q18.mul(15));
      await assertClaimable(euroToken, investors[2], 1000, Q18.mul(25));

      // disburse some more ether
      await disburseEtherToken(disburser, Q18.mul(150));
      await disburseEtherToken(disburser, Q18.mul(250));
      await disburseEuroToken(disburser, Q18.mul(200));
      // the last two disbursals should have been merged, so we now have 2 disbursals in total
      await assertDisbursalCount(etherToken, 2);
      await assertDisbursalCount(euroToken, 2);

      increaseTime(60 * 60 * 24);

      // now the investors should have some claimable fee on this token
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(100));
      await assertClaimable(etherToken, investors[1], 1000, Q18.mul(150));
      await assertClaimable(etherToken, investors[2], 1000, Q18.mul(250));
      await assertClaimable(euroToken, investors[0], 1000, Q18.mul(50));
      await assertClaimable(euroToken, investors[1], 1000, Q18.mul(75));
      await assertClaimable(euroToken, investors[2], 1000, Q18.mul(125));

      // claim first and check claimable balances
      await feeDisbursal.claim(etherToken.address, Q18, { from: investors[0] });
      await feeDisbursal.claim(euroToken.address, Q18, { from: investors[1] });
      await assertClaimable(etherToken, investors[0], 1000, 0);
      await assertClaimable(etherToken, investors[1], 1000, Q18.mul(150));
      await assertClaimable(etherToken, investors[2], 1000, Q18.mul(250));
      await assertClaimable(euroToken, investors[0], 1000, Q18.mul(50));
      await assertClaimable(euroToken, investors[1], 1000, Q18.mul(0));
      await assertClaimable(euroToken, investors[2], 1000, Q18.mul(125));

      // claim the rest
      await feeDisbursal.claim(etherToken.address, Q18, { from: investors[1] });
      await feeDisbursal.claim(etherToken.address, Q18, { from: investors[2] });
      await feeDisbursal.claim(euroToken.address, Q18, { from: investors[0] });
      await feeDisbursal.claim(euroToken.address, Q18, { from: investors[2] });

      await assertClaimable(etherToken, investors[1], 1000, 0);
      await assertClaimable(etherToken, investors[2], 1000, 0);
      await assertClaimable(euroToken, investors[1], 1000, 0);
      await assertClaimable(euroToken, investors[2], 1000, 0);

      // assert token balances after payout
      await assertTokenBalance(etherToken, investors[0], Q18.mul(100));
      await assertTokenBalance(etherToken, investors[1], Q18.mul(150));
      await assertTokenBalance(etherToken, investors[2], Q18.mul(250));
      await assertTokenBalance(euroToken, investors[0], Q18.mul(50));
      await assertTokenBalance(euroToken, investors[1], Q18.mul(75));
      await assertTokenBalance(euroToken, investors[2], Q18.mul(125));

      // all ether is payed out now
      await assertTokenBalance(etherToken, feeDisbursal.address, Q18.mul(0));
      await assertTokenBalance(euroToken, feeDisbursal.address, Q18.mul(0));
    });

    it("should support simple claims merging and step by step claim payout", async () => {
      // setup one investor and run some assertions
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await assertDisbursalCount(etherToken, 0);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(0));

      // first disbursal
      await disburseEtherToken(disburser, Q18.mul(15));
      // we now have one disbursal, but nothing claimable, as the claim is not sealed yet
      await assertDisbursalCount(etherToken, 1);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(0));
      // second disbursal, should be merged with first
      await disburseEtherToken(disburser, Q18.mul(5));
      await assertDisbursalCount(etherToken, 1);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(0));
      // after one day these funds become claimable
      increaseTime(60 * 60 * 24);
      await assertDisbursalCount(etherToken, 1);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(20));
      // some more disbursing
      await disburseEtherToken(disburser, Q18.mul(5));
      await disburseEtherToken(disburser, Q18.mul(5));
      // both should now be merged, but not claimable yet
      await assertDisbursalCount(etherToken, 2);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(20));
      increaseTime(60 * 60 * 24);
      // claimable now
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(30));
      // add another day with disbursal
      await disburseEtherToken(disburser, Q18.mul(20));
      increaseTime(60 * 60 * 24);
      await assertDisbursalCount(etherToken, 3);
      await assertClaimable(etherToken, investors[0], 1000, Q18.mul(50));
      // now check that we can granularly get the claimable values
      await assertClaimable(etherToken, investors[0], 1, Q18.mul(20)); // first claim
      await assertClaimable(etherToken, investors[0], 2, Q18.mul(30)); // first two claims
      await assertClaimable(etherToken, investors[0], 3, Q18.mul(50)); // first three claims
      // now claim the three disbursals invidually
      await feeDisbursal.claim(etherToken.address, 1, { from: investors[0] });
      await assertTokenBalance(etherToken, investors[0], Q18.mul(20));
      await assertClaimable(etherToken, investors[0], Q18, Q18.mul(30)); // now only 2nd and 3rd claims left
      await feeDisbursal.claim(etherToken.address, 2, { from: investors[0] });
      await assertTokenBalance(etherToken, investors[0], Q18.mul(30));
      await assertClaimable(etherToken, investors[0], Q18, Q18.mul(20)); // now only 3rd claim left
      await feeDisbursal.claim(etherToken.address, 3, { from: investors[0] });
      await assertTokenBalance(etherToken, investors[0], Q18.mul(50));
      await assertClaimable(etherToken, investors[0], Q18, Q18.mul(0)); // no claims left
    });

    /**
     * Access control checks
     */
    it("should only allow valid disbursers", async () => {
      // we need at least one investor
      await prepareInvestor(investors[0], Q18.mul(200), true);
      const testDisburser = investors[1];
      // without role or being eto commitment, this won't work
      await expect(disburseEtherToken(testDisburser, Q18.mul(1))).to.revert;

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

    it("should not disburse if the totalsupply of pro rata token is zero", async () => {
      // neu neumarks minted yet
      await expect(
        etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
          from: disburser,
          value: Q18.mul(100),
        }),
      ).to.revert;
      // mint neumarks for investor 0
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // now it will work
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: disburser,
        value: Q18.mul(100),
      });
    });

    it("should not accept disbursing an unknown token", async () => {
      // we need at least one investor
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // create a second ether token where the disburser has a balance of 20
      const newEtherToken = await EtherToken.new(accessPolicy.address);
      // transfering is now allowed, @TODO: should we use a revertcode here?
      await expect(
        newEtherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
          from: disburser,
          value: Q18.mul(100),
        }),
      ).to.revert;
      // ether token works
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: disburser,
        value: Q18.mul(100),
      });
    });

    it("should not accept claiming with no identity claims or locked account", async () => {
      // create investor with neumark but no claims
      await prepareInvestor(investors[0], Q18.mul(200), false);
      // disburse some ether tokens from the disburser
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(100), 0, {
        from: disburser,
        value: Q18.mul(100),
      });
      increaseTime(60 * 60 * 24);
      // claim will revert
      await expect(feeDisbursal.claim(etherToken.address, Q18, { from: investors[0] })).to.revert;
      // add verified bit
      await identityRegistry.setClaims(
        investors[0],
        toBytes32(identityClaims.isNone),
        toBytes32(identityClaims.isVerified),
        { from: masterManager },
      );
      // now claiming should work
      await feeDisbursal.claim(etherToken.address, Q18, { from: investors[0] });
      // disburse more
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(100), 0, {
        from: disburser,
        value: Q18.mul(100),
      });
      increaseTime(60 * 60 * 24);
      // set account locked bit
      await identityRegistry.setClaims(
        investors[0],
        toBytes32(identityClaims.isVerified),
        toBytes32(identityClaims.isVerified | identityClaims.isAccountFrozen),
        { from: masterManager },
      );
      // now will revert again
      await expect(feeDisbursal.claim(etherToken.address, Q18, { from: investors[0] })).to.revert;
    });
  });
});
