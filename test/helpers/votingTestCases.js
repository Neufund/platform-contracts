import { expect } from "chai";
import { latestTimestamp } from "./latestTime";
import increaseTime, { setTimeTo } from "./increaseTime";
import { createSignedVote } from "./relayedVoteSigning";
// import { prettyPrintGasCost } from "../helpers/gasUtils";
import { hasEvent } from "../helpers/events";
import {
  ZERO_ADDRESS,
  Q18,
  dayInSeconds,
  toBytes32,
  contractId,
  monthInSeconds,
  web3,
} from "./constants";

const MINIMUM_PUBLIC_VOTE_DURATION = 7;
const MINIMUM_CAMPAIGN_DURATION = 1;
const MINIMUM_TOTAL_VOTE_DURATION = 10;
const MINIMUM_OFFCHAIN_VOTE_DURATION = 7;
const defaultCampaignQuorumFraction = Q18.div(10)

let defaultProposalParams = {
  campaignDurationInDays: MINIMUM_CAMPAIGN_DURATION,
  campaignQuorumFraction: defaultCampaignQuorumFraction,
  votingPeriodInDays: MINIMUM_TOTAL_VOTE_DURATION,
  offchainVotingPeriodInDays: MINIMUM_OFFCHAIN_VOTE_DURATION,
  offchainVotesAsFraction: Q18.div(2)
};

const one = web3.toBigNumber("1");

const ProposalState = { Campaigning: 0, TimedOut: 1, Public: 2, Final: 3 };

