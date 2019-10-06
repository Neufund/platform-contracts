import { expect } from "chai";
import { erc223TokenTests, deployTestErc223Callback } from "./helpers/tokenTestCases";
import { snapshotTokenTests } from "./helpers/snapshotTokenTestCases";
import { testVotingWithSnapshots } from "./helpers/votingTestCases";
import { ZERO_ADDRESS } from "./helpers/constants";
import { testTokenController } from "./helpers/tokenControllerTestCases";

const BigNumber = web3.BigNumber;
const TKN_DECIMALS = new BigNumber(10).toPower(18);

const TestSnapshotToken = artifacts.require("TestSnapshotToken");
const SimpleVote = artifacts.require("SimpleVote");

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

    describe("Voting With SnapshotToken", () => {
      let votingContract;
      beforeEach(async () => {
        votingContract = await SimpleVote.new(testSnapshotToken.address, 3);
      });
      const getVotingContract = () => votingContract;

      testVotingWithSnapshots(getToken, getVotingContract, owner, owner2);
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
});
