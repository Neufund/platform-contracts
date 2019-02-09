import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployEtherTokenUniverse,
  deployICBMEtherTokenUniverse,
  deployFeeDisbursalUniverse,
  deployNeumarkUniverse,
  deployEuroTokenUniverse,
  deployICBMEuroTokenUniverse,
  deployPlatformTerms,
} from "./helpers/deployContracts";
import { TriState, GLOBAL } from "./helpers/triState";
import roles from "./helpers/roles";
import { toBytes32, Q18, ZERO_ADDRESS, contractId, daysToSeconds } from "./helpers/constants";
import { identityClaims } from "./helpers/identityClaims";
import increaseTime from "./helpers/increaseTime";
import { latestTimestamp } from "./helpers/latestTime";
import { knownInterfaces } from "./helpers/knownInterfaces";
import EvmError from "./helpers/EVMThrow";
import { decodeLogs, eventValue, eventValueAtIndex } from "./helpers/events";
import { divRound } from "./helpers/unitConverter";

const FeeDisbursalController = artifacts.require("FeeDisbursalController");
const EtherToken = artifacts.require("EtherToken");
const TestSnapshotToken = artifacts.require("TestSnapshotToken");
const TestDisburser = artifacts.require("TestDisburser");

const maxUInt256 = new web3.BigNumber(2).pow(256).sub(1);
const big = b => new web3.BigNumber(b);
const propd = (disbursal, share, total) =>
  disbursal
    .mul(share)
    .div(total)
    .floor();