export function testVotingWithSnapshots(getToken, getVotingContract, owner, owner2, relayer) {
  let token;
  let votingContract;

  beforeEach(async () => {
    votingContract = getVotingContract();
    token = getToken();
  });

  describe("Opening Proposals:", () => {
    it("should allow tokenholders to open a proposal", async () => {
      // const addProposalLog = await votingContract.addProposal();0
      const tx = await addProposal(votingContract);
      expect(hasEvent(tx, "LogNewProposal")).to.be.true;
    });

    it("Voting center initializes a vote and correctly stores all parameters", async () => {
      const tx = await addProposal(votingContract, { proposalId: "world peace" });
      let [
        campaignEndTime,
        campaignQuorumTokenAmount,
        endTime,
        offchainVoteEndTime,
        inFavor,
        against,
        proposal_owner,
        _,
        offchainVotesAsTokens,
        offchainVoteTallied,
        state,
      ] = await votingContract.proposal.call("world peace");

      // compute expected values
      const nowFromChain = web3.toBigNumber(await latestTimestamp());
      let expectedCampaignEnd =
        nowFromChain.add(defaultProposalParams.campaignDurationInDays * dayInSeconds);
      let expectedEndTime = nowFromChain.add(defaultProposalParams.votingPeriodInDays * dayInSeconds);
      let expectedOffchainVoteEndTime =
        expectedEndTime.add(defaultProposalParams.offchainVotingPeriodInDays * dayInSeconds);
      let totalTokens = web3.toBigNumber(await token.totalSupply())
      // voteFraction as tokens = totalSupply * fraction / (1 - fraction)
      let expectedOffchainWeightInTokens = (await token.totalSupply()).mul(defaultProposalParams.offchainVotesAsFraction) / one.sub(defaultProposalParams.offchainVotesAsFraction)
      
      expect(campaignEndTime.sub(expectedCampaignEnd).abs()).to.be.bignumber.lt(2);
      expect(campaignQuorumTokenAmount).to.be.bignumber.eq(
        totalTokens.mul(defaultProposalParams.campaignQuorumFraction).div(one)
      );
      expect(endTime.sub(expectedEndTime).abs()).to.be.bignumber.lt(2);
      expect(inFavor).to.be.bignumber.eq(0);
      expect(against).to.be.bignumber.eq(0);
      expect(proposal_owner).to.equal(owner);
      expect(offchainVoteEndTime.sub(expectedOffchainVoteEndTime)).to.be.bignumber.lt(2);
      expect(offchainVotesAsTokens).to.be.bignumber.eq(expectedOffchainWeightInTokens);
      expect(offchainVoteTallied).to.be.false;
      expect(state).to.be.bignumber.eq(ProposalState.Campaigning);
    });

    // NOTE do that test with the controller
    // it("should reject opening of more than one proposal per address", async () => {
    //   const tx = await addProposal(votingContract, { proposalId: "world peace" });
    //   expect(hasEvent(tx, "LogNewProposal")).to.be.true;
    //   // const tx2 = await addProposal(votingContract, {proposalId: "World peace"})
    //   await expect(addProposal(votingContract, { proposalId: "Free Lunch" })).to.be.rejectedWith(
    //     "Only one active proposal per address",
    //   );
    // });

    it("should reject opening proposal with bad parameters", async () => {
      // non-unique proposalId
      await addProposal(votingContract, { proposalId: "world peace", from: owner2 });
      await expect(addProposal(votingContract, { proposalId: "world peace" })).to.be.rejectedWith(
        "Proposal must have a unique proposalId",
      );

      // campaigns with too short campaign
      // TODO figure out why this config does not fail!!
      // await expect(addProposal(votingContract, {
      //   campaignDurationInDays: defaultProposalParams.campaignDurationInDays - 1
      // })).to.be.rejectedWith( "There must be at least one day for campaigning");

      // campaign-quorum not a valid fraction
      await expect(
        addProposal(votingContract, {
          campaignQuorumFraction: Q18 + 1,
        }),
      ).to.be.rejectedWith("Quorum for campaing must be nonzero and less than 100");

      // too short overall duration
      await expect(
        addProposal(votingContract, {
          votingPeriodInDays: defaultProposalParams.votingPeriodInDays - 1,
        }),
      ).to.be.rejectedWith("Voting period must be at least ten days");

      // too short public duration
      await expect(
        addProposal(votingContract, {
          campaignDurationInDays: MINIMUM_PUBLIC_VOTE_DURATION,
          votingPeriodInDays: 2 * MINIMUM_PUBLIC_VOTE_DURATION - 1,
        }),
      ).to.be.rejectedWith("There must be at least one week for public voting");

      // too short offchainVotePeriod
      await expect(
        addProposal(votingContract, {
          offchainVotingPeriodInDays: defaultProposalParams.offchainVotingPeriodInDays - 1,
        }),
      ).to.be.rejectedWith("OffchainVotePeriod must be at least a week");

      // TODO with controller
      // owner does not hold token
      // on non-whitelisted Tokens
      // wrong legalRep for a given Token

      // offchainVotesAsFraction > 1 
      await expect(
        addProposal(votingContract, {
          offchainVotesAsFraction: Q18 + 1 
        }),
      ).to.be.rejectedWith("Offchain votes too powerful");
    });
  });

  describe("While a proposal is open...", async () => {
    const freeLunch ="0x02";
    beforeEach( async () => {
      await token.deposit(1000);
      await addProposal(votingContract, { proposalId: freeLunch, from: owner2});
    });

    it("should allow everyone to give a vote weighted by their tokenBalance at proposalCreationTime", async () => {
      // distribute some funds to owner2, create proposal, then transfer even more
      await token.transfer(owner2, 300, { from: owner , proposalId: "something"});
      await addProposal(votingContract, { proposalId: "something" });
      await token.transfer(owner2, 700, { from: owner });

      await votingContract.vote("something", true, { from: owner });
      await votingContract.vote("something", false, { from: owner2 });

      // verify outcome matches balances at proposal creation
      await increaseTime(defaultProposalParams.votingPeriodInDays * 9 * dayInSeconds);
      await expectProposalOutcome(votingContract, "something", 700, 300);
    });

    it("should reject attempts to vote twice", async () => {
      await votingContract.vote(freeLunch, true, { from: owner });
      await expect(votingContract.vote(freeLunch, true, { from: owner })).to.be.rejectedWith(
        "Address has already voted",
      );
    });

    it("should reject any votes based on tokens aquired after the proposal creation", async () => {
      await token.transfer(owner2, 1000, { from: owner });
      await expect(votingContract.vote(freeLunch, false, { from: owner2 })).to.be.rejectedWith(
        "Token balance at proposal time is zero",
      );
    });

    it("allows relayed (gasless) votes", async () => {
      const { r, s, v } = await createSignedVote(freeLunch, true, owner, votingContract.address);
      const tx = await votingContract.relayedVote(freeLunch, true, owner, r, s, v, { from: relayer });

      await increaseTime(defaultProposalParams.votingPeriodInDays * 9 * dayInSeconds);
      await expectProposalOutcome(votingContract, freeLunch, 1000, 0);
    });

    it("allows relayed votes to be batched together", async () => {
      // create another proposal where somebody else can vote too
      await token.transfer(owner2, 499, { from: owner });
      await addProposal(votingContract, { proposalId: "0x01" });

      // create signed messages
      const sig1 = await createSignedVote(freeLunch, true, owner, votingContract.address);
      const sig2 = await createSignedVote("0x01", true, owner, votingContract.address);
      const sig3 = await createSignedVote("0x01", false, owner2, votingContract.address);

      // relayer relays batched votes
      const tx = await votingContract.batchRelayedVotes(
        [freeLunch, "0x01", "0x01"],
        [true, true, false],
        [owner, owner, owner2],
        [sig1.r, sig2.r, sig3.r],
        [sig1.s, sig2.s, sig3.s],
        [sig1.v, sig2.v, sig3.v],
        { from: relayer },
      );

      await increaseTime(defaultProposalParams.votingPeriodInDays * 9 * dayInSeconds);
      await expectProposalOutcome(votingContract, freeLunch, 1000, 0);
      await expectProposalOutcome(votingContract, "0x01", 501, 499);
    });

    it("rejects relayed votes when arguments of the message are changed", async () => {
      const sig = await createSignedVote(freeLunch, true, owner, votingContract.address);
      await expect(
        votingContract.relayedVote(freeLunch, false, owner, sig.r, sig.s, sig.v, { from: relayer }),
      ).to.be.rejectedWith("Incorrect order signature");
    });

    it("reject attempts to read the outcome before all votes are in", async () => {
      await votingContract.vote(freeLunch, true, { from: owner });
      await expect(votingContract.getOutcome(freeLunch)).to.be.rejectedWith(
        "Vote is ongoing",
      );
    });

    it("should allow offchain-votes to be submitted", async () => {
      let fractionInFavor = one.mul(4).div(5);
      let fractionAgainst = one.div(5);

      await votingContract.addOffchainVote(
        freeLunch,
        fractionInFavor,
        fractionAgainst,
      );

      // check that vote has been counted
      let offchainVotesAsTokens = web3.toBigNumber(await votingContract.proposal(freeLunch)[8]);

      await increaseTime(defaultProposalParams.votingPeriodInDays * 9 * dayInSeconds);
      await expectProposalOutcome(
        votingContract,
        freeLunch,
        offchainVotesAsTokens.mul(fractionInFavor).div(Q18),
        offchainVotesAsTokens.mul(fractionAgainst).div(Q18),
      );
    });

    it("should require offchainVotes too weighted within proposal parameters", async () => {
      await expect(
        votingContract.addOffchainVote(freeLunch, defaultProposalParams.offchainVotesAsFraction+ 1, 0)
      ).to.be.rejectedWith("Too much weight");
    });
  });

  describe("Campaign phase", async () => {
    const freeSnacks ="0x03";
    beforeEach( async () => {
      await token.deposit(1000)
      await addProposal(votingContract, { proposalId: freeSnacks, from: owner2});
    });

    it("reaching the campaign-quorum before the campaign's end time logs an event", async () => {
      const tx = await votingContract.vote(freeSnacks, true, { from: owner });
      expect(hasEvent(tx, "LogReachedCampaignQuorum")).to.be.true;
    });

    it("not reaching the campaign-quorum before the campaign's end prevents further votes", async () => {
      await increaseTime(defaultProposalParams.campaignDurationInDays * dayInSeconds + 2);
      await expect(votingContract.vote(freeSnacks, true, { from: owner })).to.be.rejectedWith(
        "Proposal has not passed campaign state",
      );
    });

    it("An unsuccessful campaign can be finalized immediately and the owner can start a new one ", async () => {
      // TODO when marcin agrees this is the way to go
    });

    it("An unsuccessful campaign's vote outcome can be queried", async () => {
      await increaseTime(defaultProposalParams.campaignDurationInDays * dayInSeconds + 42);
      await votingContract.finalizeProposal(freeSnacks)
      await expectProposalOutcome(votingContract, freeSnacks, 0, 0);
    });
  });

  describe("When the public voting period is over...", async () => {
    beforeEach(async () => {
      // create proposal and make it pass campaign-phase by voting from owner with minimal
      await token.deposit(1000, {from: owner}) 
      await token.transfer(owner2, 100, { from: owner });
      await addProposal(votingContract, {proposalId: 'Free Dinner'})
      await votingContract.vote("Free Dinner", true, { from: owner2 });
      await increaseTime(defaultProposalParams.votingPeriodInDays * dayInSeconds + 42);
    });

    it("should reject attempts from tokenholders to vote on them", async () => {
      await expect(votingContract.vote("Free Dinner", true, { from: owner })).to.be.rejectedWith(
        "Public voting period is over",
      );
    });
    
    it("offchain votes can still be entered", async () => {
      await votingContract.addOffchainVote("Free Dinner", 0, Q18)
     let offchainVotesAsTokens = (await votingContract.proposal("Free Dinner"))[8];
      await expectProposalOutcome(
        votingContract, "Free Dinner",
        100,
        offchainVotesAsTokens.toNumber(),
      );
  });

  it("offchain votes will be rejected if the campaign was unsuccessful", async () => {
      await addProposal(votingContract, { proposalId: "Free Peanuts", from: owner2});
      await increaseTime(defaultProposalParams.votingPeriodInDays * dayInSeconds + 42);
      await expect(
        votingContract.addOffchainVote("Free Peanuts", Q18, 0)
      ).to.be.rejectedWith("Proposal has not passed campaign state");


  })
    it("offchain votes will rejected from other addresses", async () => {
      // TODO with VoteController
    });
    it("offchain must be entered within time-limit", async () => {
      await increaseTime(defaultProposalParams.offchainVotingPeriodInDays * dayInSeconds + 42);
      await expect(
        votingContract.addOffchainVote("Free Dinner", Q18, 0)
      ).to.be.rejectedWith("Offchain-vote period is over");
    });

    it("offchain votes are final and can not be changed", async () => {
      await votingContract.addOffchainVote("Free Dinner", Q18, 0)
      await expect(
        votingContract.addOffchainVote("Free Dinner", Q18, 0)
      ).to.be.rejectedWith("Offchain votes already taken into account");
    });
});

    describe("When no more votes can be entered ", async () => {
      it("anyone can finalize proposals")
      it("Anyonce can get the outcome of the result ")
    });

    describe("When the proposal is finalized", async () => {
      const freeDesert ="0x02";
      it("should log an event", async () => {
        await addProposal(votingContract, { proposalId: freeDesert, from: owner2});
        await increaseTime(defaultProposalParams.offchainVotingPeriodInDays * 3 * dayInSeconds + 42);
        const tx = await votingContract.finalizeProposal(freeDesert)
        expect(hasEvent(tx, "LogProposalResult")).to.be.true;
      });
      
      // TODO maybe do it with the Controller
      it("should allow the owner of the proposal to open up a new proposal")
      it("reject subsequent to finalize a gives proposal") 
    });
}

function createRandomBytes() {
  return Math.random()
    .toString(36)
    .substring(2, 15);
}

async function addProposal(votingContract, params = {}) {
  return await votingContract.addProposal(
    params.proposalId || createRandomBytes(),
    params.campaignDurationInDays || defaultProposalParams.campaignDurationInDays,
    params.campaignQuorumFraction || defaultProposalParams.campaignQuorumFraction,
    params.votingPeriodInDays || defaultProposalParams.votingPeriodInDays,
    params.offchainVotingPeriodInDays || defaultProposalParams.offchainVotingPeriodInDays,
    params.offchainVotesAsFraction|| defaultProposalParams.offchainVotesAsFraction,
    params.from ? { from: params.from } : {},
  );
}

async function expectProposalOutcome(votingContract, proposalId, inFavor, against) {
  let [pInFavor, pAgainst, _] = await votingContract.getOutcome(proposalId);
  expect(pInFavor).to.be.bignumber.eq(inFavor);
  expect(pAgainst).to.be.bignumber.eq(against);
}
