import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployEtherTokenUniverse,
  deployFeeDisbursalUniverse,
  deployNeumarkUniverse,
  deployEuroTokenUniverse,
  deployPlatformTerms,
} from "./helpers/deployContracts";
import { TriState, GLOBAL } from "./helpers/triState";
import roles from "./helpers/roles";
import { toBytes32, Q18 } from "./helpers/constants";
import { identityClaims } from "./helpers/identityClaims";
import increaseTime from "./helpers/increaseTime";
import { latestTimestamp } from "./helpers/latestTime";
import { knownInterfaces } from "./helpers/knownInterfaces";
import EvmError from "./helpers/EVMThrow";
import { decodeLogs, eventValue } from "./helpers/events";

const FeeDisbursalController = artifacts.require("FeeDisbursalController");
const EtherToken = artifacts.require("EtherToken");

const maxUInt256 = new web3.BigNumber(2).pow(256).sub(1);

contract("FeeDisbursal", ([_, masterManager, disburser, disburser2, ...investors]) => {
  let universe;
  let platformTermsDict;

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
      [universe, accessPolicy] = await deployUniverse(masterManager, masterManager);
      [, platformTermsDict] = await deployPlatformTerms(universe, masterManager);
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
      await accessPolicy.setUserRole(disburser, roles.disburser, GLOBAL, TriState.Allow);
      await accessPolicy.setUserRole(disburser2, roles.disburser, GLOBAL, TriState.Allow);

      // let masterManager to increase snapshots on neumark
      await accessPolicy.setUserRole(
        masterManager,
        roles.snapshotCreator,
        neumark.address,
        TriState.Allow,
      );

      // add verified claim for disburser, so he can receive eurotokens
      await identityRegistry.setClaims(
        disburser,
        toBytes32(identityClaims.isNone),
        toBytes32(identityClaims.isVerified),
        { from: masterManager },
      );
      await identityRegistry.setClaims(
        disburser2,
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
      // burn all the excess neumarks
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

    // advance to next snaphotId
    async function advanceSnapshotId(token) {
      // instead of shifting one day we can increase snapshot directly on NEU
      // this does not work on equity tokens which are purely Daily
      await token.createSnapshot({ from: masterManager });
    }

    // get recycle deadline from current block timestamp
    async function recycleAfterFromNow() {
      const now = await latestTimestamp();
      return platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION + now;
    }

    // disburse some ethertokens from the given disburser
    async function disburseEtherToken(sender, amount) {
      // console.log("disburseEtherToken");
      const tx = await etherToken.depositAndTransfer(feeDisbursal.address, amount, 0, {
        from: sender,
        value: amount,
      });
      tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
      expectLogDisbursalCreated(tx, neumark.address, etherToken.address, amount, sender);
    }

    async function disburseEuroToken(sender, amount) {
      const tx = await euroToken.depositAndTransfer(
        sender,
        feeDisbursal.address,
        amount,
        amount,
        0,
        0,
        {
          from: masterManager,
        },
      );
      tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
      expectLogDisbursalCreated(tx, neumark.address, euroToken.address, amount, sender);
    }

    async function disburseNeumark(sender, amount) {
      await neumark.issueForEuro(amount, { from: masterManager });
      await neumark.distribute(sender, amount, { from: masterManager });
      const tx = await neumark.transfer["address,uint256,bytes"](feeDisbursal.address, amount, 0, {
        from: sender,
      });
      tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
      expectLogDisbursalCreated(tx, neumark.address, neumark.address, amount, sender);
      // burn all the excess neumarks
      const balance = await neumark.balanceOf(masterManager);
      await neumark.burn.uint256(balance, { from: masterManager });
    }

    /**
     * Assertion helpers
     */
    function expectLogDisbursalCreated(tx, proRataToken, token, amount, disburserAddr, recycleDur) {
      const event = eventValue(tx, "LogDisbursalCreated");
      expect(event).to.exist;
      expect(event.args.proRataToken).to.eq(proRataToken);
      expect(event.args.token).to.eq(token);
      expect(event.args.amount).to.be.bignumber.eq(amount);
      expect(event.args.recycleAfterDuration).to.be.bignumber.eq(
        recycleDur || platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
      );
      expect(event.args.disburser).to.eq(disburserAddr);
    }

    function expectLogDisbursalAccepted(tx, claimer, token, proRataToken, amount, nextIndex) {
      const event = eventValue(tx, "LogDisbursalAccepted");
      expect(event).to.exist;
      expect(event.args.claimer).to.eq(claimer);
      expect(event.args.token).to.eq(token);
      expect(event.args.proRataToken).to.eq(proRataToken);
      expect(event.args.amount).to.be.bignumber.eq(amount);
      expect(event.args.nextIndex).to.be.bignumber.eq(nextIndex);
    }

    function expectLogDisbursalRejected(tx, claimer, token, proRataToken, amount, nextIndex) {
      const event = eventValue(tx, "LogDisbursalRejected");
      expect(event).to.exist;
      expect(event.args.claimer).to.eq(claimer);
      expect(event.args.token).to.eq(token);
      expect(event.args.proRataToken).to.eq(proRataToken);
      expect(event.args.amount).to.be.bignumber.eq(amount);
      expect(event.args.nextIndex).to.be.bignumber.eq(nextIndex);
    }

    function expectedLogFundsRecycled(tx, proRataToken, token, amount, by) {
      const event = eventValue(tx, "LogFundsRecycled");
      expect(event).to.exist;
      expect(event.args.proRataToken).to.eq(proRataToken);
      expect(event.args.token).to.eq(token);
      expect(event.args.amount).to.be.bignumber.eq(amount);
      expect(event.args.by).to.eq(by);
    }

    function expectedLogChangeFeeDisbursalController(tx, oldController, newController, by) {
      const event = eventValue(tx, "LogChangeFeeDisbursalController");
      expect(event).to.exist;
      expect(event.args.oldController).to.eq(oldController);
      expect(event.args.newController).to.eq(newController);
      expect(event.args.by).to.eq(by);
    }

    async function assertClaimable(
      token,
      proRataToken,
      investor,
      index,
      expectedAmount,
      expectedTotalAmount,
      expectedRecyclableAfter,
      expectedFirstIndex,
    ) {
      const [
        claimableAmount,
        totalAmount,
        recyclableAfter,
        firstIndex,
      ] = await feeDisbursal.claimable(token.address, proRataToken.address, investor, index);
      expect(claimableAmount).to.be.bignumber.eq(expectedAmount);
      expect(totalAmount).to.be.bignumber.eq(expectedTotalAmount);
      if (expectedRecyclableAfter) {
        expect(recyclableAfter.sub(expectedRecyclableAfter).abs()).to.be.bignumber.lt(10);
      }
      if (expectedFirstIndex) {
        expect(firstIndex).to.be.bignumber.eq(expectedFirstIndex);
      }
      return [claimableAmount, totalAmount, recyclableAfter, firstIndex];
    }

    async function assertRecycleable(token, proRataToken, investor, index, expectedAmount) {
      const recycleableAmount = await feeDisbursal.recycleable(
        token.address,
        proRataToken.address,
        investor,
        index,
      );
      expect(recycleableAmount).to.be.bignumber.equal(expectedAmount);
    }

    async function assertTokenBalance(token, investor, expectedAmount) {
      const balance = await token.balanceOf(investor);
      expect(balance).to.be.bignumber.equal(expectedAmount);
    }

    async function assertDisbursalCount(token, proRataToken, expectedCount) {
      const count = await feeDisbursal.getDisbursalCount(token.address, proRataToken.address);
      expect(count).to.be.bignumber.equal(expectedCount);
    }

    /**
     * Tests
     */
    it("should deploy", async () => {
      await prettyPrintGasCost("FeeDisbursal deploy", feeDisbursal);
      await prettyPrintGasCost("FeeDisbursalController deploy", feeDisbursalController);
      expect(await feeDisbursal.feeDisbursalController()).to.eq(feeDisbursalController.address);
    });

    it("should have zero claimable ether tokens for random address", async () => {
      const [
        claimableAmount,
        totalAmount,
        recycleTimestamp,
        lastIndex,
      ] = await feeDisbursal.claimable(
        etherToken.address,
        neumark.address,
        investors[0],
        maxUInt256,
      );
      expect(claimableAmount).to.be.bignumber.eq(0);
      expect(totalAmount).to.be.bignumber.eq(0);
      expect(recycleTimestamp).to.be.bignumber.eq(0);
      expect(lastIndex).to.be.bignumber.eq(0);
      const [claimableAmount2] = await feeDisbursal.claimable(
        etherToken.address,
        neumark.address,
        investors[1],
        maxUInt256,
      );
      expect(claimableAmount2).to.be.bignumber.eq(0);
    });

    describe("test FeeDisbursalController", () => {
      it("should allow disbursable tokens", async () => {
        const disbursable = [etherToken.address, euroToken.address, neumark.address];
        for (const a of disbursable) {
          // console.log(a);
          // console.log(await universe.getInterfacesOfInstance(a));
          // console.log(await universe.isAnyOfInterfaceCollectionInstance([knownInterfaces.paymentTokenInterface], a));
          expect(await feeDisbursalController.isDisbursableToken(a)).to.be.true;
        }
        // cannot disburse unknown token
        expect(await feeDisbursalController.isDisbursableToken(investors[0])).to.be.false;
        // make it equity token
        await universe.setCollectionInterface(
          knownInterfaces.equityTokenInterface,
          investors[0],
          true,
          {
            from: masterManager,
          },
        );
        // equity tokens can be disbursed (downround)
        expect(await feeDisbursalController.isDisbursableToken(investors[0])).to.be.true;
      });

      it("should allow valid disbursers");

      it("should let change controller");

      it("should allow any pro rata token");

      it("should allow to accept and reject only for verified and not frozen accounts");

      it("should always allow recycle");
    });

    async function shouldDisburseToken(token, disbursef) {
      const amount = Q18.mul(100);
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await prepareInvestor(investors[1], Q18.mul(800), true);
      await disbursef(disburser, Q18.mul(100));
      await assertTokenBalance(token, feeDisbursal.address, amount);
      // current snapshot must be skipped
      await assertClaimable(token, neumark, investors[0], 0, 0, 0, 0);
      await advanceSnapshotId(neumark);
      // available now as disbursal snapshot is sealed
      const expectedRecycleAfter = await recycleAfterFromNow();
      await assertClaimable(
        token,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(20),
        amount,
        expectedRecycleAfter,
        0,
      );
      await assertClaimable(
        token,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(80),
        amount,
        expectedRecycleAfter,
        0,
      );
    }

    it("should be able to disburse ether tokens", async () => {
      await shouldDisburseToken(etherToken, disburseEtherToken);
    });

    it("should be able to disburse euro tokens", async () => {
      await shouldDisburseToken(euroToken, disburseEuroToken);
    });

    it("should be able to disburse neumark", async () => {
      // this example simulates downround
      await shouldDisburseToken(neumark, disburseNeumark);
    });

    // we sub balance of fee disbursal contract, check if values match
    it("should be able to downround with two disbursals in single snapshot");

    it("should be able to retrieve details of a disbursal", async () => {
      // we need at least one investor as always
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // create two entries for ethertoken
      await disburseEtherToken(disburser, Q18.mul(40));
      await disburseEtherToken(disburser2, Q18.mul(60));

      let [
        snapshotId,
        amount,
        recyclableAfterTimestamp,
        actualDisburser,
      ] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 0);
      expect(snapshotId).to.not.be.bignumber.eq(Q18.mul(0));
      // assertClaimable check value below exactly
      expect(recyclableAfterTimestamp).to.not.be.bignumber.eq(Q18.mul(0));
      expect(amount).to.be.bignumber.eq(Q18.mul(40));
      expect(actualDisburser).to.be.equal(disburser);

      [
        snapshotId,
        amount,
        recyclableAfterTimestamp,
        actualDisburser,
      ] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 1);
      expect(snapshotId).to.not.be.bignumber.eq(Q18.mul(0));
      expect(recyclableAfterTimestamp).to.not.be.bignumber.eq(Q18.mul(0));
      expect(amount).to.be.bignumber.eq(Q18.mul(60));
      expect(actualDisburser).to.be.equal(disburser2);

      // reverts on unknown index
      expect(
        await feeDisbursal.getDisbursalCount(etherToken.address, neumark.address),
      ).to.be.bignumber.eq(2);
      await expect(feeDisbursal.getDisbursal(etherToken.address, neumark.address, 2)).to.revert;
    });

    // happy path
    it("should disburse different tokens to investors, who then claim them", async () => {
      // prepare some investors
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await prepareInvestor(investors[1], Q18.mul(300), true);
      await prepareInvestor(investors[2], Q18.mul(500), true);
      await assertDisbursalCount(etherToken, neumark, 0);
      await assertDisbursalCount(euroToken, neumark, 0);

      // disburse some ether tokens from the disburser
      const initalEtherDisbursal = Q18.mul(100);
      await disburseEtherToken(disburser, initalEtherDisbursal);
      const initialEuroDisbursal = Q18.mul(50);
      await disburseEuroToken(disburser, initialEuroDisbursal);
      // there now should be the full amount of ethertokens as well as the count of disbursals for this token here
      await assertTokenBalance(etherToken, feeDisbursal.address, Q18.mul(100));
      await assertDisbursalCount(etherToken, neumark, 1);
      await assertTokenBalance(euroToken, feeDisbursal.address, Q18.mul(50));
      await assertDisbursalCount(euroToken, neumark, 1);

      let recycledAfter = await recycleAfterFromNow();
      await advanceSnapshotId(neumark);

      // now the investors should have some claimable fee on this token
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(20),
        initalEtherDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        etherToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(30),
        initalEtherDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        etherToken,
        neumark,
        investors[2],
        maxUInt256,
        Q18.mul(50),
        initalEtherDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        euroToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(10),
        initialEuroDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        euroToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(15),
        initialEuroDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        euroToken,
        neumark,
        investors[2],
        maxUInt256,
        Q18.mul(25),
        initialEuroDisbursal,
        recycledAfter,
        0,
      );

      // disburse some more ether
      await disburseEtherToken(disburser, Q18.mul(150));
      await disburseEtherToken(disburser, Q18.mul(250));
      const finalEtherDisbursal = initalEtherDisbursal.add(Q18.mul(150)).add(Q18.mul(250));
      await disburseEuroToken(disburser, Q18.mul(200));
      const finalEuroDisbursal = initialEuroDisbursal.add(Q18.mul(200));
      // the last two disbursals should have been merged, so we now have 2 disbursals in total
      await assertDisbursalCount(etherToken, neumark, 2);
      await assertDisbursalCount(euroToken, neumark, 2);

      recycledAfter = await recycleAfterFromNow();
      await advanceSnapshotId(neumark);

      // now the investors should have some claimable fee on this token
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(100),
        finalEtherDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        etherToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(150),
        finalEtherDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        etherToken,
        neumark,
        investors[2],
        maxUInt256,
        Q18.mul(250),
        finalEtherDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        euroToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(50),
        finalEuroDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        euroToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(75),
        finalEuroDisbursal,
        recycledAfter,
        0,
      );
      await assertClaimable(
        euroToken,
        neumark,
        investors[2],
        maxUInt256,
        Q18.mul(125),
        finalEuroDisbursal,
        recycledAfter,
        0,
      );

      // claim first and check claimable balances
      const acceptTx = await feeDisbursal.accept(etherToken.address, neumark.address, maxUInt256, {
        from: investors[0],
      });
      expectLogDisbursalAccepted(
        acceptTx,
        investors[0],
        etherToken.address,
        neumark.address,
        finalEtherDisbursal.mul(0.2), // this is investor 0 pro-rata
        2,
      );
      await feeDisbursal.accept(euroToken.address, neumark.address, maxUInt256, {
        from: investors[1],
      });
      // todo: add expectLogDisbursalAccepted in many more places
      await assertClaimable(etherToken, neumark, investors[0], maxUInt256, 0, 0, 0, 2);
      await assertClaimable(
        etherToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(150),
        finalEtherDisbursal,
      );
      await assertClaimable(
        etherToken,
        neumark,
        investors[2],
        maxUInt256,
        Q18.mul(250),
        finalEtherDisbursal,
      );
      await assertClaimable(
        euroToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(50),
        finalEuroDisbursal,
      );
      await assertClaimable(euroToken, neumark, investors[1], maxUInt256, Q18.mul(0), 0, 0, 0, 2);
      await assertClaimable(
        euroToken,
        neumark,
        investors[2],
        maxUInt256,
        Q18.mul(125),
        finalEuroDisbursal,
      );

      // claimable below first index should assert 0 even when pending disbursals exist
      await assertClaimable(etherToken, neumark, investors[1], 0, 0, 0, 0, 0);

      // claim the rest
      await feeDisbursal.accept(etherToken.address, neumark.address, maxUInt256, {
        from: investors[1],
      });
      await feeDisbursal.accept(etherToken.address, neumark.address, maxUInt256, {
        from: investors[2],
      });
      await feeDisbursal.accept(euroToken.address, neumark.address, maxUInt256, {
        from: investors[0],
      });
      await feeDisbursal.accept(euroToken.address, neumark.address, maxUInt256, {
        from: investors[2],
      });

      await assertClaimable(etherToken, neumark, investors[1], maxUInt256, 0, 0, 0, 2);
      await assertClaimable(etherToken, neumark, investors[2], maxUInt256, 0, 0);
      await assertClaimable(euroToken, neumark, investors[1], maxUInt256, 0, 0);
      await assertClaimable(euroToken, neumark, investors[2], maxUInt256, 0, 0);

      // claimable below first index should assert 0
      await assertClaimable(etherToken, neumark, investors[1], 1, 0, 0, 0, 0);

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

    it("should move disbursal index if nothing to claim", async () => {
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // investor without pro rata balance
      await prepareInvestor(investors[1], 0, true);
      // disburse some ether tokens from the disburser
      const initalEtherDisbursal = Q18.mul(100);
      await disburseEtherToken(disburser, initalEtherDisbursal);

      // const recycledAfter = await recycleAfterFromNow();
      await advanceSnapshotId(neumark);

      await feeDisbursal.accept(etherToken.address, neumark.address, maxUInt256, {
        from: investors[1],
      });
      // we were not able to claim anything but index is moved
      await assertClaimable(etherToken, neumark, investors[1], maxUInt256, 0, 0, 0, 1);
    });

    it("should disburse with changing balances and supply at snapshots");

    // change pro rata dist and supply before sealing snapshot
    it("should disburse with changing balances and supply at current snapshot");

    it("should merge disbursal spaced by many disbursers");

    it("should support simple claims merging and step by step claim payout", async () => {
      // setup one investor and run some assertions
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await assertDisbursalCount(etherToken, neumark, 0);
      await assertClaimable(etherToken, neumark, investors[0], maxUInt256, Q18.mul(0), 0);

      // first disbursal
      await disburseEtherToken(disburser, Q18.mul(15));
      // we now have one disbursal, but nothing claimable, as the claim is not sealed yet
      await assertDisbursalCount(etherToken, neumark, 1);
      await assertClaimable(etherToken, neumark, investors[0], maxUInt256, Q18.mul(0), 0);
      // second disbursal, should be merged with first
      await disburseEtherToken(disburser, Q18.mul(5));
      await assertDisbursalCount(etherToken, neumark, 1);
      await assertClaimable(etherToken, neumark, investors[0], maxUInt256, Q18.mul(0), 0);
      // after one day these funds become claimable
      const recycledAfter = await recycleAfterFromNow();
      await advanceSnapshotId(neumark);
      await assertDisbursalCount(etherToken, neumark, 1);
      const claimableData = await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(20),
        Q18.mul(20),
        recycledAfter,
        0,
      );
      // and move time by hour to check recycle deadlines later
      await increaseTime(60 * 60);
      // some more disbursing
      await disburseEtherToken(disburser, Q18.mul(5));
      await disburseEtherToken(disburser, Q18.mul(5));
      // both should now be merged, but not claimable yet
      await assertDisbursalCount(etherToken, neumark, 2);
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(20),
        Q18.mul(20),
      );

      await advanceSnapshotId(neumark);
      // claimable now
      const claimbaleData2 = await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(30),
        Q18.mul(30),
        claimableData[2],
        0,
      );
      // nothing was claimed so we should still see recycle deadline from the previous claim
      expect(claimbaleData2[2]).to.be.bignumber.eq(claimableData[2]);
      // add another day with disbursal
      await disburseEtherToken(disburser, Q18.mul(20));

      await advanceSnapshotId(neumark);
      await assertDisbursalCount(etherToken, neumark, 3);
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(50),
        Q18.mul(50),
        claimableData[2],
        0,
      );
      // now check that we can granularly get the claimable values (claim until indexes are non-inclusive)
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        1,
        Q18.mul(20),
        Q18.mul(20),
        claimableData[2],
        0,
      ); // first claim
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        2,
        Q18.mul(30),
        Q18.mul(30),
        claimableData[2],
        0,
      ); // first two claims
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        3,
        Q18.mul(50),
        Q18.mul(50),
        claimableData[2],
        0,
      ); // first three claims
      // now accept the three disbursals invidually
      await feeDisbursal.accept(etherToken.address, neumark.address, 1, { from: investors[0] });
      await assertTokenBalance(etherToken, investors[0], Q18.mul(20));
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(30),
        Q18.mul(30),
        claimableData[2].add(60 * 60),
        1,
      ); // now only 2nd and 3rd claims left
      await feeDisbursal.accept(etherToken.address, neumark.address, 2, { from: investors[0] });
      await assertTokenBalance(etherToken, investors[0], Q18.mul(30));
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(20),
        Q18.mul(20),
        claimableData[2].add(60 * 60),
        2,
      ); // now only 3rd claim left
      await feeDisbursal.accept(etherToken.address, neumark.address, 3, { from: investors[0] });
      await assertTokenBalance(etherToken, investors[0], Q18.mul(50));
      await assertClaimable(etherToken, neumark, investors[0], 4, Q18.mul(0), 0, 0, 3); // no claims left
    });

    it("should accept multiple disbursal tokens");

    it("should reject disbursal", async () => {
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await prepareInvestor(investors[1], Q18.mul(300), true);
      await prepareInvestor(investors[2], Q18.mul(500), true);
      await disburseEtherToken(disburser, Q18.mul(100));
      await advanceSnapshotId(neumark);
      await disburseEtherToken(disburser, Q18.mul(50));
      await advanceSnapshotId(neumark);
      const rejectTx = await feeDisbursal.reject(etherToken.address, neumark.address, 2, {
        from: investors[0],
      });
      expectLogDisbursalRejected(
        rejectTx,
        investors[0],
        etherToken.address,
        neumark.address,
        Q18.mul(150 * 0.2),
        2,
      );
      // todo: add more checks
    });

    it("should disburse fully with various roundings in pro rata calculations");

    /**
     * Access control checks
     */
    it("should only allow valid disbursers", async () => {
      // we need at least one investor
      await prepareInvestor(investors[0], Q18.mul(200), true);
      const testDisburser = investors[1];
      // without role or being eto commitment, this won't work
      await expect(disburseEtherToken(testDisburser, Q18.mul(1))).to.be.rejectedWith(
        "NF_DISBURSAL_REJECTED",
      );

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
      await advanceSnapshotId(neumark);
      await assertClaimable(etherToken, neumark, investors[0], maxUInt256, Q18.mul(1), Q18.mul(1));
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
      ).to.be.rejectedWith("NF_DISBURSAL_REJECTED");

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
        value: Q18.mul(1),
      });
      await advanceSnapshotId(neumark);
      await assertClaimable(etherToken, neumark, investors[0], maxUInt256, Q18.mul(2), Q18.mul(2));
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
          value: Q18.mul(1),
        }),
      ).to.be.rejectedWith("NF_DISBURSAL_REJECTED");
      // disburser role will work
      await accessPolicy.setUserRole(
        testDisburser,
        roles.disburser,
        feeDisbursal.address,
        TriState.Allow,
      );
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: testDisburser,
        value: Q18.mul(1),
      });
      await advanceSnapshotId(neumark);
      await assertClaimable(etherToken, neumark, investors[0], maxUInt256, Q18.mul(3), Q18.mul(3));
      // qed :)
    });

    it("should not disburse if the totalsupply of pro rata token is zero", async () => {
      // neu neumarks minted yet
      await expect(
        etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
          from: disburser,
          value: Q18.mul(1),
        }),
      ).to.be.rejectedWith(EvmError);
      // mint neumarks for investor 0
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // now it will work
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: disburser,
        value: Q18.mul(1),
      });
    });

    it(
      "should not disburse if the totalSupply of pro rata token equals disbursed amount and disbursed token is same as pro rata token",
    );

    it("should not accept disbursing an unknown token", async () => {
      // we need at least one investor
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // create a second ether token where the disburser has a balance of 20
      const newEtherToken = await EtherToken.new(accessPolicy.address);
      // transfering is now allowed
      await expect(
        newEtherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
          from: disburser,
          value: Q18.mul(1),
        }),
      ).to.be.rejectedWith("NF_DISBURSAL_REJECTED");
      // ether token works
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(1), 0, {
        from: disburser,
        value: Q18.mul(1),
      });
    });

    async function rejectClaimsForNonVerifiedInvestor(claimf, revertstr) {
      // create investor with neumark but no claims
      await prepareInvestor(investors[0], Q18.mul(200), false);
      // disburse some ether tokens from the disburser
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(100), 0, {
        from: disburser,
        value: Q18.mul(100),
      });
      await advanceSnapshotId(neumark);
      // accept will revert
      await expect(
        claimf(etherToken.address, neumark.address, maxUInt256, {
          from: investors[0],
        }),
      ).to.be.rejectedWith(revertstr);
      // add verified bit
      await identityRegistry.setClaims(
        investors[0],
        toBytes32(identityClaims.isNone),
        toBytes32(identityClaims.isVerified),
        { from: masterManager },
      );
      // now claiming should work
      await claimf(etherToken.address, neumark.address, maxUInt256, {
        from: investors[0],
      });
      // disburse more
      await etherToken.depositAndTransfer(feeDisbursal.address, Q18.mul(100), 0, {
        from: disburser,
        value: Q18.mul(100),
      });

      await advanceSnapshotId(neumark);
      // set account frozen bit
      await identityRegistry.setClaims(
        investors[0],
        toBytes32(identityClaims.isVerified),
        toBytes32(identityClaims.isVerified | identityClaims.isAccountFrozen),
        { from: masterManager },
      );
      // now will revert again
      await expect(
        claimf(etherToken.address, neumark.address, maxUInt256, {
          from: investors[0],
        }),
      ).to.be.rejectedWith(revertstr);
    }

    it("should not accept with no identity claims or frozen account", async () => {
      await rejectClaimsForNonVerifiedInvestor(feeDisbursal.accept, "NF_ACCEPT_REJECTED");
    });

    it("should not reject with no identity claims or frozen account", async () => {
      await rejectClaimsForNonVerifiedInvestor(feeDisbursal.reject, "NF_REJECT_REJECTED");
    });

    it("should group disbursal entries of different disbursers", async () => {
      // we need one neumark hodler
      await prepareInvestor(investors[0], Q18.mul(200), false);

      await disburseEtherToken(disburser, Q18.mul(2));
      await disburseEtherToken(disburser2, Q18);
      await disburseEtherToken(disburser, Q18.mul(3));
      await disburseEtherToken(disburser, Q18.mul(5));

      await disburseEuroToken(disburser, Q18);
      await disburseEuroToken(disburser2, Q18);
      await disburseEuroToken(disburser2, Q18);

      // each should have two disbursals, as they are grouped by disburser
      await assertDisbursalCount(etherToken, neumark, 2);
      await assertDisbursalCount(euroToken, neumark, 2);
      await advanceSnapshotId(neumark);
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(11),
        Q18.mul(11),
      );
      await assertClaimable(euroToken, neumark, investors[0], maxUInt256, Q18.mul(3), Q18.mul(3));
    });

    it("should allow setting a new controller", async () => {
      let controller = await feeDisbursal.feeDisbursalController();
      expect(controller).to.equal(feeDisbursalController.address);
      // needs disbursal manager to change controller
      await accessPolicy.setUserRole(
        investors[0],
        roles.disbursalManager,
        feeDisbursal.address,
        TriState.Allow,
      );
      const newController = await FeeDisbursalController.new(universe.address);
      const tx = await feeDisbursal.changeFeeDisbursalController(newController.address, {
        from: investors[0],
      });
      expectedLogChangeFeeDisbursalController(
        tx,
        feeDisbursalController.address,
        newController.address,
        investors[0],
      );
      controller = await feeDisbursal.feeDisbursalController();
      expect(controller).to.equal(newController.address);
    });

    it("should not allow setting a controller from random address", async () => {
      const controller = await feeDisbursal.feeDisbursalController();
      expect(controller).to.equal(feeDisbursalController.address);
      const newController = await FeeDisbursalController.new(universe.address);
      await expect(
        feeDisbursal.changeFeeDisbursalController(newController.address, { from: investors[3] }),
      ).to.be.rejectedWith("NF_CHANGING_CONTROLLER_REJECTED");
    });

    it("should not allow setting a controller which has the wrong (or none) contract id", async () => {
      const controller = await feeDisbursal.feeDisbursalController();
      expect(controller).to.equal(feeDisbursalController.address);
      await expect(
        feeDisbursal.changeFeeDisbursalController(universe.address, { from: masterManager }),
      ).to.be.rejectedWith("NF_CHANGING_CONTROLLER_REJECTED");
    });

    it("should recycle tokens", async () => {
      await prepareInvestor(investors[0], Q18.mul(25), true);
      await prepareInvestor(investors[1], Q18.mul(75), true);
      await disburseEtherToken(disburser, Q18.mul(50));
      const recycleAfter = await recycleAfterFromNow();
      await advanceSnapshotId(neumark);
      await disburseEtherToken(disburser, Q18.mul(50));
      await advanceSnapshotId(neumark);

      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(25),
        Q18.mul(100),
      );
      await assertClaimable(
        etherToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(75),
        Q18.mul(100),
      );
      await assertRecycleable(etherToken, neumark, investors, maxUInt256, Q18.mul(0));

      // forward default disbursal duration, then these tokens become recycleable
      await increaseTime(platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION + 1);
      await advanceSnapshotId(neumark);
      const recycleAfterRecyclePeriod = await recycleAfterFromNow();

      await disburseEtherToken(disburser, Q18.mul(30));
      await assertDisbursalCount(etherToken, neumark, 3);
      await advanceSnapshotId(neumark);
      await disburseEtherToken(disburser, Q18.mul(30));
      await advanceSnapshotId(neumark);
      await assertDisbursalCount(etherToken, neumark, 4);
      // 160 * 0.25
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(40),
        Q18.mul(160),
        recycleAfter,
        0,
      );
      // 160 * .75
      await assertClaimable(
        etherToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(120),
        Q18.mul(160),
        recycleAfter,
        0,
      );
      // recyclable stays the same
      await assertRecycleable(etherToken, neumark, investors, maxUInt256, Q18.mul(100));

      // we get a new investor now who will have half of the NEU
      await prepareInvestor(investors[2], Q18.mul(100), true);

      // anyone can recycle
      const recycleTx = await feeDisbursal.recycle(
        etherToken.address,
        neumark.address,
        investors,
        maxUInt256,
        {
          from: investors[3],
        },
      );
      expectedLogFundsRecycled(
        recycleTx,
        neumark.address,
        etherToken.address,
        Q18.mul(100),
        investors[3],
      );
      await assertRecycleable(etherToken, neumark, investors, maxUInt256, Q18.mul(0));
      // 4 disbursals + recycled
      await assertDisbursalCount(etherToken, neumark, 5);
      const recycleDisbursal = await feeDisbursal.getDisbursal(
        etherToken.address,
        neumark.address,
        4,
      );
      // fee disbursal is disburser in case of recycle
      expect(recycleDisbursal[3]).to.eq(feeDisbursal.address);

      // now the 100 recycleable tokens have been divided up to the three investors
      await advanceSnapshotId(neumark);
      // 0.5 * 100
      await assertClaimable(
        etherToken,
        neumark,
        investors[2],
        maxUInt256,
        Q18.mul(50),
        Q18.mul(160),
        recycleAfterRecyclePeriod,
        0,
      );
      // 60 * 0.25 + 100 * 0.125
      await assertClaimable(
        etherToken,
        neumark,
        investors[0],
        maxUInt256,
        Q18.mul(27.5),
        Q18.mul(160),
        recycleAfterRecyclePeriod,
        2,
      );
      // 160 - 50 - 27.5
      await assertClaimable(
        etherToken,
        neumark,
        investors[1],
        maxUInt256,
        Q18.mul(82.5),
        Q18.mul(160),
        recycleAfterRecyclePeriod,
        2,
      );
    });

    // if there are 3 disbursals, 1 expired, 2 not yet expired and 3rd expired we can recycle just 1
    // that's because we cannot increase idx past 2nd
    it("should not recycle disbursals if spaced by non recyclable disbursals");
  });
});