contract("FeeDisbursal", ([_, masterManager, disburser, disburser2, ...investors]) => {
  let universe;
  let platformTermsDict;

  describe("specific tests", () => {
    let feeDisbursal;
    let feeDisbursalController;
    let etherToken;
    let icbmEtherToken;
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
      icbmEtherToken = await deployICBMEtherTokenUniverse(universe, masterManager);
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
    async function prepareInvestor(investor, neumarks, isVerified = true) {
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
    async function disburseEtherToken(sender, amount, expIndex) {
      // console.log("disburseEtherToken");
      const tx = await etherToken.depositAndTransfer(feeDisbursal.address, amount, 0, {
        from: sender,
        value: amount,
      });
      tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
      expectLogDisbursalCreated(
        tx,
        neumark.address,
        etherToken.address,
        amount,
        sender,
        platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        expIndex,
      );
      return tx;
    }

    async function disburseEuroToken(sender, amount, expIndex) {
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
      expectLogDisbursalCreated(
        tx,
        neumark.address,
        euroToken.address,
        amount,
        sender,
        platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        expIndex,
      );
      return tx;
    }

    async function disburseNeumark(sender, amount, expIndex) {
      await neumark.issueForEuro(amount, { from: masterManager });
      await neumark.distribute(sender, amount, { from: masterManager });
      const tx = await neumark.transfer["address,uint256,bytes"](feeDisbursal.address, amount, 0, {
        from: sender,
      });
      tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
      expectLogDisbursalCreated(
        tx,
        neumark.address,
        neumark.address,
        amount,
        sender,
        platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        expIndex,
      );
      // burn all the excess neumarks
      const balance = await neumark.balanceOf(masterManager);
      await neumark.burn.uint256(balance, { from: masterManager });
      return tx;
    }

    /**
     * Assertion helpers
     */
    function expectLogDisbursalCreated(
      tx,
      proRataToken,
      token,
      amount,
      disburserAddr,
      recycleDur,
      index,
    ) {
      const event = eventValue(tx, "LogDisbursalCreated");
      expect(event).to.exist;
      expect(event.args.proRataToken).to.eq(proRataToken);
      expect(event.args.token).to.eq(token);
      expect(event.args.amount).to.be.bignumber.eq(amount);
      expect(event.args.recycleAfterDuration).to.be.bignumber.eq(
        recycleDur || platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
      );
      expect(event.args.disburser).to.eq(disburserAddr);
      if (index) {
        expect(event.args.index).to.be.bignumber.eq(index);
      }
    }

    function expectLogDisbursalAccepted(
      tx,
      claimer,
      token,
      proRataToken,
      amount,
      nextIndex,
      evIdx,
    ) {
      const event = eventValueAtIndex(tx, evIdx || 0, "LogDisbursalAccepted");
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

    function expectClaimablesToEqual(claimables, expectedClaimables) {
      for (let i = 0; i < claimables.length; i += 1) {
        const claimable = claimables[i];
        const expectedClaimable = expectedClaimables[i];
        expect(claimable[0], "claimableAmount").to.be.bignumber.eq(expectedClaimable[0]);
        expect(claimable[1], "totalAmount").to.be.bignumber.eq(expectedClaimable[1]);
        if (expectedClaimable[2]) {
          expect(
            claimable[2].sub(expectedClaimable[2]).abs(),
            "recyclableAfter",
          ).to.be.bignumber.lt(10);
        }
        if (expectedClaimable[3]) {
          expect(claimable[3], "firstIndex").to.be.bignumber.eq(expectedClaimable[3]);
        }
      }
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

    async function assertRecycleable(token, proRataToken, investorList, index, expectedAmount) {
      const recycleableAmount = await feeDisbursal.recycleable(
        token.address,
        proRataToken.address,
        investorList,
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
      expect((await feeDisbursal.contractId())[0]).to.eq(contractId("FeeDisbursal"));
      expect((await feeDisbursalController.contractId())[0]).to.eq(
        contractId("FeeDisbursalController"),
      );
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

      it("should allow valid disbursers", async () => {
        // working case
        let controller = await FeeDisbursalController.new(universe.address);
        const token = etherToken.address;
        const addr = investors[0];
        let allowed = await controller.onDisburse(token, disburser, 1, ZERO_ADDRESS, 1);
        expect(allowed).to.be.true;
        // singletons must be able to disburse
        const disbursingSigletons = [
          knownInterfaces.euroLock,
          knownInterfaces.etherLock,
          knownInterfaces.icbmEtherLock,
          knownInterfaces.icbmEuroLock,
        ];
        for (const s of disbursingSigletons) {
          controller = await FeeDisbursalController.new(universe.address);
          allowed = await controller.onDisburse(token, addr, 1, ZERO_ADDRESS, 1);
          expect(allowed).to.be.false;
          await universe.setSingleton(s, addr, { from: masterManager });
          controller = await FeeDisbursalController.new(universe.address);
          allowed = await controller.onDisburse(token, addr, 1, ZERO_ADDRESS, 1);
          expect(allowed).to.be.true;
          await universe.setSingleton(s, ZERO_ADDRESS, { from: masterManager });
        }
        controller = await FeeDisbursalController.new(universe.address);
        // example singletons that cannot disburse
        allowed = await controller.onDisburse(token, euroToken.address, 1, ZERO_ADDRESS, 1);
        expect(allowed).to.be.false;
        allowed = await controller.onDisburse(token, neumark.address, 1, ZERO_ADDRESS, 1);
        expect(allowed).to.be.false;
        // fee disbursal can disburse via a small hack. if disburser is msg.sender we say you can
        // disburse
        allowed = await controller.onDisburse(token, addr, 1, ZERO_ADDRESS, 1, { from: addr });
        expect(allowed).to.be.true;
        // disbursable collections can disburse
        const disbursingColls = [
          knownInterfaces.equityTokenControllerInterface,
          knownInterfaces.commitmentInterface,
        ];
        for (const c of disbursingColls) {
          allowed = await controller.onDisburse(token, addr, 1, ZERO_ADDRESS, 1);
          expect(allowed).to.be.false;
          await universe.setCollectionInterface(c, addr, true, { from: masterManager });
          allowed = await controller.onDisburse(token, addr, 1, ZERO_ADDRESS, 1);
          expect(allowed).to.be.true;
          await universe.setCollectionInterface(c, addr, false, { from: masterManager });
        }
        // example collection that cannot disburse
        await universe.setCollectionInterface(knownInterfaces.equityTokenInterface, addr, true, {
          from: masterManager,
        });
        allowed = await controller.onDisburse(token, addr, 1, ZERO_ADDRESS, 1);
        expect(allowed).to.be.false;
      });

      it("should not allow 0 amount", async () => {
        const token = etherToken.address;
        const allowed = await feeDisbursalController.onDisburse(
          token,
          disburser,
          0,
          ZERO_ADDRESS,
          1,
        );
        expect(allowed).to.be.false;
      });

      it("should let change controller", async () => {
        const manager = investors[0];
        const feeDisbursalAddr = investors[1];
        const controller = await FeeDisbursalController.new(universe.address);
        // sender must have disbursalManager role on msg.sender ie. on actual FeeDisbursal instance
        await accessPolicy.setUserRole(
          manager,
          roles.disbursalManager,
          feeDisbursalAddr,
          TriState.Allow,
        );
        let allowed = await feeDisbursalController.onChangeFeeDisbursalController(
          manager,
          controller.address,
          { from: feeDisbursalAddr },
        );
        expect(allowed).to.be.true;
        // valid role, invalid contract
        allowed = await feeDisbursalController.onChangeFeeDisbursalController(
          manager,
          feeDisbursal.address,
          { from: feeDisbursalAddr },
        );
        expect(allowed).to.be.false;
        // invalid role, valid contract
        allowed = await feeDisbursalController.onChangeFeeDisbursalController(
          manager,
          controller.address,
          { from: manager },
        );
        expect(allowed).to.be.false;
        allowed = await feeDisbursalController.onChangeFeeDisbursalController(
          feeDisbursalAddr,
          controller.address,
          { from: feeDisbursalAddr },
        );
        expect(allowed).to.be.false;
      });

      it("should allow any pro rata token", async () => {
        const token = etherToken.address;
        // neumark can be disbursed sure
        let allowed = await feeDisbursalController.onDisburse(
          token,
          disburser,
          1,
          neumark.address,
          1,
        );
        expect(allowed).to.be.true;
        // any other address as well, this however will fail on not having snapshotable interface
        // we do not check this in controller
        allowed = await feeDisbursalController.onDisburse(token, disburser, 1, ZERO_ADDRESS, 1);
        expect(allowed).to.be.true;
      });

      async function claimAllowed(claimf) {
        // can claim anything
        let allowed = await claimf(ZERO_ADDRESS, ZERO_ADDRESS, investors[0]);
        expect(allowed).to.be.false;
        await identityRegistry.setClaims(investors[0], toBytes32(0), toBytes32(1), {
          from: masterManager,
        });
        allowed = await claimf(ZERO_ADDRESS, ZERO_ADDRESS, investors[0]);
        expect(allowed).to.be.true;
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(1),
          toBytes32(identityClaims.isAccountFrozen + identityClaims.isVerified),
          { from: masterManager },
        );
        allowed = await claimf(ZERO_ADDRESS, ZERO_ADDRESS, investors[0]);
        expect(allowed).to.be.false;
      }

      it("should allow to accept only for verified and not frozen accounts", async () => {
        await claimAllowed(feeDisbursalController.onAccept);
      });

      it("should allow to reject only for verified and not frozen accounts", async () => {
        await claimAllowed(feeDisbursalController.onReject);
      });

      it("should always allow recycle", async () => {
        const allowed = await feeDisbursalController.onRecycle(ZERO_ADDRESS, ZERO_ADDRESS, [], 0);
        expect(allowed).to.be.true;
      });
    });

    async function shouldDisburseToken(
      token,
      disbursef,
      amount = Q18.mul(100),
      verifyIdentity = true,
    ) {
      await prepareInvestor(investors[0], Q18.mul(200), verifyIdentity);
      await prepareInvestor(investors[1], Q18.mul(800), verifyIdentity);
      await disbursef(disburser, amount);

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
        propd(amount, Q18.mul(200), Q18.mul(1000)),
        amount,
        expectedRecycleAfter,
        0,
      );
      await assertClaimable(
        token,
        neumark,
        investors[1],
        maxUInt256,
        propd(amount, Q18.mul(800), Q18.mul(1000)),
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

    it("should be able to downround with two disbursals in single snapshot", async () => {
      // we sub balance of fee disbursal contract, check if values match
      const tr1Amount = Q18.mul(1281.21).add(1);
      const tr2Amount = Q18.mul(38.1);
      const iniDist = Q18.mul(1000);
      const amount = tr1Amount.add(tr2Amount);
      await prepareInvestor(investors[0], Q18.mul(200));
      await prepareInvestor(investors[1], Q18.mul(800));
      // first tranche disburser1
      await disburseNeumark(disburser, tr1Amount);
      // second tranche disburser2
      await disburseNeumark(disburser2, tr2Amount);
      await advanceSnapshotId(neumark);
      // available now as disbursal snapshot is sealed
      const inv0expectedAmount = propd(amount, Q18.mul(200), iniDist);
      await assertClaimable(neumark, neumark, investors[0], maxUInt256, inv0expectedAmount, amount);
      // now investor1 got inv0expectedAmount of NEU so proRata below changes
      await feeDisbursal.accept(neumark.address, neumark.address, maxUInt256, {
        from: investors[0],
      });
      expect(await neumark.balanceOf(investors[0])).to.be.bignumber.eq(
        Q18.mul(200).add(inv0expectedAmount),
      );

      // again - with merged snapshot
      await disburseNeumark(disburser, tr1Amount);
      await disburseNeumark(disburser, tr2Amount);
      await advanceSnapshotId(neumark);
      // available now as disbursal snapshot is sealed
      const inv0expectedAmount2 = propd(
        amount,
        Q18.mul(200).add(inv0expectedAmount),
        iniDist.add(inv0expectedAmount),
      );
      await assertClaimable(
        neumark,
        neumark,
        investors[0],
        maxUInt256,
        inv0expectedAmount2,
        amount,
      );
      await feeDisbursal.accept(neumark.address, neumark.address, maxUInt256, {
        from: investors[0],
      });
      await feeDisbursal.accept(neumark.address, neumark.address, maxUInt256, {
        from: investors[1],
      });
      // max 2 wei left in the contract
      expect(await neumark.balanceOf(feeDisbursal.address)).to.be.bignumber.lt(3);
      // 2 * amount got distributed + initial distribution
      expect(await neumark.totalSupply()).to.be.bignumber.eq(amount.mul(2).add(iniDist));
      // disbursal1 + disbursal2 + initial dist
      expect(await neumark.balanceOf(investors[0])).to.be.bignumber.eq(
        inv0expectedAmount2.add(inv0expectedAmount).add(Q18.mul(200)),
      );
      // same
      const inv1expectedAmount = propd(amount, Q18.mul(800), iniDist);
      const inv1expectedAmount2 = propd(amount, Q18.mul(800), iniDist.add(inv0expectedAmount));
      expect(await neumark.balanceOf(investors[1])).to.be.bignumber.eq(
        inv1expectedAmount.add(inv1expectedAmount2).add(Q18.mul(800)),
      );
    });

    it("should be able to retrieve details of a disbursal", async () => {
      // we need at least one investor as always
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // create two entries for ethertoken
      await disburseEtherToken(disburser, Q18.mul(40));
      await disburseEtherToken(disburser2, Q18.mul(60));
      const currSnapshotId = await neumark.currentSnapshotId();
      const currTs = await latestTimestamp();
      const recycleAfter = await recycleAfterFromNow();
      let [
        snapshotId,
        amount,
        recyclableAfterTimestamp,
        disburseTimestamp,
        actualDisburser,
      ] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 0);
      expect(snapshotId).to.be.bignumber.eq(currSnapshotId);
      expect(disburseTimestamp.sub(currTs).abs()).to.be.bignumber.lt(2);
      expect(recyclableAfterTimestamp.sub(recycleAfter).abs()).to.be.bignumber.lt(2);
      expect(amount).to.be.bignumber.eq(Q18.mul(40));
      expect(actualDisburser).to.be.equal(disburser);

      [
        snapshotId,
        amount,
        recyclableAfterTimestamp,
        disburseTimestamp,
        actualDisburser,
      ] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 1);
      expect(snapshotId).to.be.bignumber.eq(currSnapshotId);
      expect(disburseTimestamp.sub(currTs).abs()).to.be.bignumber.lt(2);
      expect(recyclableAfterTimestamp.sub(recycleAfter).abs()).to.be.bignumber.lt(2);
      expect(amount).to.be.bignumber.eq(Q18.mul(60));
      expect(actualDisburser).to.be.equal(disburser2);

      // reverts on unknown index
      expect(
        await feeDisbursal.getDisbursalCount(etherToken.address, neumark.address),
      ).to.be.bignumber.eq(2);
      await expect(feeDisbursal.getDisbursal(etherToken.address, neumark.address, 2)).to.revert;
    });

    it("should retrieve non claimable disbursals", async () => {
      const empty = await feeDisbursal.getNonClaimableDisbursals(
        etherToken.address,
        neumark.address,
      );
      expect(empty).to.be.empty;
      const snapshotId = await neumark.currentSnapshotId();
      // we need at least one investor as always
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // create two entries for ethertoken
      await disburseEtherToken(disburser, Q18.mul(40));
      const one = await feeDisbursal.getNonClaimableDisbursals(etherToken.address, neumark.address);
      expect(one.length).to.be.eq(1);
      expect(one[0][0]).to.be.bignumber.eq(snapshotId);
      expect(one[0][1]).to.be.bignumber.eq(Q18.mul(40));
      expect(one[0][2]).to.be.bignumber.eq(0);

      await disburseEtherToken(disburser2, Q18.mul(60));
      const two = await feeDisbursal.getNonClaimableDisbursals(etherToken.address, neumark.address);
      expect(two.length).to.be.eq(2);
      expect(two[0]).to.be.deep.eq(one[0]);
      expect(two[1][0]).to.be.bignumber.eq(snapshotId);
      expect(two[1][1]).to.be.bignumber.eq(Q18.mul(60));
      expect(two[1][2]).to.be.bignumber.eq(1);
      // seal
      await advanceSnapshotId(neumark);
      const empty2 = await feeDisbursal.getNonClaimableDisbursals(
        etherToken.address,
        neumark.address,
      );
      expect(empty2).to.be.empty;
      const snapshotId2 = await neumark.currentSnapshotId();
      await disburseEtherToken(disburser, Q18.mul(50));
      const one2 = await feeDisbursal.getNonClaimableDisbursals(
        etherToken.address,
        neumark.address,
      );
      expect(one2.length).to.be.eq(1);
      expect(one2[0][0]).to.be.bignumber.eq(snapshotId2);
      expect(one2[0][1]).to.be.bignumber.eq(Q18.mul(50));
      expect(one2[0][2]).to.be.bignumber.eq(2);

      await disburseEtherToken(disburser2, Q18.mul(70));
      const two2 = await feeDisbursal.getNonClaimableDisbursals(
        etherToken.address,
        neumark.address,
      );
      expect(two2.length).to.be.eq(2);
      expect(two2[0]).to.be.deep.eq(one2[0]);
      expect(two2[1][0]).to.be.bignumber.eq(snapshotId2);
      expect(two2[1][1]).to.be.bignumber.eq(Q18.mul(70));
      expect(two2[1][2]).to.be.bignumber.eq(3);
      // seal
      await advanceSnapshotId(neumark);
      const empty3 = await feeDisbursal.getNonClaimableDisbursals(
        etherToken.address,
        neumark.address,
      );
      expect(empty3).to.be.empty;
    });

    it("should overwrite timestamp and recycle period in details of disbursal", async () => {
      await prepareInvestor(investors[0], Q18.mul(200), true);
      // disburse some
      await disburseEtherToken(disburser, Q18.mul(40), 0);
      const currSnapshotId = await neumark.currentSnapshotId();
      let currTs = await latestTimestamp();
      let recycleAfter = await recycleAfterFromNow();
      let [
        snapshotId,
        amount,
        recyclableAfterTimestamp,
        disburseTimestamp,
        actualDisburser,
      ] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 0);
      expect(snapshotId).to.be.bignumber.eq(currSnapshotId);
      expect(disburseTimestamp.sub(currTs).abs()).to.be.bignumber.lt(2);
      expect(recyclableAfterTimestamp.sub(recycleAfter).abs()).to.be.bignumber.lt(2);
      expect(amount).to.be.bignumber.eq(Q18.mul(40));
      expect(actualDisburser).to.be.equal(disburser);

      // skip some time do not cross snapshot boundary
      await increaseTime(30);
      await disburseEtherToken(disburser, Q18.mul(60), 0);
      // those moved by 30 secs (around)
      currTs = await latestTimestamp();
      recycleAfter = await recycleAfterFromNow();
      [
        snapshotId,
        amount,
        recyclableAfterTimestamp,
        disburseTimestamp,
        actualDisburser,
      ] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 0); // idx == 0
      expect(snapshotId).to.be.bignumber.eq(currSnapshotId);
      expect(disburseTimestamp.sub(currTs).abs()).to.be.bignumber.lt(2);
      expect(recyclableAfterTimestamp.sub(recycleAfter).abs()).to.be.bignumber.lt(2);
      expect(amount).to.be.bignumber.eq(Q18.mul(100)); // amount adds
      expect(actualDisburser).to.be.equal(disburser);
    });

    it("should be able to retreive multiple claimables", async () => {
      // ether and euro
      const paymentTokens = [euroToken.address, etherToken.address];
      const emptyClaimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[0],
      );
      const expectedEmptyClaimables = [[0, 0, 0, 0], [0, 0, 0, 0]];
      expectClaimablesToEqual(emptyClaimables, expectedEmptyClaimables);
      await shouldDisburseToken(etherToken, disburseEtherToken);
      const recycleEther = await recycleAfterFromNow();
      const etherClaimables0 = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[0],
      );
      const expectedEtherClaimables0 = [[0, 0, 0, 0], [Q18.mul(20), Q18.mul(100), recycleEther, 0]];
      expectClaimablesToEqual(etherClaimables0, expectedEtherClaimables0);
      const etherClaimables1 = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[1],
      );
      const expectedEtherClaimables1 = [[0, 0, 0, 0], [Q18.mul(80), Q18.mul(100), recycleEther, 0]];
      expectClaimablesToEqual(etherClaimables1, expectedEtherClaimables1);

      await increaseTime(60 * 60);
      await shouldDisburseToken(euroToken, disburseEuroToken, Q18.mul(230), false);
      const recycleEuro = await recycleAfterFromNow();
      const allClaimables0 = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[0],
      );
      const expectedAllClaimables0 = [
        [divRound(Q18.mul(230), big(5)), Q18.mul(230), recycleEuro, 0],
        [Q18.mul(20), Q18.mul(100), recycleEther, 0],
      ];
      expectClaimablesToEqual(allClaimables0, expectedAllClaimables0);
      const allClaimables1 = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[1],
      );
      const expectedAllClaimables1 = [
        [divRound(Q18.mul(230), big(1.25)), Q18.mul(230), recycleEuro, 0],
        [Q18.mul(80), Q18.mul(100), recycleEther, 0],
      ];
      expectClaimablesToEqual(allClaimables1, expectedAllClaimables1);
    });

    it("should accept multiple tokens for one pro-rata", async () => {
      const paymentTokens = [euroToken.address, etherToken.address];
      await expect(
        feeDisbursal.acceptMultipleByToken(paymentTokens, neumark.address, { from: investors[0] }),
      ).to.be.rejectedWith("NF_ACCEPT_REJECTED");
      await identityRegistry.setClaims(
        investors[0],
        toBytes32(identityClaims.isNone),
        toBytes32(identityClaims.isVerified),
        { from: masterManager },
      );
      // allow empty accept, events must be generated
      const emptyAcceptTx = await feeDisbursal.acceptMultipleByToken(
        paymentTokens,
        neumark.address,
        { from: investors[0] },
      );
      expectLogDisbursalAccepted(
        emptyAcceptTx,
        investors[0],
        euroToken.address,
        neumark.address,
        0,
        0,
        0,
      );
      expectLogDisbursalAccepted(
        emptyAcceptTx,
        investors[0],
        etherToken.address,
        neumark.address,
        0,
        0,
        1,
      );

      // reset verification
      await identityRegistry.setClaims(
        investors[0],
        toBytes32(identityClaims.isVerified),
        toBytes32(identityClaims.isNone),
        { from: masterManager },
      );
      // disburse nEur
      await shouldDisburseToken(euroToken, disburseEuroToken);
      const euroAcceptTx0 = await feeDisbursal.acceptMultipleByToken(
        paymentTokens,
        neumark.address,
        { from: investors[0] },
      );
      expectLogDisbursalAccepted(
        euroAcceptTx0,
        investors[0],
        euroToken.address,
        neumark.address,
        Q18.mul(20),
        1,
        0,
      );
      expectLogDisbursalAccepted(
        euroAcceptTx0,
        investors[0],
        etherToken.address,
        neumark.address,
        0,
        0,
        1,
      );
      const euroAcceptTx1 = await feeDisbursal.acceptMultipleByToken(
        paymentTokens,
        neumark.address,
        { from: investors[1] },
      );
      expectLogDisbursalAccepted(
        euroAcceptTx1,
        investors[1],
        euroToken.address,
        neumark.address,
        Q18.mul(80),
        1,
        0,
      );
      expectLogDisbursalAccepted(
        euroAcceptTx1,
        investors[1],
        etherToken.address,
        neumark.address,
        0,
        0,
        1,
      );
      // expect balances
      await assertTokenBalance(euroToken, investors[0], Q18.mul(20));
      await assertTokenBalance(euroToken, investors[1], Q18.mul(80));
      await assertTokenBalance(etherToken, investors[0], 0);
      await assertTokenBalance(etherToken, investors[1], 0);
      await assertTokenBalance(euroToken, feeDisbursal.address, 0);

      // disburse eth
      const ethDisbursal = Q18.mul(1).add(1);
      await shouldDisburseToken(etherToken, disburseEtherToken, ethDisbursal, false);
      const etherAcceptTx0 = await feeDisbursal.acceptMultipleByToken(
        paymentTokens,
        neumark.address,
        { from: investors[0] },
      );
      expectLogDisbursalAccepted(
        etherAcceptTx0,
        investors[0],
        euroToken.address,
        neumark.address,
        0,
        1,
        0,
      );
      const ethClaim00 = propd(ethDisbursal, Q18.mul(400), Q18.mul(2000));
      expectLogDisbursalAccepted(
        etherAcceptTx0,
        investors[0],
        etherToken.address,
        neumark.address,
        ethClaim00,
        1,
        1,
      );
      const etherAcceptTx1 = await feeDisbursal.acceptMultipleByToken(
        paymentTokens,
        neumark.address,
        { from: investors[1] },
      );
      expectLogDisbursalAccepted(
        etherAcceptTx1,
        investors[1],
        euroToken.address,
        neumark.address,
        0,
        1,
        0,
      );
      const ethClaim10 = propd(ethDisbursal, Q18.mul(1600), Q18.mul(2000));
      expectLogDisbursalAccepted(
        etherAcceptTx1,
        investors[1],
        etherToken.address,
        neumark.address,
        ethClaim10,
        1,
        1,
      );
      const ethLeftover1 = ethDisbursal.sub(ethClaim00).sub(ethClaim10);
      await assertTokenBalance(euroToken, feeDisbursal.address, 0);
      await assertTokenBalance(etherToken, feeDisbursal.address, ethLeftover1);
      await assertTokenBalance(euroToken, investors[0], Q18.mul(20));
      await assertTokenBalance(euroToken, investors[1], Q18.mul(80));
      await assertTokenBalance(etherToken, investors[0], ethClaim00);
      await assertTokenBalance(etherToken, investors[1], ethClaim10);

      // disburse both
      await increaseTime(60 * 172);
      const ethDisbursal2 = Q18.mul(1.28122182).sub(1);
      const eurDisbursal2 = Q18.mul(98328423.298372).add(1);
      await shouldDisburseToken(etherToken, disburseEtherToken, ethDisbursal2, false);
      await shouldDisburseToken(euroToken, disburseEuroToken, eurDisbursal2, false);
      const allAcceptTx0 = await feeDisbursal.acceptMultipleByToken(
        paymentTokens,
        neumark.address,
        { from: investors[0] },
      );
      const eurClaim01 = propd(eurDisbursal2, Q18.mul(800), Q18.mul(4000));
      expectLogDisbursalAccepted(
        allAcceptTx0,
        investors[0],
        euroToken.address,
        neumark.address,
        eurClaim01,
        2,
        0,
      );
      const ethClaim01 = propd(ethDisbursal2, Q18.mul(400), Q18.mul(2000));
      expectLogDisbursalAccepted(
        allAcceptTx0,
        investors[0],
        etherToken.address,
        neumark.address,
        ethClaim01,
        2,
        1,
      );
      const allAcceptTx1 = await feeDisbursal.acceptMultipleByToken(
        paymentTokens,
        neumark.address,
        { from: investors[1] },
      );
      const eurClaim11 = propd(eurDisbursal2, Q18.mul(1600), Q18.mul(2000));
      expectLogDisbursalAccepted(
        allAcceptTx1,
        investors[1],
        euroToken.address,
        neumark.address,
        eurClaim11,
        2,
        0,
      );
      const ethClaim11 = propd(ethDisbursal2, Q18.mul(800), Q18.mul(1000));
      expectLogDisbursalAccepted(
        allAcceptTx1,
        investors[1],
        etherToken.address,
        neumark.address,
        ethClaim11,
        2,
        1,
      );
      // compute leftover correctly
      const ethLeftover2 = ethLeftover1.add(ethDisbursal2.sub(ethClaim01).sub(ethClaim11));
      const eurLeftover2 = eurDisbursal2.sub(eurClaim11).sub(eurClaim01);
      await assertTokenBalance(euroToken, feeDisbursal.address, eurLeftover2);
      await assertTokenBalance(etherToken, feeDisbursal.address, ethLeftover2);
      await assertTokenBalance(euroToken, investors[0], Q18.mul(20).add(eurClaim01));
      await assertTokenBalance(euroToken, investors[1], Q18.mul(80).add(eurClaim11));
      await assertTokenBalance(etherToken, investors[0], ethClaim00.add(ethClaim01));
      await assertTokenBalance(etherToken, investors[1], ethClaim10.add(ethClaim11));
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
      await disburseEtherToken(disburser, initalEtherDisbursal, 0);
      const initialEuroDisbursal = Q18.mul(50);
      await disburseEuroToken(disburser, initialEuroDisbursal, 0);
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
      await disburseEtherToken(disburser, Q18.mul(150), 1);
      await disburseEtherToken(disburser, Q18.mul(250), 1); // overrides disbursal
      const finalEtherDisbursal = initalEtherDisbursal.add(Q18.mul(150)).add(Q18.mul(250));
      await disburseEuroToken(disburser, Q18.mul(200), 1);
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
      let acceptTx = await feeDisbursal.accept(etherToken.address, neumark.address, maxUInt256, {
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
      acceptTx = await feeDisbursal.accept(euroToken.address, neumark.address, maxUInt256, {
        from: investors[1],
      });
      expectLogDisbursalAccepted(
        acceptTx,
        investors[1],
        euroToken.address,
        neumark.address,
        finalEuroDisbursal.mul(0.3),
        2,
      );
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

    it("should disburse with changing balances after snapshot", async () => {
      const totalAmount = Q18.mul(10);
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await prepareInvestor(investors[1], Q18.mul(400), true);
      await disburseEtherToken(disburser, totalAmount);
      await advanceSnapshotId(neumark);
      // investor[1] sells all NEU
      await neumark.transfer(investors[2], Q18.mul(400), { from: investors[1] });
      // still can claim payouts
      const expClaim = propd(totalAmount, Q18.mul(400), Q18.mul(600));
      await assertClaimable(etherToken, neumark, investors[1], maxUInt256, expClaim, totalAmount);
      const acceptTx = await feeDisbursal.accept(etherToken.address, neumark.address, 1, {
        from: investors[1],
      });
      expectLogDisbursalAccepted(
        acceptTx,
        investors[1],
        etherToken.address,
        neumark.address,
        expClaim,
        1,
      );
    });

    // change pro rata dist and supply before sealing snapshot
    it("should disburse with changing balances and supply at current snapshot", async () => {
      // setup one investor and run some assertions
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await prepareInvestor(investors[1], Q18.mul(400), true);
      await disburseEtherToken(disburser, Q18.mul(10));
      // not sealed yet
      await neumark.transfer(investors[1], Q18.mul(50), { from: investors[0] });
      await neumark.burn.uint256(Q18.mul(10), { from: investors[1] });
      // this will seal inv0: 150 NEU, inv1: 440 NEU
      await advanceSnapshotId(neumark);
      const total = Q18.mul(590);
      const exp1 = propd(Q18.mul(10), Q18.mul(150), total);
      const exp2 = propd(Q18.mul(10), Q18.mul(440), total);
      await assertClaimable(etherToken, neumark, investors[0], 1, exp1, Q18.mul(10));
      await assertClaimable(etherToken, neumark, investors[1], 1, exp2, Q18.mul(10));
    });

    it("should merge disbursal spaced by many disbursers", async () => {
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await disburseEtherToken(disburser, Q18, 0);
      await disburseEtherToken(disburser2, Q18, 1);
      // should merge with idx 0
      await disburseEtherToken(disburser, Q18, 0);
      // add more disbursers
      await accessPolicy.setUserRole(investors[0], roles.disburser, GLOBAL, TriState.Allow);
      await accessPolicy.setUserRole(investors[1], roles.disburser, GLOBAL, TriState.Allow);
      await disburseEtherToken(investors[0], Q18, 2);
      await disburseEtherToken(investors[1], Q18, 3);
      // should merge to 0
      await disburseEtherToken(disburser, Q18, 0);
      // should merge to 1
      await disburseEtherToken(disburser2, Q18, 1);
      // should not merge across snapshots
      await advanceSnapshotId(neumark);
      await disburseEtherToken(disburser, Q18, 4);
      // should have correct amounts
      const d1 = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 0);
      expect(d1[1]).to.be.bignumber.eq(Q18.mul(3));
      const d2 = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 1);
      expect(d2[1]).to.be.bignumber.eq(Q18.mul(2));
    });

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
      let acceptTx = await feeDisbursal.accept(etherToken.address, neumark.address, 1, {
        from: investors[0],
      });
      expectLogDisbursalAccepted(
        acceptTx,
        investors[0],
        etherToken.address,
        neumark.address,
        Q18.mul(20),
        1,
      );
      await assertTokenBalance(etherToken, investors[0], Q18.mul(20));
      // remaining claimable
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
      acceptTx = await feeDisbursal.accept(etherToken.address, neumark.address, 2, {
        from: investors[0],
      });
      expectLogDisbursalAccepted(
        acceptTx,
        investors[0],
        etherToken.address,
        neumark.address,
        Q18.mul(10),
        2,
      );
      await assertTokenBalance(etherToken, investors[0], Q18.mul(30));
      // final remaining claimable
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
      acceptTx = await feeDisbursal.accept(etherToken.address, neumark.address, 3, {
        from: investors[0],
      });
      expectLogDisbursalAccepted(
        acceptTx,
        investors[0],
        etherToken.address,
        neumark.address,
        Q18.mul(20),
        3,
      );
      await assertTokenBalance(etherToken, investors[0], Q18.mul(50));
      await assertClaimable(etherToken, neumark, investors[0], 4, Q18.mul(0), 0, 0, 3); // no claims left
    });

    it("should reject disbursal", async () => {
      await prepareInvestor(investors[0], Q18.mul(200), true);
      await prepareInvestor(investors[1], Q18.mul(300), true);
      await prepareInvestor(investors[2], Q18.mul(500), true);
      await disburseEtherToken(disburser, Q18.mul(100));
      await advanceSnapshotId(neumark);
      await disburseEtherToken(disburser, Q18.mul(50));
      await advanceSnapshotId(neumark);
      let rejectTx = await feeDisbursal.reject(etherToken.address, neumark.address, maxUInt256, {
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
      expectLogDisbursalCreated(
        rejectTx,
        neumark.address,
        etherToken.address,
        Q18.mul(150 * 0.2),
        feeDisbursal.address,
        platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        2,
      );

      rejectTx = await feeDisbursal.reject(etherToken.address, neumark.address, maxUInt256, {
        from: investors[1],
      });
      expectLogDisbursalRejected(
        rejectTx,
        investors[1],
        etherToken.address,
        neumark.address,
        Q18.mul(150 * 0.3),
        2,
      );
      // but it was merged into existing recycle disbursal of investor[0] - see expIndex
      expectLogDisbursalCreated(
        rejectTx,
        neumark.address,
        etherToken.address,
        Q18.mul(150 * 0.3),
        feeDisbursal.address,
        platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        2,
      );

      // step by step reject
      rejectTx = await feeDisbursal.reject(etherToken.address, neumark.address, 1, {
        from: investors[2],
      });
      expectLogDisbursalRejected(
        rejectTx,
        investors[2],
        etherToken.address,
        neumark.address,
        Q18.mul(100 * 0.5),
        1,
      );
      expectLogDisbursalCreated(
        rejectTx,
        neumark.address,
        etherToken.address,
        Q18.mul(100 * 0.5),
        feeDisbursal.address,
        platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        2,
      );
      rejectTx = await feeDisbursal.reject(etherToken.address, neumark.address, 2, {
        from: investors[2],
      });
      expectLogDisbursalRejected(
        rejectTx,
        investors[2],
        etherToken.address,
        neumark.address,
        Q18.mul(50 * 0.5),
        2,
      );
      expectLogDisbursalCreated(
        rejectTx,
        neumark.address,
        etherToken.address,
        Q18.mul(50 * 0.5),
        feeDisbursal.address,
        platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        2,
      );

      // now all funds reside in single recycled disbursal
      const recycled = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 2);
      expect(recycled[1]).to.be.bignumber.eq(Q18.mul(150));
    });

    it("should disburse fully with various roundings in pro rata calculations", async () => {
      // this would fail if conctact rounds HALF_UP
      const distribution = [big(1), big(1)];
      let idx = 0;
      for (const a of distribution) {
        await prepareInvestor(investors[idx], a);
        idx += 1;
      }
      const wei = big(3);
      await disburseEtherToken(disburser, wei);
      await advanceSnapshotId(neumark);
      const [snapshotId] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 0);
      const total = await neumark.totalSupplyAt(snapshotId);
      expect(total).to.be.bignumber.eq(distribution.reduce((p, v) => p.add(v)));
      idx = 0;
      for (const a of distribution) {
        const exp = propd(wei, a, total);
        await assertClaimable(etherToken, neumark, investors[idx], 1, exp, wei);
        const tx = await feeDisbursal.accept(etherToken.address, neumark.address, maxUInt256, {
          from: investors[idx],
        });
        await expectLogDisbursalAccepted(
          tx,
          investors[idx],
          etherToken.address,
          neumark.address,
          exp,
          1,
        );
        idx += 1;
      }
      // one wei left in the contract
      expect(await etherToken.balanceOf(feeDisbursal.address)).to.be.bignumber.eq(1);
    });

    it("should disburse 1 wei", async () => {
      const distribution = [
        Q18.mul(10).add(1),
        Q18.mul(0.121213),
        Q18.mul(26712).sub(1),
        Q18.mul(0.118),
      ];
      let idx = 0;
      for (const a of distribution) {
        await prepareInvestor(investors[idx], a);
        idx += 1;
      }
      const wei = big(1);
      await disburseEtherToken(disburser, wei);
      await advanceSnapshotId(neumark);
      const [snapshotId] = await feeDisbursal.getDisbursal(etherToken.address, neumark.address, 0);
      const total = await neumark.totalSupplyAt(snapshotId);
      expect(total).to.be.bignumber.eq(distribution.reduce((p, v) => p.add(v)));
      idx = 0;
      for (const a of distribution) {
        const exp = propd(wei, a, total);
        await assertClaimable(etherToken, neumark, investors[idx], 1, exp, wei);
        const tx = await feeDisbursal.accept(etherToken.address, neumark.address, maxUInt256, {
          from: investors[idx],
        });
        await expectLogDisbursalAccepted(
          tx,
          investors[idx],
          etherToken.address,
          neumark.address,
          exp,
          1,
        );
        idx += 1;
      }
      // 1 wei left in the contract
      expect(await etherToken.balanceOf(feeDisbursal.address)).to.be.bignumber.eq(1);
    });

    describe("access control", () => {
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
        await assertClaimable(
          etherToken,
          neumark,
          investors[0],
          maxUInt256,
          Q18.mul(1),
          Q18.mul(1),
        );
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
        await assertClaimable(
          etherToken,
          neumark,
          investors[0],
          maxUInt256,
          Q18.mul(2),
          Q18.mul(2),
        );
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
        await assertClaimable(
          etherToken,
          neumark,
          investors[0],
          maxUInt256,
          Q18.mul(3),
          Q18.mul(3),
        );
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
    });

    describe("recycle tests", async () => {
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
        expect(recycleDisbursal[4]).to.eq(feeDisbursal.address);

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

      it("should not recycle disbursals if spaced by non recyclable disbursals", async () => {
        // if there are 3 disbursals, 1 expired, 2 not yet expired and 3rd expired we can recycle just 1
        // that's because we cannot increase idx past 2nd
        await prepareInvestor(investors[0], Q18);
        await prepareInvestor(investors[1], Q18.mul(1.5));
        // disburse with normal recycle period
        await disburseEtherToken(disburser, Q18);
        // disburse with double time period
        const doubleDefRecycle = big(2).mul(
          platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
        );
        const testDisburser = await TestDisburser.new(feeDisbursal.address, neumark.address);
        await testDisburser.setRecycleAfterDuration(doubleDefRecycle);
        await accessPolicy.setUserRole(
          testDisburser.address,
          roles.disburser,
          GLOBAL,
          TriState.Allow,
        );
        await etherToken.deposit({ from: disburser, value: Q18 });
        const disburse2lTx = await etherToken.transfer["address,uint256,bytes"](
          testDisburser.address,
          Q18,
          "",
          { from: disburser },
        );
        disburse2lTx.logs = decodeLogs(disburse2lTx, feeDisbursal.address, feeDisbursal.abi);
        expectLogDisbursalCreated(
          disburse2lTx,
          neumark.address,
          etherToken.address,
          Q18,
          testDisburser.address,
          doubleDefRecycle,
        );
        // disburse with normal recycle
        await disburseEtherToken(disburser2, Q18, 2);
        // wait default recycle time so we can recycle
        await increaseTime(platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION + 1);
        // 1 and 3 disbursal could be recycled but recycle procedure must go continously
        await assertRecycleable(etherToken, neumark, investors.slice(0, 2), maxUInt256, Q18);
        let recycleTx = await feeDisbursal.recycle(
          etherToken.address,
          neumark.address,
          investors.slice(0, 2),
          maxUInt256,
          { from: masterManager },
        );
        expectedLogFundsRecycled(
          recycleTx,
          neumark.address,
          etherToken.address,
          Q18,
          masterManager,
        );
        // one investor takes non recycled disbursal but leaves the last (expired) one
        await feeDisbursal.accept(etherToken.address, neumark.address, 2, { from: investors[1] });
        // now in case of investors[1] we go past
        await assertRecycleable(
          etherToken,
          neumark,
          investors.slice(0, 2),
          maxUInt256,
          propd(Q18, Q18.mul(1.5), Q18.mul(2.5)),
        );
        // other investors takes all (including expired)
        const acceptTx = await feeDisbursal.accept(
          etherToken.address,
          neumark.address,
          maxUInt256,
          { from: investors[0] },
        );
        expectLogDisbursalAccepted(
          acceptTx,
          investors[0],
          etherToken.address,
          neumark.address,
          propd(Q18.mul(2), Q18.mul(1), Q18.mul(2.5)),
          3,
        );
        // recycle remaining part
        await assertRecycleable(
          etherToken,
          neumark,
          investors.slice(0, 2),
          maxUInt256,
          propd(Q18, Q18.mul(1.5), Q18.mul(2.5)),
        );
        recycleTx = await feeDisbursal.recycle(
          etherToken.address,
          neumark.address,
          investors.slice(0, 2),
          maxUInt256,
          { from: masterManager },
        );
        expectedLogFundsRecycled(
          recycleTx,
          neumark.address,
          etherToken.address,
          propd(Q18, Q18.mul(1.5), Q18.mul(2.5)),
          masterManager,
        );
      });
    });

    describe("parametrized disbursals", async () => {
      let proRataToken;
      let testDisburser;

      beforeEach(async () => {
        // setup initial distribution
        proRataToken = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
        await proRataToken.deposit(Q18, { from: investors[0] });
        await proRataToken.deposit(Q18.mul(2), { from: investors[1] });
        // setup disburser
        testDisburser = await TestDisburser.new(feeDisbursal.address, proRataToken.address);
        await accessPolicy.setUserRole(
          testDisburser.address,
          roles.disburser,
          GLOBAL,
          TriState.Allow,
        );
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          { from: masterManager },
        );
        await identityRegistry.setClaims(
          investors[1],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          { from: masterManager },
        );
      });

      it("should disburse eth with explicit snapshot token", async () => {
        // disburse
        const tx = await etherToken.depositAndTransfer(testDisburser.address, Q18, "", {
          from: masterManager,
          value: Q18,
        });
        tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
        expectLogDisbursalCreated(
          tx,
          proRataToken.address,
          etherToken.address,
          Q18,
          testDisburser.address,
          platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
          0,
        );
        // accept claim
        await advanceSnapshotId(proRataToken);
        const acceptTx = await feeDisbursal.accept(
          etherToken.address,
          proRataToken.address,
          maxUInt256,
          { from: investors[0] },
        );
        const inv1Amount = propd(Q18, Q18, Q18.mul(3));
        expectLogDisbursalAccepted(
          acceptTx,
          investors[0],
          etherToken.address,
          proRataToken.address,
          inv1Amount,
          1,
        );
        // reject claim
        const rejectTx = await feeDisbursal.reject(
          etherToken.address,
          proRataToken.address,
          maxUInt256,
          { from: investors[1] },
        );
        const inv2Amount = propd(Q18, Q18.mul(2), Q18.mul(3));
        expectLogDisbursalRejected(
          rejectTx,
          investors[1],
          etherToken.address,
          proRataToken.address,
          inv2Amount,
          1,
        );
        expectLogDisbursalCreated(
          rejectTx,
          proRataToken.address,
          etherToken.address,
          inv2Amount,
          feeDisbursal.address,
          platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION,
          1,
        );
        await advanceSnapshotId(proRataToken);
        // check claimable of 1
        const inv1Amount2 = propd(inv2Amount, Q18, Q18.mul(3));
        await assertClaimable(
          etherToken,
          proRataToken,
          investors[0],
          maxUInt256,
          inv1Amount2,
          inv2Amount,
        );
        // check claimable of 2
        const inv2Amount2 = propd(inv2Amount, Q18.mul(2), Q18.mul(3));
        await assertClaimable(
          etherToken,
          proRataToken,
          investors[1],
          maxUInt256,
          inv2Amount2,
          inv2Amount,
        );
      });

      it("should disburse with explicit expiration", async () => {
        // disburse
        const recycleDuration = daysToSeconds(10);
        await testDisburser.setRecycleAfterDuration(recycleDuration);
        const tx = await etherToken.depositAndTransfer(testDisburser.address, Q18, "", {
          from: masterManager,
          value: Q18,
        });
        tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
        expectLogDisbursalCreated(
          tx,
          proRataToken.address,
          etherToken.address,
          Q18,
          testDisburser.address,
          recycleDuration,
          0,
        );
        const [, , afterTs, disbTs] = await feeDisbursal.getDisbursal(
          etherToken.address,
          proRataToken.address,
          0,
        );
        expect(afterTs.sub(disbTs)).to.be.bignumber.eq(big(recycleDuration));
        expect(recycleDuration).not.eq(platformTermsDict.DEFAULT_DISBURSAL_RECYCLE_AFTER_DURATION);
      });

      it("rejects recycleAfterDuration overflow", async () => {
        const MAX_UINT128_1 = big(2).pow(128);
        await testDisburser.setRecycleAfterDuration(MAX_UINT128_1);
        await expect(
          etherToken.depositAndTransfer(testDisburser.address, Q18, "", {
            from: masterManager,
            value: Q18,
          }),
        ).to.revert;
        // current block timestamp is added so reverse will overflow
        const tsNow = await latestTimestamp();
        await testDisburser.setRecycleAfterDuration(MAX_UINT128_1.sub(tsNow));
        await expect(
          etherToken.depositAndTransfer(testDisburser.address, Q18, "", {
            from: masterManager,
            value: Q18,
          }),
        ).to.revert;
        // 1s below should work
        await testDisburser.setRecycleAfterDuration(MAX_UINT128_1.sub(tsNow).sub(2));
        const tx = await etherToken.depositAndTransfer(testDisburser.address, Q18, "", {
          from: masterManager,
          value: Q18,
        });
        tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
        expectLogDisbursalCreated(
          tx,
          proRataToken.address,
          etherToken.address,
          Q18,
          testDisburser.address,
          MAX_UINT128_1.sub(tsNow).sub(2),
          0,
        );
      });

      it("should accept token from many pro rata distributions", async () => {
        // prepare NEU, other token already prepared
        await prepareInvestor(investors[0], Q18.mul(70), false);
        await prepareInvestor(investors[1], Q18.mul(30), false);
        // distribute ether
        await etherToken.depositAndTransfer(testDisburser.address, Q18, "", {
          from: masterManager,
          value: Q18,
        });
        await disburseEtherToken(disburser, Q18.mul(28).add(1));
        // no claimables before first snapshot
        const proRatas = [neumark.address, proRataToken.address];
        const empty = await feeDisbursal.claimableMutipleByProRataToken(
          etherToken.address,
          proRatas,
          investors[0],
        );
        expectClaimablesToEqual(empty, [[0, 0, 0, 0], [0, 0, 0, 0]]);
        const emptyTx = await feeDisbursal.acceptMultipleByProRataToken(
          etherToken.address,
          proRatas,
          { from: investors[0] },
        );
        expectLogDisbursalAccepted(emptyTx, investors[0], etherToken.address, proRatas[0], 0, 0, 0);
        expectLogDisbursalAccepted(emptyTx, investors[0], etherToken.address, proRatas[1], 0, 0, 1);
        // make test snapshot token claimable
        await advanceSnapshotId(proRataToken);
        const proRataClaimables = await feeDisbursal.claimableMutipleByProRataToken(
          etherToken.address,
          proRatas,
          investors[0],
        );
        const proRataInv0Amount = propd(Q18, Q18, Q18.mul(3));
        expectClaimablesToEqual(proRataClaimables, [
          [0, 0, 0, 0],
          [proRataInv0Amount, Q18, null, null],
        ]);
      });

      it("should not disburse if the totalSupply of pro rata token equals disbursed amount and disbursed token is same as pro rata token", async () => {
        await universe.setCollectionInterface(
          knownInterfaces.equityTokenInterface,
          proRataToken.address,
          true,
          { from: masterManager },
        );
        await proRataToken.transfer["address,uint256,bytes"](testDisburser.address, Q18, "", {
          from: investors[0],
        });
        // in short: you cannot send all tokens pro rata tokens to be disbursed against itself.
        // there would be no one to claim them later
        await expect(
          proRataToken.transfer["address,uint256,bytes"](testDisburser.address, Q18.mul(2), "", {
            from: investors[1],
          }),
        ).to.be.rejectedWith("NF_NO_DISBURSE_EMPTY_TOKEN");
        // leave 1 wei at investors[1]
        await proRataToken.transfer["address,uint256,bytes"](
          testDisburser.address,
          Q18.mul(2).sub(1),
          "",
          { from: investors[1] },
        );
        await advanceSnapshotId(proRataToken);
        // as only holder of 1 wei gets all tokens
        await feeDisbursal.accept(proRataToken.address, proRataToken.address, maxUInt256, {
          from: investors[1],
        });
        assertTokenBalance(proRataToken, investors[1], Q18.mul(3));
      });
    });

    describe("legacy disbursals", async () => {
      it("disburse via approveAndCall with icbm ether token conversion", async () => {
        await icbmEtherToken.deposit({ from: disburser, value: Q18 });
        await prepareInvestor(investors[0], Q18.mul(100));
        await prepareInvestor(investors[1], Q18.mul(200));
        const tx = await icbmEtherToken.approveAndCall(feeDisbursal.address, Q18, "", {
          from: disburser,
        });
        tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
        // icbm ether token gets converted and we expect new etherToken
        expectLogDisbursalCreated(tx, neumark.address, etherToken.address, Q18, disburser);
      });

      it("disburse via approveAndCall with icbm euro token conversion", async () => {
        const icbmEuroToken = await deployICBMEuroTokenUniverse(
          universe,
          masterManager,
          masterManager,
        );
        await icbmEuroToken.deposit(disburser, Q18, { from: masterManager });
        await prepareInvestor(investors[0], Q18.mul(100));
        await prepareInvestor(investors[1], Q18.mul(200));
        // to convert euro token, fee disbursal must be deposit manager
        await accessPolicy.setUserRole(
          feeDisbursal.address,
          roles.eurtDepositManager,
          euroToken.address,
          TriState.Allow,
        );
        // fee disbursal must be able to receive old euro token
        await icbmEuroToken.setAllowedTransferTo(feeDisbursal.address, true, {
          from: masterManager,
        });
        await icbmEuroToken.setAllowedTransferFrom(feeDisbursal.address, true, {
          from: masterManager,
        });
        // await icbmEuroToken.setAllowedTransferFrom(disburser, true, {from: masterManager});
        // makes transferFrom internally
        const tx = await icbmEuroToken.approveAndCall(feeDisbursal.address, Q18, "", {
          from: disburser,
        });
        tx.logs = decodeLogs(tx, feeDisbursal.address, feeDisbursal.abi);
        // icbm euro token gets converted and we expect new euroToken
        expectLogDisbursalCreated(tx, neumark.address, euroToken.address, Q18, disburser);
      });
    });
  });
});
