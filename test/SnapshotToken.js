import { expect } from "chai";
import { erc223TokenTests, deployTestErc223Callback } from "./helpers/tokenTestCases";
import { snapshotTokenTests } from "./helpers/snapshotTokenTestCases";
import { ZERO_ADDRESS, Q18, DAY_SNAPSHOT } from "./helpers/constants";
import increaseTime from "./helpers/increaseTime";
import { testTokenController } from "./helpers/tokenControllerTestCases";

const BigNumber = web3.BigNumber;
const TKN_DECIMALS = new BigNumber(10).toPower(18);

const TestSnapshotToken = artifacts.require("TestSnapshotToken");

contract("TestSnapshotToken", ([owner, owner2, broker, ...accounts]) => {
  let testSnapshotToken;

  beforeEach(async () => {
    testSnapshotToken = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
  });

  describe("IERC223Token tests", () => {
    const initialBalanceTkn = TKN_DECIMALS.mul(91279837.398827).round();
    const getToken = () => testSnapshotToken;
    let erc223cb;
    const getTestErc223cb = () => erc223cb;

    beforeEach(async () => {
      erc223cb = await deployTestErc223Callback();
      await getToken().deposit(initialBalanceTkn, { from: owner });
      await getToken().setAllowOnTransfer(true);
    });

    erc223TokenTests(getToken, getTestErc223cb, owner, accounts[0], initialBalanceTkn);
  });

  describe("ITokenSnapshots tests", () => {
    const getToken = () => testSnapshotToken;

    const advanceSnapshotId = async snapshotable => {
      await snapshotable.createSnapshot();
      // uncomment below for daily boundary snapshot
      // await increaseTime(24 * 60 * 60);
      return snapshotable.currentSnapshotId.call();
    };

    const createClone = async (parentToken, parentSnapshotId) =>
      TestSnapshotToken.new(parentToken.address, parentSnapshotId);

    describe("MTokenController", async () => {
      const getController = () => testSnapshotToken;
      const generate = async (amount, account) =>
        testSnapshotToken.deposit(amount, { from: account });
      const destroy = async (amount, account) =>
        testSnapshotToken.withdraw(amount, { from: account });

      testTokenController(
        getToken,
        getController,
        accounts[0],
        accounts[1],
        broker,
        generate,
        destroy,
      );
    });

    it("should call currentSnapshotId without transaction", async () => {
      const token = getToken();
      const initialSnapshotId = await token.currentSnapshotId.call();
      await token.createSnapshot.call();
      const snapshotId = await token.currentSnapshotId.call();
      expect(snapshotId).to.be.bignumber.eq(initialSnapshotId);
    });

    snapshotTokenTests(getToken, createClone, advanceSnapshotId, owner, owner2, broker);
  });

  describe("shift snapshot ids", () => {
    async function advanceSnapshotId() {
      await increaseTime(24 * 60 * 60);
      return testSnapshotToken.currentSnapshotId.call();
    }

    it("should track holders", async () => {
      let holders = await testSnapshotToken._allHolders();
      expect(holders.length).to.eq(0);
      await testSnapshotToken.deposit(Q18, { from: accounts[0] });
      holders = await testSnapshotToken._allHolders();
      expect(holders.length).to.eq(1);
      expect(holders[0]).to.eq(accounts[0]);
      await testSnapshotToken.deposit(Q18, { from: accounts[0] });
      holders = await testSnapshotToken._allHolders();
      expect(holders.length).to.eq(1);
      await testSnapshotToken.deposit(Q18, { from: accounts[1] });
      holders = await testSnapshotToken._allHolders();
      expect(holders.length).to.eq(2);
      expect(holders[1]).to.eq(accounts[1]);

      await testSnapshotToken.transfer(accounts[2], Q18, { from: accounts[1] });
      holders = await testSnapshotToken._allHolders();
      expect(holders.length).to.eq(3);
      expect(holders[2]).to.eq(accounts[2]);
    });

    it("should shift snapshots", async () => {
      const iId = await testSnapshotToken.currentSnapshotId.call();
      const firstId = await advanceSnapshotId();
      await testSnapshotToken.deposit(Q18, { from: accounts[0] });
      await testSnapshotToken.deposit(Q18, { from: accounts[1] });
      const secondId = await advanceSnapshotId();
      await testSnapshotToken.deposit(Q18, { from: accounts[3] });
      await testSnapshotToken.transfer(accounts[4], Q18.div("2"), { from: accounts[0] });
      const thirdId = await advanceSnapshotId();
      await testSnapshotToken.transfer(accounts[1], Q18.div("2"), { from: accounts[3] });

      // dump balances
      const snapshots = [iId, firstId, secondId, thirdId];
      const balances = [];

      async function balanceOfAt(idx, sid) {
        return testSnapshotToken.balanceOfAt(accounts[idx], sid);
      }

      for (let ii = 0; ii <= 4; ii += 1) {
        balances.push(await Promise.all(snapshots.map(sid => balanceOfAt(ii, sid))));
      }
      const supply = await Promise.all(snapshots.map(sid => testSnapshotToken.totalSupplyAt(sid)));

      // shift time
      expect(await testSnapshotToken.totalSupplyAt(iId)).to.be.bignumber.eq(0);
      // move by one daily snapshot
      await testSnapshotToken._decreaseSnapshots(DAY_SNAPSHOT);
      // should have 2*Q18 at initial supply after the shift
      expect(await testSnapshotToken.totalSupplyAt(iId)).to.be.bignumber.eq(Q18.mul(2));
      // compare balances with single shift in balances table
      for (let jj = 0; jj < snapshots.length - 1; jj += 1) {
        for (let ii = 0; ii <= 4; ii += 1) {
          expect(
            await testSnapshotToken.balanceOfAt(accounts[ii], snapshots[jj]),
          ).to.be.bignumber.eq(balances[ii][jj + 1]);
        }
        expect(await testSnapshotToken.totalSupplyAt(snapshots[jj])).to.be.bignumber.eq(
          supply[jj + 1],
        );
      }
      // another snapshot
      await testSnapshotToken._decreaseSnapshots(DAY_SNAPSHOT);
      expect(await testSnapshotToken.totalSupplyAt(iId)).to.be.bignumber.eq(Q18.mul(3));
      // check balance before initial snapshot
      const beforeiId = iId.sub(DAY_SNAPSHOT);
      expect(await testSnapshotToken.totalSupplyAt(beforeiId)).to.be.bignumber.eq(Q18.mul(2));
      expect(await testSnapshotToken.balanceOfAt(accounts[3], beforeiId)).to.be.bignumber.eq(0);
      // even earlier
      expect(
        await testSnapshotToken.balanceOfAt(accounts[0], beforeiId.sub(DAY_SNAPSHOT)),
      ).to.be.bignumber.eq(0);
    });
  });
});
