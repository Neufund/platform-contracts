import { expect } from "chai";
import { increaseTime } from "../helpers/evmCommands";
import { createSignedVote } from "../helpers/relayedVoteSigning";
import { prettyPrintGasCost } from "../helpers/gasUtils";

export function testVotingWithSnapshots(getToken, getVotingContract, owner, owner2, relayer) {
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
      await expect(votingContract.addProposal()).to.be.rejectedWith(
        "Only one active proposal per address",
      );
    });
  });

  describe("While a proposal is open...", async () => {
    it("should allow everyone to give a vote weighted by their tokenBalance at proposalCreationTime", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();
      await token.transfer(owner2, 1000, { from: owner });

      const tx = await votingContract.vote(/* proposalId: */ 0, true, { from: owner });
      await prettyPrintGasCost("vote", tx);

      // NOTE the following part is replicated in many testCases so when actually writing all the tests
      // it would make sense to put this into a helper function
      // e.g. expectProposalTo(pass/fail, [{inFavor: x, against: y}]
      await increaseTime(24 * 60 * 60 * 4);
      const resultLog = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult" && log.args.hasPassed,
      );
      await expect(resultLog.args.inFavor).to.be.bignumber.eq(1000);
    });

    it("should reject attempts to vote twice", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();
      await votingContract.vote(/* proposalId: */ 0, true, { from: owner });
      await expect(votingContract.vote(0, true, { from: owner })).to.be.rejectedWith(
        "Address has already voted",
      );
    });

    it("should reject any votes based on tokens aquired after the proposal creation", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();
      await token.transfer(owner2, 1000, { from: owner });
      await expect(votingContract.vote(0, false, { from: owner2 })).to.be.rejectedWith(
        "Token balance at proposal time is zero",
      );
    });

    it("allows relayed votes", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();

      // create signed message that owner votes true on proposol 0 at the votingContract
      const { r, s, v } = await createSignedVote(0, true, owner, votingContract.address);

      // relayer relays the vote
      const tx = await votingContract.relayedVote(0, true, owner, r, s, v, { from: relayer });
      await prettyPrintGasCost("relayedVote", tx);

      // check that vote has been counted (a little redundant)
      await increaseTime(24 * 60 * 60 * 4);
      const resultLog = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult" && log.args.hasPassed,
      );
      await expect(resultLog.args.inFavor).to.be.bignumber.eq(1000);
    });

    it("allows relayed votes to be batched together", async () => {
      await token.deposit(1000);
      await token.transfer(owner2, 499, { from: owner });
      await votingContract.addProposal();
      await votingContract.addProposal({ from: owner2 });

      // create signed messages
      const sig01 = await createSignedVote(0, true, owner, votingContract.address);
      const sig02 = await createSignedVote(0, false, owner2, votingContract.address);
      const sig11 = await createSignedVote(1, false, owner, votingContract.address);

      // relayer relays batched votes
      const tx = await votingContract.batchRelayedVotes(
        [0, 0, 1],
        [true, false, false],
        [owner, owner2, owner],
        [sig01.r, sig02.r, sig11.r],
        [sig01.s, sig02.s, sig11.s],
        [sig01.v, sig02.v, sig11.v],
        { from: relayer },
      );
      await prettyPrintGasCost("batchedRelayedVote(3 votes)", tx);

      // check that vote has been counted (a little redundant)
      await increaseTime(24 * 60 * 60 * 4);
      const resultLog1 = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult" && log.args.proposalId.toNumber() === 0,
      );

      await expect(resultLog1.args.inFavor).to.be.bignumber.eq(501);
      await expect(resultLog1.args.against).to.be.bignumber.eq(499);

      const resultLog2 = (await votingContract.getResult(1)).logs.find(
        log => log.event === "LogProposalResult" && log.args.proposalId.toNumber() === 1,
      );
      await expect(resultLog2.args.against).to.be.bignumber.eq(501);
    });

    it("rejects relayed votes when arguments of the message are changed", async () => {
      await token.deposit(1000);
      await votingContract.addProposal();

      const sig = await createSignedVote(0, true, owner, votingContract.address);

      await expect(
        votingContract.relayedVote(0, false, owner, sig.r, sig.s, sig.v, { from: relayer }),
      ).to.be.rejectedWith("Incorrect order signature");
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
      await votingContract.vote(0, true, { from: owner });
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
      await votingContract.vote(0, false, { from: owner2 });
      await votingContract.vote(0, true, { from: owner });
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
      await votingContract.vote(0, true, { from: owner2 });

      await increaseTime(24 * 60 * 60 * 4);
      const resultLog = (await votingContract.getResult(0)).logs.find(
        log => log.event === "LogProposalResult",
      );
      await expect(resultLog.args.hasPassed).to.be.false;
    });

    it("reject subsequent attempts to report the result of a given proposal", async () => {});
  });
}
