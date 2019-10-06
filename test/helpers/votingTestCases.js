import { expect } from "chai";
import { increaseTime } from "../helpers/evmCommands";
import EvmError from "./EVMThrow";

export function testVotingWithSnapshots(getToken, getVotingContract, owner, owner2) {
  let token;
  let votingContract;

  beforeEach(() => {
    votingContract = getVotingContract();
    token = getToken();
  });

  describe("Opening Proposals:", () => {
    it("should allow to open a proposal", async () => {
      const addProposalLog = await votingContract.addProposal();
      await expect(addProposalLog.logs.find(log => log.event === "LogNewProposal")).to.not.be.empty;
    });
    it("should reject opening of more than one proposal per address", async () => {
      const addProposalLog = await votingContract.addProposal();
      await expect(addProposalLog.logs.find(log => log.event === "LogNewProposal")).to.not.be.empty;
      await expect(votingContract.addProposal()).to.be.rejectedWith(EvmError);
    });
  });

  describe("While a proposal is open...", async () => {
    it("should allow everyone to give a vote weighted by their tokenBalance at proposalCreationTime", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();
      await token.transfer(owner2, 1000, { from: owner });

      await votingContract.vote(/* proposalIndex: */ 0, true, { from: owner });
      await increaseTime(24 * 60 * 60 * 4);
      const resultLog = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult" && log.args.hasPassed,
      );
      await expect(resultLog.args.inFavor).to.be.bignumber.eq(1000);
    });

    it("should reject attempts to vote twice", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();
      await votingContract.vote(/* proposalIndex: */ 0, true, { from: owner });
      await expect(votingContract.vote(0, true, { from: owner })).to.be.rejectedWith(EvmError);
    });

    it("should reject any votes based on tokens aquired after the proposal creation", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();
      await token.transfer(owner2, 1000, { from: owner });
      await expect(votingContract.vote(0, false, { from: owner2 })).to.be.rejectedWith(EvmError);
    });

    it("should reject attempts to end the voting", async () => {});
  });

  describe("When the voting period is over...", async () => {
    it("should allow to end proposals", async () => {});
    it("should reject attempts to vote on them", async () => {});
    it("should allow the owner of the proposal to open up a new proposal", async () => {});

    it("reports a proposal as passed if the quorum was reached AND a majority voted in favor", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();
      await votingContract.vote(/* proposalIndex: */ 0, true, { from: owner });
      await increaseTime(24 * 60 * 60 * 4);
      const resultLog = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult",
      );
      await expect(resultLog.args.hasPassed).to.be.true;
    });

    it("reports a proposal as failed if the quorum was reached but the majority rejected it", async () => {});

    // Always good to pay extra attention to the boundary conditions:
    it("reports a proposal as failed if the quorum reached and there was a draw", async () => {
      await token.deposit(100);
      await token.transfer(owner2, 50, { from: owner });
      await votingContract.addProposal();
      await votingContract.vote(/* proposalIndex: */ 0, false, { from: owner2 });
      await votingContract.vote(/* proposalIndex: */ 0, true, { from: owner });
      await increaseTime(24 * 60 * 60 * 4);
      const resultLog = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult",
      );
      await expect(resultLog.args.hasPassed).to.be.false;
    });

    it("reports a proposal as failed if the quorum was not reached", async () => {
      await token.deposit(1000);
      await token.transfer(owner2, 100, { from: owner });

      await votingContract.addProposal();
      await votingContract.vote(/* proposalIndex: */ 0, true, { from: owner2 });

      await increaseTime(24 * 60 * 60 * 4);
      const resultLog = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult",
      );
      await expect(resultLog.args.hasPassed).to.be.false;
    });
  });
}
