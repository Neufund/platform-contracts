import { expect } from "chai";
import { createSignedVote } from "./helpers/relayedVoteSigning";
import { ZERO_ADDRESS, Q18, daysToSeconds, dayInSeconds } from "./helpers/constants";
import { divRound } from "./helpers/unitConverter";
import { randomBytes32, contractId } from "./helpers/utils";
import {
  deployVotingCenter,
  deployUniverse,
  deployNeumarkUniverse,
} from "./helpers/deployContracts";
import { ProposalState, VotingTriState } from "./helpers/voting";
import { prettyPrintGasCost, printCodeSize } from "./helpers/gasUtils";
import { txTimestamp } from "./helpers/latestTime";
import increaseTime from "./helpers/increaseTime";
import { decodeLogs, hasEvent, eventValue, eventValueAtIndex } from "./helpers/events";
import { knownInterfaces } from "./helpers/knownInterfaces";
import roles from "./helpers/roles";
import createAccessPolicy from "./helpers/createAccessPolicy";

const TestSnapshotToken = artifacts.require("TestSnapshotToken");
const TestVotingObserver = artifacts.require("TestVotingObserver");
const TestVotingController = artifacts.require("TestVotingController");
const VotingController = artifacts.require("VotingController");
const VotingCenter = artifacts.require("VotingCenter");
const MockVotingCenter = artifacts.require("MockVotingCenter");

const bn = n => new web3.BigNumber(n);
const one = bn("1");
const zero = bn("0");

const TOTAL_VOTE_DURATION = daysToSeconds(10);
const OFFCHAIN_VOTE_DURATION = daysToSeconds(7);

contract("VotingCenter", ([_, admin, owner, owner2, votingLegalRep, ...accounts]) => {
  let votingContract;
  let votingController;
  let token;
  let universe;
  let accessPolicy;

  // this must correspond to order of parameters of VotingCenter:addProposal
  const noCampaignProposalParams = {
    proposalId: null,
    token: null,
    campaignDuration: zero,
    campaignQuorumFraction: zero,
    votingPeriod: bn(TOTAL_VOTE_DURATION),
    votingLegalRep,
    offchainVotePeriod: bn(OFFCHAIN_VOTE_DURATION),
    offchainVotingPower: Q18.div("5"),
    action: one,
    // "PAYLOAD"
    actionPayload: "0x5041594c4f4144",
    enableObserver: false,
  };

  const campaignProposalParams = Object.assign({}, noCampaignProposalParams, {
    campaignDuration: bn(daysToSeconds(2)),
    campaignQuorumFraction: Q18.mul("0.1"),
  });
  const campaignNoOffchainParams = Object.assign({}, noCampaignProposalParams, {
    campaignDuration: bn(daysToSeconds(2)),
    campaignQuorumFraction: Q18.mul("0.1"),
    offchainVotePeriod: zero,
    offchainVotingPower: zero,
    votingLegalRep: ZERO_ADDRESS,
  });
  const noVotingPeriodParams = Object.assign({}, noCampaignProposalParams, {
    votingPeriod: zero,
    offchainVotePeriod: zero,
    offchainVotingPower: zero,
    votingLegalRep: ZERO_ADDRESS,
  });
  const noCampaignNoOffchainParams = Object.assign({}, noCampaignProposalParams, {
    offchainVotePeriod: zero,
    offchainVotingPower: zero,
    votingLegalRep: ZERO_ADDRESS,
  });
  const noCampaignWithObserver = Object.assign({}, noCampaignProposalParams, {
    enableObserver: true,
  });
  const noCampaignNoOffchainWithObserver = Object.assign({}, noCampaignNoOffchainParams, {
    enableObserver: true,
  });

  beforeEach(async () => {
    [universe] = await deployUniverse(admin, admin);
    token = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
    [votingContract, votingController] = await deployVotingCenter(
      TestVotingController,
      universe,
      admin,
    );
  });

  it("should deploy", async () => {
    await prettyPrintGasCost("VotingCenter deploy", votingContract);
    await printCodeSize("VotingCenter code size", votingContract);
    expect(await votingContract.votingController()).to.eq(votingController.address);
    expect(await votingContract.contractId()).to.deep.eq([contractId("IVotingCenter"), zero]);
  });

  it("should shift time on mock", async () => {
    // deploy mock in place of regular contract
    votingContract = await MockVotingCenter.new(votingController.address);
    // open proposal
    const proposalId = randomBytes32();
    await issueTokens(2);
    const proposal = await openProposal(proposalId, noCampaignProposalParams);
    const deadlines = proposal[10];
    // shift time one day
    await votingContract._shiftProposalDeadlines(proposalId, dayInSeconds);
    const shiftedProposal = await votingContract.proposal(proposalId);
    const shiftedDeadlines = shiftedProposal[10];
    for (let ii = 0; ii < 5; ii += 1) {
      expect(deadlines[ii].sub(shiftedDeadlines[ii])).to.be.bignumber.eq(dayInSeconds);
    }
  });

  describe("opening proposals", () => {
    it("should allow to open a proposal in public", async () => {
      const proposalId = randomBytes32();
      await issueTokens(2);
      expect(await votingContract.hasProposal(proposalId)).to.be.false;
      const proposal = await openProposal(proposalId, noCampaignProposalParams);
      expect(proposal[0]).to.be.bignumber.eq(ProposalState.Public);
      expect(proposal[3]).to.eq(owner);
      expect(await votingContract.hasProposal(proposalId)).to.be.true;
    });

    it("should allow to open a proposal in campaign", async () => {
      const proposalId = randomBytes32();
      await issueTokens(2);
      const proposal = await openProposal(proposalId, campaignProposalParams);
      expect(proposal[0]).to.be.bignumber.eq(ProposalState.Campaigning);
      expect(proposal[3]).to.eq(owner);
    });

    it("rejects on token without voting power", async () => {
      const proposalId = randomBytes32();
      await expect(openProposal(proposalId, noCampaignProposalParams)).to.be.rejectedWith(
        "NF_VC_EMPTY_TOKEN",
      );
    });

    it("should seal token snapshot", async () => {
      const proposalId = randomBytes32();
      await issueTokens(2);
      const proposal = await openProposal(proposalId, campaignProposalParams);
      const snapshotId = proposal[2];
      const snapshotSupply = await token.totalSupplyAt(snapshotId);
      await token.deposit(Q18);
      // supply cannot change
      expect(await token.totalSupplyAt(snapshotId)).to.be.bignumber.eq(snapshotSupply);
    });

    it("should open and finalize proposal with no voting period", async () => {
      const proposalId = randomBytes32();
      await issueTokens(2);
      await openProposal(proposalId, noVotingPeriodParams);
      const timedProposal = await votingContract.timedProposal(proposalId);
      expect(timedProposal[0]).to.be.bignumber.eq(ProposalState.Final);
    });

    it("should open many proposals", async () => {
      await issueTokens(2);
      // two proposals on the same token from the same initator
      await openProposal(randomBytes32(), campaignProposalParams);
      await openProposal(randomBytes32(), campaignProposalParams);

      // another proposal from different initator
      const proposal1 = await openProposal(randomBytes32(), campaignProposalParams, {
        from: owner2,
      });
      expect(proposal1[3]).to.eq(owner2);

      // another proposal from new token
      token = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
      await issueTokens(3);
      const proposal2 = await openProposal(randomBytes32(), campaignProposalParams, {
        from: owner2,
      });
      expect(proposal2[3]).to.eq(owner2);
      expect(proposal2[1]).to.eq(token.address);
    });

    it("rejects opening proposal with invalid parameters", async () => {
      await issueTokens(3);
      // non-unique proposalId
      await addProposal(votingContract, "world peace", campaignProposalParams);
      await expect(
        addProposal(votingContract, "world peace", noCampaignProposalParams),
      ).to.be.rejectedWith("NF_VC_P_ID_NON_UNIQ");

      const proposalId = randomBytes32();
      // campaigns with too short campaign
      const tooLongCampaign = Object.assign({}, campaignProposalParams, {
        campaignDuration: bn(TOTAL_VOTE_DURATION).add(1),
      });
      await expect(addProposal(votingContract, proposalId, tooLongCampaign)).to.be.rejectedWith(
        "NF_VC_CAMPAIGN_OVR_TOTAL",
      );

      // campaign-quorum not a valid fraction
      const invCQ = Object.assign({}, campaignProposalParams, {
        campaignQuorumFraction: Q18.add(1),
      });
      await expect(addProposal(votingContract, proposalId, invCQ)).to.be.rejectedWith(
        "NF_VC_INVALID_CAMPAIGN_Q",
      );

      // campaign data if present must be all
      const invCamp = Object.assign({}, campaignProposalParams, { campaignQuorumFraction: zero });
      await expect(addProposal(votingContract, proposalId, invCamp)).to.be.rejectedWith(
        "NF_VC_CAMP_INCONSISTENT",
      );

      // offchain tally data must be all if voting power set
      const invOffchain = Object.assign({}, noVotingPeriodParams, {
        offchainVotingPower: Q18.div("4"),
        votingLegalRep,
      });
      await expect(addProposal(votingContract, proposalId, invOffchain)).to.be.rejectedWith(
        "NF_VC_TALLY_INCONSISTENT",
      );
    });

    describe("with voting controller", () => {
      beforeEach(async () => {
        [universe, accessPolicy] = await deployUniverse(admin, admin);
        token = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
        [votingContract, votingController] = await deployVotingCenter(
          VotingController,
          universe,
          admin,
        );
        expect(await votingController.contractId()).to.deep.eq([
          contractId("IVotingController"),
          zero,
        ]);
      });

      async function registerToken() {
        // make it equity token
        await universe.setCollectionInterface(
          knownInterfaces.equityTokenInterface,
          token.address,
          true,
          {
            from: admin,
          },
        );
      }

      async function registerInitiatorInterface(initiator) {
        // make it equity token controller
        await universe.setCollectionInterface(
          knownInterfaces.equityTokenControllerInterface,
          initiator,
          true,
          {
            from: admin,
          },
        );
      }

      async function registerInitatorRole(initiator, object) {
        // add voting initator role over voting center
        await createAccessPolicy(accessPolicy, [
          { subject: initiator, role: roles.votingInitiator, object },
        ]);
      }

      it("should register proposal with initator interface", async () => {
        const proposalId = randomBytes32();
        await issueTokens(2);
        await registerToken();
        await registerInitiatorInterface(owner);
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.true;
        const proposal = await openProposal(proposalId, noCampaignProposalParams);
        expect(proposal[0]).to.be.bignumber.eq(ProposalState.Public);
      });

      it("should register proposal with initator role", async () => {
        const proposalId = randomBytes32();
        await issueTokens(2);
        await registerToken();
        // must give global rights as controller checks msg.sender
        await registerInitatorRole(owner, ZERO_ADDRESS);
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.true;
        // still proposal will open on voting center scope
        await registerInitatorRole(owner2, votingContract.address);
        expect(await votingController.onAddProposal(proposalId, owner2, token.address)).to.be.false;
        const proposal = await openProposal(proposalId, noCampaignProposalParams, { from: owner2 });
        expect(proposal[0]).to.be.bignumber.eq(ProposalState.Public);
      });

      it("should register proposal with Neumark", async () => {
        token = await deployNeumarkUniverse(universe, admin);
        // add neumark roles
        await createAccessPolicy(accessPolicy, [
          { subject: accounts[0], role: roles.neumarkIssuer },
          {
            subject: admin,
            role: roles.platformOperatorRepresentative,
          },
        ]);
        await token.amendAgreement("AGREEMENT", { from: admin });
        // create some balance
        await token.issueForEuro(Q18, { from: accounts[0] });
        // close snapshot
        await increaseTime(daysToSeconds(1));
        // open proposal
        await registerInitiatorInterface(owner);
        const proposalId = randomBytes32();
        // now the voting controller cached invalid neumark so recreate
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.false;
        [votingContract, votingController] = await deployVotingCenter(
          VotingController,
          universe,
          admin,
        );
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.true;
        const proposal = await openProposal(proposalId, noCampaignProposalParams);
        // where token is neumark
        expect(proposal[1]).to.eq(token.address);
      });

      it("rejects proposal for unsupported token", async () => {
        const proposalId = randomBytes32();
        await issueTokens(2);
        await registerInitiatorInterface(owner);
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.false;
        await expect(openProposal(proposalId, noCampaignProposalParams)).to.be.rejectedWith(
          "NF_VC_CTR_ADD_REJECTED",
        );
        await registerToken();
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.true;
        await openProposal(proposalId, noCampaignProposalParams);
      });

      it("rejects proposal from unsupported initiator", async () => {
        const proposalId = randomBytes32();
        await issueTokens(2);
        await registerToken();
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.false;
        await expect(openProposal(proposalId, noCampaignProposalParams)).to.be.rejectedWith(
          "NF_VC_CTR_ADD_REJECTED",
        );
        await registerInitiatorInterface(owner);
        expect(await votingController.onAddProposal(proposalId, owner, token.address)).to.be.true;
        await openProposal(proposalId, noCampaignProposalParams);
      });

      it("should change voting controller", async () => {
        const proposalId = randomBytes32();
        await issueTokens(2);
        await registerInitiatorInterface(owner);
        await expect(openProposal(proposalId, noCampaignProposalParams)).to.be.rejectedWith(
          "NF_VC_CTR_ADD_REJECTED",
        );
        // add owner2 to voting center manager role
        await createAccessPolicy(accessPolicy, [
          { subject: owner2, role: roles.votingCenterManager },
        ]);
        // deploy test controller which shares same contractId
        const testController = await TestVotingController.new(universe.address);
        // swap controllers
        expect(await votingController.onChangeVotingController(owner2, testController.address)).to
          .be.true;
        // owner lacks role to swap so false
        expect(await votingController.onChangeVotingController(owner, testController.address)).to.be
          .false;
        // voting contract has invalid contract id so false
        expect(await votingController.onChangeVotingController(owner2, votingContract.address)).to
          .be.false;
        const tx = await votingContract.changeVotingController(testController.address, {
          from: owner2,
        });
        expectLogChangeVotingController(
          tx,
          votingController.address,
          testController.address,
          owner2,
        );
        // test controller does not check anything so proposal will open
        await openProposal(proposalId, noCampaignProposalParams);
      });

      it("rejects change voting controller not from the role", async () => {
        const testController = await TestVotingController.new(universe.address);
        await expect(
          votingContract.changeVotingController(testController.address, { from: owner2 }),
        ).to.be.rejectedWith("NF_VC_CHANGING_CTR_REJECTED");
      });
    });
  });

  describe("campaign phase", async () => {
    let proposalId;
    let proposal;
    let holders;

    beforeEach(async () => {
      // test works only with fraction below
      expect(campaignNoOffchainParams.campaignQuorumFraction).to.be.bignumber.eq(Q18.mul("0.1"));
      holders = {};
      holders[accounts[0]] = Q18.mul("0.1").sub(1);
      holders[accounts[1]] = one;
      holders[accounts[2]] = Q18.mul("0.9");
      await issueTokensToHolders(holders);
      expect(await token.totalSupply()).to.be.bignumber.eq(Q18);
      // open proposal
      proposalId = randomBytes32();
      // campaignNoOffchainParams used for simple campaign quorum calculation, off chain votes not included
      proposal = await openProposal(proposalId, campaignNoOffchainParams);
    });

    it("reaching the campaign-quorum before the campaign's end time logs an event and shifts deadlines", async () => {
      // pass some time
      await increaseTime(daysToSeconds(1));
      // first vote is one wei below quorum
      let tx = await votingContract.vote(proposalId, true, { from: accounts[0] });
      expectLogVoteCast(tx, proposalId, owner, accounts[0], true, holders[accounts[0]]);
      expect(hasEvent(tx, "LogProposalStateTransition")).to.be.false;
      // second vote reaches quorum exactly
      tx = await votingContract.vote(proposalId, true, { from: accounts[1] });
      expectLogProposalStateTransition(
        tx,
        proposalId,
        owner,
        ZERO_ADDRESS,
        ProposalState.Campaigning,
        ProposalState.Public,
      );
      // deadlines for next states must be shorter by elapsed campaign time
      const timedProposal = await votingContract.timedProposal(proposalId);
      const transitionTs = await txTimestamp(tx);
      const initalDeadlines = proposal[10];
      const publicDeadlines = timedProposal[10];
      const delta = initalDeadlines[1].sub(transitionTs);
      for (let ii = 1; ii < initalDeadlines.length; ii += 1) {
        expect(initalDeadlines[ii].sub(delta)).to.be.bignumber.eq(publicDeadlines[ii]);
      }
      // check start of public phase to be transition tx block time
      expect(publicDeadlines[1]).to.be.bignumber.eq(transitionTs);
      // check duration of public phase didn't change - just shifted
      expect(publicDeadlines[2]).to.be.bignumber.eq(
        campaignProposalParams.votingPeriod
          .add(transitionTs)
          .sub(campaignProposalParams.campaignDuration),
      );
    });

    it("not reaching the campaign-quorum before the campaign's end finalizes campaign silently", async () => {
      // pass some time
      await increaseTime(daysToSeconds(1));
      // not enough to pass quorum
      await votingContract.vote(proposalId, true, { from: accounts[0] });
      // another day will end campaign
      await increaseTime(daysToSeconds(1));
      const timedProposal = await votingContract.timedProposal(proposalId);
      expect(timedProposal[0]).to.be.bignumber.eq(ProposalState.Final);
      // execute pending time transitions
      const tx = await votingContract.handleStateTransitions(proposalId);
      expect(hasEvent(tx, "LogProposalStateTransition")).to.be.false;
      const finalProposal = await votingContract.proposal(proposalId);
      expect(finalProposal).to.deep.eq(timedProposal);
    });

    it("reject campaign when token voting power less than campaign quorum", async () => {
      const params = Object.assign({}, campaignProposalParams, {
        offchainVotingPower: Q18.add(1),
        campaignQuorumFraction: Q18.mul("0.5"),
      });
      await expect(openProposal(randomBytes32(), params)).to.be.rejectedWith(
        "NF_VC_NO_CAMP_VOTING_POWER",
      );
      const passableParams = Object.assign({}, params, { offchainVotingPower: Q18 });
      await openProposal(randomBytes32(), passableParams);
    });
  });

  describe("Public voting phase", () => {
    let proposalId;
    let holders;

    beforeEach(async () => {
      holders = {};
      holders[accounts[0]] = Q18.mul("0.1").sub(1);
      holders[accounts[1]] = one;
      holders[accounts[2]] = Q18.mul("0.44");
      holders[accounts[3]] = Q18.mul("0.01");
      holders[accounts[4]] = Q18.mul("0.45");
      await issueTokensToHolders(holders);
      expect(await token.totalSupply()).to.be.bignumber.eq(Q18);
      // open proposal
      proposalId = randomBytes32();
      await openProposal(proposalId, noCampaignProposalParams);
    });

    it("should return correct voting power", async () => {
      expect(await votingContract.getVotingPower(proposalId, accounts[0])).to.be.bignumber.eq(
        holders[accounts[0]],
      );
      expect(await votingContract.getVotingPower(proposalId, accounts[2])).to.be.bignumber.eq(
        holders[accounts[2]],
      );
      expect(await votingContract.getVotingPower(proposalId, owner2)).to.be.bignumber.eq(zero);
      await expect(votingContract.getVotingPower("free lunch", owner2)).to.be.rejectedWith(
        "NF_VC_PROP_NOT_EXIST",
      );
    });

    it("should allow tokenholders to vote with power as in their tokenBalance at proposal creation snapshot", async () => {
      let vtx = await votingContract.vote(proposalId, true, { from: accounts[0] });
      let [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        zero,
        zero,
        holders[accounts[0]],
        true,
      );
      vtx = await votingContract.vote(proposalId, false, { from: accounts[2] });
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[2]],
        false,
      );
      vtx = await votingContract.vote(proposalId, false, { from: accounts[3] });
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[3]],
        false,
      );
      vtx = await votingContract.vote(proposalId, true, { from: accounts[4] });
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[4]],
        true,
      );
      expect(favor.add(contra)).to.be.bignumber.eq(Q18.sub(1));

      // move time cast last vote
      vtx = await votingContract.vote(proposalId, true, { from: accounts[1] });
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[1]],
        true,
      );
      expect(favor.add(contra)).to.be.bignumber.eq(Q18);
    });

    it("rejects attempts to vote twice", async () => {
      await votingContract.vote(proposalId, true, { from: accounts[0] });
      await expect(
        votingContract.vote(proposalId, false, { from: accounts[0] }),
      ).to.be.rejectedWith("NF_VC_ALREADY_VOTED");
    });

    it("ignores vote if not holding token", async () => {
      // votingLegalRep does not hold tokens
      const tx = await votingContract.vote(proposalId, true, { from: votingLegalRep });
      expect(hasEvent(tx, "LogVoteCast")).to.be.false;
    });

    it("rejects voting power based on tokens aquired after the proposal creation", async () => {
      await token.transfer(accounts[1], Q18.mul("0.05"), { from: accounts[0] });
      // votes must verify to snapshot
      let vtx = await votingContract.vote(proposalId, true, { from: accounts[0] });
      const [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        zero,
        zero,
        holders[accounts[0]],
        true,
      );
      vtx = await votingContract.vote(proposalId, false, { from: accounts[1] });
      await verifyVote(vtx, proposalId, favor, contra, holders[accounts[1]], false);
    });

    it("rejects voting on non-existing proposal", async () => {
      await expectProposalRevertOnAllVotingMethods("free lunch", "NF_VC_PROP_NOT_EXIST");
    });

    it("allows relayed (gasless) votes", async () => {
      // holder 0
      let sig = await createSignedVote(proposalId, true, accounts[0], votingContract.address);
      const isSigValid = await votingContract.isValidSignature(
        proposalId,
        true,
        accounts[0],
        ...sig,
      );
      expect(isSigValid).to.be.true;
      let vtx = await votingContract.relayedVote(proposalId, true, accounts[0], ...sig, {
        from: admin,
      });
      let [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        zero,
        zero,
        holders[accounts[0]],
        true,
        accounts[0],
      );

      // holder 2
      sig = await createSignedVote(proposalId, false, accounts[2], votingContract.address);
      vtx = await votingContract.relayedVote(proposalId, false, accounts[2], ...sig);
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[2]],
        false,
        accounts[2],
      );

      // holder 3
      sig = await createSignedVote(proposalId, false, accounts[3], votingContract.address);
      vtx = await votingContract.relayedVote(proposalId, false, accounts[3], ...sig);
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[3]],
        false,
        accounts[3],
      );

      // holder 4
      sig = await createSignedVote(proposalId, true, accounts[4], votingContract.address);
      vtx = await votingContract.relayedVote(proposalId, true, accounts[4], ...sig);
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[4]],
        true,
        accounts[4],
      );

      expect(favor.add(contra)).to.be.bignumber.eq(Q18.sub(1));

      // move time cast last vote
      sig = await createSignedVote(proposalId, true, accounts[1], votingContract.address);
      vtx = await votingContract.relayedVote(proposalId, true, accounts[1], ...sig);
      [favor, contra] = await verifyVote(
        vtx,
        proposalId,
        favor,
        contra,
        holders[accounts[1]],
        true,
        accounts[1],
      );
      expect(favor.add(contra)).to.be.bignumber.eq(Q18);
    });

    it("rejects relayed votes when arguments of the message are changed", async () => {
      const sig = await createSignedVote(proposalId, true, accounts[0], votingContract.address);
      const isSigValid = await votingContract.isValidSignature(
        proposalId,
        true,
        accounts[0],
        ...sig,
      );
      expect(isSigValid).to.be.true;
      await expect(votingContract.relayedVote(proposalId, false, accounts[0], ...sig)).to.revert;
    });

    it("rejects relayed vote twice", async () => {
      // direct -> relay
      await votingContract.vote(proposalId, true, { from: accounts[0] });
      let sig = await createSignedVote(proposalId, true, accounts[0], votingContract.address);
      await expect(
        votingContract.relayedVote(proposalId, true, accounts[0], ...sig),
      ).to.be.rejectedWith("NF_VC_ALREADY_VOTED");

      // relay -> direct
      sig = await createSignedVote(proposalId, true, accounts[1], votingContract.address);
      await votingContract.relayedVote(proposalId, true, accounts[1], ...sig);
      await expect(votingContract.vote(proposalId, true, { from: accounts[1] })).to.be.rejectedWith(
        "NF_VC_ALREADY_VOTED",
      );

      // relay -> relay
      sig = await createSignedVote(proposalId, true, accounts[3], votingContract.address);
      await votingContract.relayedVote(proposalId, true, accounts[3], ...sig);
      sig = await createSignedVote(proposalId, false, accounts[3], votingContract.address);
      await expect(
        votingContract.vote(proposalId, false, { from: accounts[3] }),
      ).to.be.rejectedWith("NF_VC_ALREADY_VOTED");
    });

    it("allows relayed votes to be batched together", async () => {
      const sig0 = await createSignedVote(proposalId, true, accounts[0], votingContract.address);
      const sig2 = await createSignedVote(proposalId, false, accounts[2], votingContract.address);
      const sig3 = await createSignedVote(proposalId, false, accounts[3], votingContract.address);
      const sig4 = await createSignedVote(proposalId, true, accounts[4], votingContract.address);

      // relayer relays batched votes
      let vtx = await votingContract.batchRelayedVotes(
        proposalId,
        [true, false, false, true],
        [sig0[0], sig2[0], sig3[0], sig4[0]],
        [sig0[1], sig2[1], sig3[1], sig4[1]],
        [sig0[2], sig2[2], sig3[2], sig4[2]],
        { from: admin },
      );
      let [pro, contra] = await verifyBatchedVote(
        vtx,
        0,
        proposalId,
        zero,
        zero,
        holders[accounts[0]],
        true,
        accounts[0],
      );
      [pro, contra] = await verifyBatchedVote(
        vtx,
        1,
        proposalId,
        pro,
        contra,
        holders[accounts[2]],
        false,
        accounts[2],
      );
      [pro, contra] = await verifyBatchedVote(
        vtx,
        2,
        proposalId,
        pro,
        contra,
        holders[accounts[3]],
        false,
        accounts[3],
      );
      [pro, contra] = await verifyBatchedVote(
        vtx,
        3,
        proposalId,
        pro,
        contra,
        holders[accounts[4]],
        true,
        accounts[4],
      );

      const tally1 = await votingContract.tally(proposalId);
      expect(tally1[1].add(tally1[2])).to.be.bignumber.eq(Q18.sub(1));
      expect(pro).to.be.bignumber.eq(tally1[1]);
      expect(contra).to.be.bignumber.eq(tally1[2]);

      // move time cast last vote
      const sig1 = await createSignedVote(proposalId, true, accounts[1], votingContract.address);
      vtx = await votingContract.batchRelayedVotes(
        proposalId,
        [true],
        [sig1[0]],
        [sig1[1]],
        [sig1[2]],
      );
      [pro, contra] = await verifyBatchedVote(
        vtx,
        0,
        proposalId,
        pro,
        contra,
        holders[accounts[1]],
        true,
        accounts[1],
      );
      const tally2 = await votingContract.tally(proposalId);
      expect(tally2[1].add(tally2[2])).to.be.bignumber.eq(Q18);
      expect(pro).to.be.bignumber.eq(tally2[1]);
      expect(contra).to.be.bignumber.eq(tally2[2]);
    });

    it("batch should skip invalid signatures and double votes", async () => {
      const sig0 = await createSignedVote(proposalId, true, accounts[0], votingContract.address);
      // double vote
      const sig0i = await createSignedVote(proposalId, false, accounts[0], votingContract.address);
      // invalid signature
      const sig2 = await createSignedVote(proposalId, false, accounts[2], votingContract.address);
      // no balance
      const sigA = await createSignedVote(proposalId, false, admin, votingContract.address);

      const vtx = await votingContract.batchRelayedVotes(
        proposalId,
        [true, false, true, false],
        [sig0[0], sig0i[0], sig2[0], sigA[0]],
        [sig0[1], sig0i[1], sig2[1], sigA[1]],
        [sig0[2], sig0i[2], sig2[2], sigA[2]],
      );

      // only one vote was effectively cast,
      const [pro, contra] = await verifyBatchedVote(
        vtx,
        0,
        proposalId,
        zero,
        zero,
        holders[accounts[0]],
        true,
        accounts[0],
      );
      const tally2 = await votingContract.tally(proposalId);
      expect(tally2[1].add(tally2[2])).to.be.bignumber.eq(holders[accounts[0]]);
      expect(pro).to.be.bignumber.eq(tally2[1]);
      expect(contra).to.be.bignumber.eq(tally2[2]);
    });

    it("rejects relayed votes when batching", async () => {
      await votingContract.vote(proposalId, true, { from: accounts[0] });
      const tally1 = await votingContract.tally(proposalId);
      const sig0 = await createSignedVote(proposalId, false, accounts[0], votingContract.address);
      let vtx = await votingContract.batchRelayedVotes(
        proposalId,
        [true],
        [sig0[0]],
        [sig0[1]],
        [sig0[2]],
      );
      expect(hasEvent(vtx, "LogVoteCast")).to.be.false;
      const tally2 = await votingContract.tally(proposalId);
      expect(tally2).to.deep.eq(tally1);

      const sig1 = await createSignedVote(proposalId, true, accounts[1], votingContract.address);
      vtx = await votingContract.batchRelayedVotes(
        proposalId,
        [true],
        [sig1[0]],
        [sig1[1]],
        [sig1[2]],
      );
      await verifyBatchedVote(
        vtx,
        0,
        proposalId,
        tally1[1],
        tally1[2],
        holders[accounts[1]],
        true,
        accounts[1],
      );
      const sig1i = await createSignedVote(proposalId, false, accounts[1], votingContract.address);
      await expect(
        votingContract.relayedVote(proposalId, false, accounts[1], ...sig1i),
      ).to.be.rejectedWith("NF_VC_ALREADY_VOTED");
    });

    it("should vote on two proposals", async () => {
      // account 1 has no tokens now
      await token.transfer(accounts[0], one, { from: accounts[1] });
      await advanceSnapshotId();
      const proposalId2 = randomBytes32();
      // new proposal based on changed balances
      await openProposal(proposalId2, campaignProposalParams, { from: owner2 });
      // account 1 may vote on prop 1
      let vtx = await votingContract.vote(proposalId, false, { from: accounts[1] });
      const [, contra] = await verifyVote(vtx, proposalId, zero, zero, holders[accounts[1]], false);
      expect(contra).to.be.bignumber.eq(one);
      expect(await votingContract.getVote(proposalId2, accounts[1])).to.be.bignumber.eq(
        VotingTriState.Abstain,
      );
      // account 1 has no balance to vote on prop2
      const sig1 = await createSignedVote(proposalId2, true, accounts[1], votingContract.address);
      vtx = await votingContract.batchRelayedVotes(
        proposalId2,
        [true],
        [sig1[0]],
        [sig1[1]],
        [sig1[2]],
      );
      expect(hasEvent(vtx, "")).to.be.false;
      const tally = await votingContract.tally(proposalId2);
      expect(tally[1]).to.be.bignumber.eq(zero);
      expect(tally[2]).to.be.bignumber.eq(zero);
    });
  });

  describe("end voting transition", async () => {
    let proposalId;
    let holders;

    beforeEach(async () => {
      holders = {};
      holders[accounts[0]] = Q18.mul("0.1").sub(1);
      holders[accounts[1]] = one;
      holders[accounts[2]] = Q18.mul("0.44");
      holders[accounts[3]] = Q18.mul("0.01").sub(3);
      holders[accounts[4]] = Q18.mul("0.45").add(3);
      await issueTokensToHolders(holders);
      expect(await token.totalSupply()).to.be.bignumber.eq(Q18);
      // open proposal
      proposalId = randomBytes32();
    });

    it("should transition to final if no offchain tally", async () => {
      await openProposal(proposalId, noCampaignNoOffchainParams);
      const vtx = await votingContract.vote(proposalId, false, { from: accounts[3] });
      await verifyVote(vtx, proposalId, zero, zero, holders[accounts[3]], false);
      // advance time to finish voting
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      const timedProposal = await votingContract.timedProposal(proposalId);
      const tx = await votingContract.handleStateTransitions(proposalId);
      expectLogProposalStateTransition(
        tx,
        proposalId,
        owner,
        ZERO_ADDRESS,
        ProposalState.Public,
        ProposalState.Reveal,
        0,
      );
      expectLogProposalStateTransition(
        tx,
        proposalId,
        owner,
        ZERO_ADDRESS,
        ProposalState.Reveal,
        ProposalState.Tally,
        1,
      );
      expectLogProposalStateTransition(
        tx,
        proposalId,
        owner,
        ZERO_ADDRESS,
        ProposalState.Tally,
        ProposalState.Final,
        2,
      );
      const proposal = await votingContract.proposal(proposalId);
      expect(timedProposal).to.deep.eq(proposal);
      expect(proposal[0]).to.be.bignumber.eq(ProposalState.Final);
      // reject voting
      await expectProposalRevertOnAllVotingMethods(proposalId, "NV_VC_VOTING_CLOSED");
      await expectFinalTally(proposalId, zero, holders[accounts[3]], zero, zero, owner, false);
    });

    it("should transition to offchain tally if offchain required", async () => {
      await openProposal(proposalId, noCampaignProposalParams);
      const vtx = await votingContract.vote(proposalId, false, { from: accounts[3] });
      await verifyVote(vtx, proposalId, zero, zero, holders[accounts[3]], false);
      // advance time to finish voting
      await increaseTime(noCampaignProposalParams.votingPeriod.toNumber());
      const timedProposal = await votingContract.timedProposal(proposalId);
      const tx = await votingContract.handleStateTransitions(proposalId);
      expectLogProposalStateTransition(
        tx,
        proposalId,
        owner,
        votingLegalRep,
        ProposalState.Public,
        ProposalState.Reveal,
        0,
      );
      expectLogProposalStateTransition(
        tx,
        proposalId,
        owner,
        votingLegalRep,
        ProposalState.Reveal,
        ProposalState.Tally,
        1,
      );
      const proposal = await votingContract.proposal(proposalId);
      expect(timedProposal).to.deep.eq(proposal);
      expect(proposal[0]).to.be.bignumber.eq(ProposalState.Tally);
      // reject voting
      await expectProposalRevertOnAllVotingMethods(proposalId, "NV_VC_VOTING_CLOSED");
      // offchain result document not yet available
      expect(await votingContract.offchainVoteDocumentUri(proposalId)).to.eq("");
      // provide off-chain tally
      const offTx = await votingContract.addOffchainVote(
        proposalId,
        noCampaignProposalParams.offchainVotingPower,
        zero,
        "uri:freeLunch",
        { from: votingLegalRep },
      );
      expectLogProposalStateTransition(
        offTx,
        proposalId,
        owner,
        votingLegalRep,
        ProposalState.Tally,
        ProposalState.Final,
      );
      await expectFinalTally(
        proposalId,
        zero,
        holders[accounts[3]],
        noCampaignProposalParams.offchainVotingPower,
        zero,
        owner,
        false,
      );
      // offchain result document should be available
      expect(await votingContract.offchainVoteDocumentUri(proposalId)).to.eq("uri:freeLunch");
    });

    it("should go to off chain tally only in tally state", async () => {
      const expectFailTally = async () =>
        expect(
          votingContract.addOffchainVote(
            proposalId,
            campaignProposalParams.offchainVotingPower,
            zero,
            "uri:freeLunch",
            { from: votingLegalRep },
          ),
        ).to.be.rejectedWith("NV_VC_NOT_TALLYING");

      await openProposal(proposalId, campaignProposalParams);
      await expectFailTally();
      // get out of campaign, holder 2 has enough tokens
      const vtx = await votingContract.vote(proposalId, false, { from: accounts[2] });
      await verifyVote(vtx, proposalId, zero, zero, holders[accounts[2]], false);
      let timedProposal = await votingContract.timedProposal(proposalId);
      expect(timedProposal[0]).to.be.bignumber.eq(ProposalState.Public);
      await expectFailTally();
      await increaseTime(campaignProposalParams.votingPeriod.toNumber());
      timedProposal = await votingContract.timedProposal(proposalId);
      expect(timedProposal[0]).to.be.bignumber.eq(ProposalState.Tally);

      const proOff = campaignProposalParams.offchainVotingPower.div(2).floor();
      const contraOff = campaignProposalParams.offchainVotingPower.div(4).floor();
      const offTx = await votingContract.addOffchainVote(
        proposalId,
        proOff,
        contraOff,
        "uri:freeLunch",
        { from: votingLegalRep },
      );
      expectLogOffChainProposalResult(offTx, proposalId, owner, proOff, contraOff, "uri:freeLunch");
      await expectFinalTally(
        proposalId,
        zero,
        holders[accounts[2]],
        proOff,
        contraOff,
        owner,
        false,
      );
      await expectFailTally();
    });

    it("reject off-chain tally not from legal rep", async () => {
      await openProposal(proposalId, noCampaignProposalParams);
      await increaseTime(noCampaignProposalParams.votingPeriod.toNumber());
      await expect(
        votingContract.addOffchainVote(
          proposalId,
          noCampaignProposalParams.offchainVotingPower,
          zero,
          "uri:freeLunch",
          { from: admin },
        ),
      ).to.be.rejectedWith("NF_VC_ONLY_VOTING_LEGAL_REP");
    });

    it("offchain must be entered within time-limit", async () => {
      await openProposal(proposalId, noCampaignProposalParams);
      // go to tally
      await increaseTime(noCampaignProposalParams.votingPeriod.toNumber());
      const timedProposal = await votingContract.timedProposal(proposalId);
      expect(timedProposal[0]).to.be.bignumber.eq(ProposalState.Tally);
      // go to final
      await increaseTime(noCampaignProposalParams.offchainVotePeriod.toNumber());
      await expectFinalTally(proposalId, zero, zero, zero, zero, owner, false);
    });

    it("rejects off-chain voting power exceeded", async () => {
      await openProposal(proposalId, noCampaignProposalParams);
      await increaseTime(noCampaignProposalParams.votingPeriod.toNumber());
      await expect(
        votingContract.addOffchainVote(
          proposalId,
          noCampaignProposalParams.offchainVotingPower.add(1),
          zero,
          "uri:freeLunch",
          { from: votingLegalRep },
        ),
      ).to.be.rejectedWith("NF_VC_EXCEEDS_OFFLINE_V_POWER");
      await expect(
        votingContract.addOffchainVote(
          proposalId,
          zero,
          noCampaignProposalParams.offchainVotingPower.add(1),
          "uri:freeLunch",
          { from: votingLegalRep },
        ),
      ).to.be.rejectedWith("NF_VC_EXCEEDS_OFFLINE_V_POWER");
      const proOff = campaignProposalParams.offchainVotingPower.div(2).round(4, 0);
      const contraOff = campaignProposalParams.offchainVotingPower.div(2).round(4, 0);
      await expect(
        votingContract.addOffchainVote(proposalId, proOff.add(1), contraOff, "uri:freeLunch", {
          from: votingLegalRep,
        }),
      ).to.be.rejectedWith("NF_VC_EXCEEDS_OFFLINE_V_POWER");
      await votingContract.addOffchainVote(proposalId, proOff, contraOff, "uri:freeLunch", {
        from: votingLegalRep,
      });
    });

    it("should skip tally if all voting power belongs to token", async () => {
      // zero off-chain voting power should also enforce no legal rep and no tally period
      const totalTokenPower = await token.totalSupply();
      const noOffchainPower = Object.assign({}, noCampaignProposalParams, {
        offchainVotingPower: totalTokenPower,
      });
      // in list offchainVotingPower takes place of totalTokenPower, do not modify, pass directly
      const [list] = constructVotingParams(proposalId, noOffchainPower);

      await votingContract.addProposal(...list, { from: owner });
      const proposal = await votingContract.proposal(proposalId);
      // offchain voting power must be 0
      expect(proposal[6]).to.be.bignumber.eq(zero);
      // tally duration must be zero
      const deadlines = proposal[10];
      const t = deadlines[0];
      expect(deadlines[4]).to.be.bignumber.eq(noOffchainPower.votingPeriod.add(t));
      await increaseTime(noCampaignProposalParams.votingPeriod.toNumber());
      // and we are in final state
      const tally = await votingContract.tally(proposalId);
      expect(tally[0]).to.be.bignumber.eq(ProposalState.Final);
    });
  });

  describe("proposal observer", () => {
    let proposalId;
    let holders;
    let observer;

    async function openObservedProposal(pId, proposalParams, txParamsOvr) {
      observer = await TestVotingObserver.new(votingContract.address);
      const [tx, params] = await addProposal(observer, pId, proposalParams, txParamsOvr);
      // take proposal without timed state
      const proposal = await votingContract.proposal(pId);
      await validateInitialProposal(tx, params, proposal, pId);

      return proposal;
    }

    beforeEach(async () => {
      holders = {};
      holders[accounts[0]] = Q18.mul("0.05").add(1);
      holders[accounts[1]] = one;
      holders[accounts[2]] = Q18.mul("0.44").sub(1);
      holders[accounts[3]] = Q18.mul("0.06");
      holders[accounts[4]] = Q18.mul("0.45").sub(1);
      await issueTokensToHolders(holders);
      expect(await token.totalSupply()).to.be.bignumber.eq(Q18);
      proposalId = randomBytes32();
    });

    it("should open proposal for smart contract initator", async () => {
      await openObservedProposal(proposalId, noCampaignWithObserver);
      const proposal = await votingContract.timedProposal(proposalId);
      // has observer interface
      expect(proposal[9]).to.be.true;
      // initiator is the observer contract
      expect(proposal[3]).to.eq(observer.address);
    });

    it("should execute voting with observer", async () => {
      await openObservedProposal(proposalId, noCampaignWithObserver);
      const vtx = await votingContract.vote(proposalId, false, { from: accounts[3] });
      expectLogVoteCast(
        vtx,
        proposalId,
        observer.address,
        accounts[3],
        false,
        holders[accounts[3]],
      );
      // advance time to finish voting
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      // that will handle time transition and call the observer
      const tx = await votingContract.handleStateTransitions(proposalId);
      expectLogProposalStateTransition(
        tx,
        proposalId,
        observer.address,
        votingLegalRep,
        ProposalState.Public,
        ProposalState.Reveal,
        0,
      );
      // decode observer log
      const obsLogs = decodeLogs(tx, observer.address, TestVotingObserver.abi);
      tx.logs.push(...obsLogs);
      expectLogTestProposalTransition(
        tx,
        proposalId,
        ProposalState.Public,
        ProposalState.Reveal,
        0,
      );
      expectLogTestProposalTransition(tx, proposalId, ProposalState.Reveal, ProposalState.Tally, 1);
    });

    it("should execute voting with failing observer", async () => {
      await openObservedProposal(proposalId, noCampaignWithObserver);
      const vtx = await votingContract.vote(proposalId, false, { from: accounts[3] });
      expectLogVoteCast(
        vtx,
        proposalId,
        observer.address,
        accounts[3],
        false,
        holders[accounts[3]],
      );
      // advance time to finish voting
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      // make observer revert
      await observer._failCallback(true);
      // that will handle time transition and call the observer
      const tx = await votingContract.handleStateTransitions(proposalId);
      expectLogProposalStateTransition(
        tx,
        proposalId,
        observer.address,
        votingLegalRep,
        ProposalState.Public,
        ProposalState.Reveal,
        0,
      );
      // decode observer log
      const obsLogs = decodeLogs(tx, observer.address, TestVotingObserver.abi);
      tx.logs.push(...obsLogs);
      // no events from the observer
      expect(hasEvent(tx, "LogTestProposalTransition")).to.be.false;
    });

    it("should execute voting when observer is simple address", async () => {
      // make initiator a simple address but request observer callback
      // this should revert observer transition calls
      await openProposal(proposalId, noCampaignWithObserver);
      const vtx = await votingContract.vote(proposalId, false, { from: accounts[3] });
      expectLogVoteCast(vtx, proposalId, owner, accounts[3], false, holders[accounts[3]]);
      // advance time to finish voting
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      // that will handle time transition and call the observer
      const tx = await votingContract.handleStateTransitions(proposalId);
      expectLogProposalStateTransition(
        tx,
        proposalId,
        owner,
        votingLegalRep,
        ProposalState.Public,
        ProposalState.Reveal,
        0,
      );
    });

    it("should return voting decision", async () => {
      await openObservedProposal(proposalId, noCampaignNoOffchainWithObserver);
      // make one wei below quorum
      await votingContract.vote(proposalId, true, { from: accounts[2] });
      await votingContract.vote(proposalId, true, { from: accounts[3] });
      // should revert if not final
      await expect(observer.votingResult(votingContract.address, proposalId)).to.be.rejectedWith(
        "NF_TEST_NOT_FINAL",
      );
      // go to final
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      // let tally = await votingContract.tally(proposalId);
      // console.log(tally);
      expect(await observer.votingResult(votingContract.address, proposalId)).to.be.false;

      // make quorum exact
      proposalId = randomBytes32();
      await openObservedProposal(proposalId, noCampaignNoOffchainWithObserver);
      await votingContract.vote(proposalId, true, { from: accounts[1] });
      await votingContract.vote(proposalId, true, { from: accounts[2] });
      await votingContract.vote(proposalId, true, { from: accounts[3] });
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      expect(await observer.votingResult(votingContract.address, proposalId)).to.be.true;

      // make majority exact
      proposalId = randomBytes32();
      await openObservedProposal(proposalId, noCampaignNoOffchainWithObserver);
      // 50% for
      await votingContract.vote(proposalId, true, { from: accounts[0] });
      await votingContract.vote(proposalId, true, { from: accounts[4] });
      // 50% contra
      await votingContract.vote(proposalId, false, { from: accounts[1] });
      await votingContract.vote(proposalId, false, { from: accounts[2] });
      await votingContract.vote(proposalId, false, { from: accounts[3] });
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      // no majority
      expect(await observer.votingResult(votingContract.address, proposalId)).to.be.false;
      const tally = await votingContract.tally(proposalId);
      expect(tally[1]).to.be.bignumber.eq(tally[2]);

      // make majority with one more wei
      proposalId = randomBytes32();
      await openObservedProposal(proposalId, noCampaignNoOffchainWithObserver);
      // 50% + 1 for
      await votingContract.vote(proposalId, true, { from: accounts[0] });
      await votingContract.vote(proposalId, true, { from: accounts[4] });
      await votingContract.vote(proposalId, true, { from: accounts[1] });
      // 50% contra
      await votingContract.vote(proposalId, false, { from: accounts[2] });
      await votingContract.vote(proposalId, false, { from: accounts[3] });
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      // no majority
      expect(await observer.votingResult(votingContract.address, proposalId)).to.be.true;

      // make quorum with off-chain, off chain power is 20% of token power
      proposalId = randomBytes32();
      await openObservedProposal(proposalId, noCampaignWithObserver);
      await votingContract.vote(proposalId, true, { from: accounts[4] });
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      await votingContract.addOffchainVote(proposalId, Q18.mul("0.15"), 0, "free lunch", {
        from: votingLegalRep,
      });
      // one wei voting power missing to quorum (45% - 1 wei + 15% out of 120%)
      expect(await observer.votingResult(votingContract.address, proposalId)).to.be.false;

      proposalId = randomBytes32();
      await openObservedProposal(proposalId, noCampaignWithObserver);
      await votingContract.vote(proposalId, true, { from: accounts[4] });
      await increaseTime(noCampaignNoOffchainParams.votingPeriod.toNumber());
      await votingContract.addOffchainVote(proposalId, 0, Q18.mul("0.15").add(1), "free lunch", {
        from: votingLegalRep,
      });
      // we have quorum and majority
      expect(await observer.votingResult(votingContract.address, proposalId)).to.be.true;
    });
  });

  describe("special proposals", () => {
    let proposalId;
    let holders;

    beforeEach(async () => {
      holders = {};
      holders[accounts[0]] = campaignProposalParams.campaignQuorumFraction;
      holders[accounts[1]] = Q18.mul("0.9");
      await issueTokensToHolders(holders);
      expect(await token.totalSupply()).to.be.bignumber.eq(Q18);
      proposalId = randomBytes32();
    });

    it("should finalize right after campaign if total voting period equals campaign voting", async () => {
      const params = Object.assign({}, campaignProposalParams, {
        campaignDuration: campaignProposalParams.votingPeriod,
        offchainVotePeriod: zero,
        offchainVotingPower: zero,
        votingLegalRep: ZERO_ADDRESS,
      });
      const proposal = await openProposal(proposalId, params);
      expect(proposal[0]).to.be.bignumber.eq(ProposalState.Campaigning);
      // vote with campaign quorum
      await votingContract.vote(proposalId, true, { from: accounts[0] });
      const final = await votingContract.tally(proposalId);
      expect(final[0]).to.be.bignumber.eq(ProposalState.Final);
    });

    it("should finalize zero voting period and no offchain tally immediately", async () => {
      const params = Object.assign({}, noCampaignNoOffchainParams, { votingPeriod: zero });
      await openProposal(proposalId, params);
      const timedState = await votingContract.timedProposal(proposalId);
      expect(timedState[0]).to.be.bignumber.eq(ProposalState.Final);
      await votingContract.handleStateTransitions(proposalId);
      const state = await votingContract.proposal(proposalId);
      expect(state[0]).to.be.bignumber.eq(ProposalState.Final);
    });

    it("should let offchain tally when zero voting period", async () => {
      const params = Object.assign({}, noCampaignProposalParams, { votingPeriod: zero });
      await openProposal(proposalId, params);
      const timedState = await votingContract.timedProposal(proposalId);
      expect(timedState[0]).to.be.bignumber.eq(ProposalState.Tally);
      await votingContract.addOffchainVote(proposalId, 0, one, "free lunch", {
        from: votingLegalRep,
      });

      const state = await votingContract.proposal(proposalId);
      expect(state[0]).to.be.bignumber.eq(ProposalState.Final);
    });

    it("should remain in tally if zero off-chain vote passed", async () => {
      const params = Object.assign({}, noCampaignProposalParams, { votingPeriod: zero });
      await openProposal(proposalId, params);
      const timedState = await votingContract.timedProposal(proposalId);
      expect(timedState[0]).to.be.bignumber.eq(ProposalState.Tally);
      await expect(
        votingContract.addOffchainVote(proposalId, 0, 0, "free lunch", { from: votingLegalRep }),
      ).to.be.rejectedWith("NF_VC_NO_OFF_EMPTY_VOTE");

      const state = await votingContract.timedProposal(proposalId);
      expect(state[0]).to.be.bignumber.eq(ProposalState.Tally);
    });
  });

  async function advanceSnapshotId() {
    // could be replaced with a single day advance
    await token.createSnapshot();
  }

  async function issueTokens(holdersCount, scale = 1000) {
    for (let ii = 0; ii < holdersCount; ii += 1) {
      const amount = Q18.mul(Math.round(1 + Math.random() * scale));
      // deposit to holder;
      await token.deposit(amount, { from: accounts[ii] });
    }
    // seal snapshot
    await advanceSnapshotId();
  }

  async function issueTokensToHolders(allocation) {
    for (const key of Object.keys(allocation)) {
      await token.deposit(allocation[key], { from: key });
    }
    // seal snapshot
    await advanceSnapshotId();
  }

  async function validateInitialProposal(tx, params, proposal, proposalId) {
    // zero quorum skips campaign
    const state = params.campaignQuorumFraction.eq(0)
      ? ProposalState.Public
      : ProposalState.Campaigning;
    expect(proposal[0]).to.be.bignumber.eq(state);
    expect(proposal[1]).to.eq(token.address);
    expect(proposal[2]).to.be.bignumber.lt(await token.currentSnapshotId());
    // do not check initator here as it could be smart contract etc.
    // expect(proposal[3]).to.eq(owner);
    expect(proposal[4]).to.eq(params.votingLegalRep);
    const supply = await token.totalSupplyAt(proposal[2]);
    // campating quorum amount based on token and offchain power
    const quorumTokenAmount = divRound(
      params.campaignQuorumFraction.mul(supply.add(params.offchainVotingPower)),
      Q18,
    );
    expect(proposal[5]).to.be.bignumber.eq(quorumTokenAmount);
    expect(proposal[6]).to.be.bignumber.eq(params.offchainVotingPower);
    expect(proposal[7]).to.be.bignumber.eq(params.action);
    expect(proposal[8]).to.eq(params.actionPayload);
    expect(proposal[9]).to.eq(params.enableObserver);
    const deadlines = proposal[10];
    // number of states
    expect(deadlines.length).to.eq(5);
    const t = await txTimestamp(tx);
    // vote start time stamp is block of tx timestamp
    expect(deadlines[0]).to.be.bignumber.eq(t);
    // public starts after campaign
    expect(deadlines[1]).to.be.bignumber.eq(params.campaignDuration.add(t));
    // tally starts after voting period
    expect(deadlines[2]).to.be.bignumber.eq(params.votingPeriod.add(t));
    // no reveal state
    expect(deadlines[3]).to.be.bignumber.eq(params.votingPeriod.add(t));
    // final after all periods
    expect(deadlines[4]).to.be.bignumber.eq(
      params.votingPeriod.add(t).add(params.offchainVotePeriod),
    );
    if (state === ProposalState.Public) {
      let initiator = tx.receipt.from;
      if (!hasEvent(tx, "LogProposalStateTransition")) {
        // if log is not found try to decode abi directly (in case tx was done via observer contract)
        const etcLogs = decodeLogs(tx, votingContract.address, VotingCenter.abi);
        tx.logs.push(...etcLogs);
        // and the initator is the observer contract, not the owner address
        initiator = tx.receipt.to;
      }
      expectLogProposalStateTransition(
        tx,
        proposalId,
        initiator,
        params.votingLegalRep,
        ProposalState.Campaigning,
        ProposalState.Public,
      );
    } else {
      expect(hasEvent(tx, "LogProposalStateTransition")).to.be.false;
    }
  }

  async function verifyVote(vtx, proposalId, currFavor, currContra, power, inFavor, voter) {
    expectLogVoteCast(vtx, proposalId, owner, voter || vtx.receipt.from, inFavor, power);
    // assign power
    let fav = zero,
      contra = zero;
    if (inFavor) {
      fav = power;
    } else {
      contra = power;
    }
    // get current voting outcome
    const outcome = await votingContract.tally(proposalId);
    expect(outcome[1]).to.be.bignumber.eq(currFavor.add(fav));
    expect(outcome[2]).to.be.bignumber.eq(currContra.add(contra));
    // make sure has voted flag is set
    const effectiveVoter = voter || vtx.receipt.from;
    const expectedVote = inFavor ? VotingTriState.InFavor : VotingTriState.Against;
    expect(await votingContract.getVote(proposalId, effectiveVoter)).to.be.bignumber.eq(
      expectedVote,
    );

    return [outcome[1], outcome[2]];
  }

  async function verifyBatchedVote(
    vtx,
    idx,
    proposalId,
    currFavor,
    currContra,
    power,
    inFavor,
    voter,
  ) {
    expectLogVoteCast(vtx, proposalId, owner, voter, inFavor, power, idx);
    // assign power
    let fav = currFavor,
      contra = currContra;
    if (inFavor) {
      fav = fav.add(power);
    } else {
      contra = contra.add(power);
    }
    const expectedVote = inFavor ? VotingTriState.InFavor : VotingTriState.Against;
    expect(await votingContract.getVote(proposalId, voter)).to.be.bignumber.eq(expectedVote);

    return [fav, contra];
  }

  async function expectProposalRevertOnAllVotingMethods(pId, code) {
    await expect(votingContract.vote(pId, true, { from: accounts[0] })).to.be.rejectedWith(code);
    const sig = await createSignedVote(pId, true, accounts[0], votingContract.address);
    await expect(votingContract.relayedVote(pId, true, accounts[0], ...sig)).to.be.rejectedWith(
      code,
    );
    await expect(
      votingContract.batchRelayedVotes(pId, [true], [sig[0]], [sig[1]], [sig[2]]),
    ).to.be.rejectedWith(code);
  }

  async function expectFinalTally(
    proposalId,
    pro,
    contra,
    proOffchain,
    contraOffchain,
    initiator,
    observing,
  ) {
    const proposal = await votingContract.proposal(proposalId);
    const tally = await votingContract.tally(proposalId);
    // total voting power is offchain power + token power
    const tokenVotingPower = await token.totalSupplyAt(proposal[2]);
    const totalVotingPower = proposal[6].add(tokenVotingPower);
    expect(tally[0]).to.be.bignumber.eq(ProposalState.Final);
    expect(tally[1]).to.be.bignumber.eq(pro);
    expect(tally[2]).to.be.bignumber.eq(contra);
    expect(tally[3]).to.be.bignumber.eq(proOffchain);
    expect(tally[4]).to.be.bignumber.eq(contraOffchain);
    expect(tally[5]).to.be.bignumber.eq(tokenVotingPower);
    expect(tally[6]).to.be.bignumber.eq(totalVotingPower);
    expect(tally[7]).to.be.bignumber.eq(proposal[5]);
    expect(tally[8]).to.eq(initiator);
    expect(tally[9]).to.eq(observing);
  }

  async function addProposal(votingCenter, proposalId, defaultParams, txParamsOvr) {
    const [list, params] = constructVotingParams(proposalId, defaultParams);
    const txParams = Object.assign({ from: owner }, txParamsOvr || {});
    // replace offchain voting power with total voting power by adding token balance at snapshot - 1
    if (params.offchainVotingPower.gt(0)) {
      const snapshotId = await token.currentSnapshotId();
      // take sealed snapshot
      const tokenVotingPower = await token.totalSupplyAt(snapshotId.sub(1));
      // no.7 is total voting power
      list[7] = params.offchainVotingPower.add(tokenVotingPower);
    }
    const tx = await votingCenter.addProposal(...list, txParams);
    return [tx, params];
  }

  function constructVotingParams(proposalId, defaultParams) {
    const params = Object.assign({}, defaultParams, { proposalId, token: token.address });
    // should be ordered as defaultProposalParams
    return [Object.values(params), params];
  }

  async function openProposal(proposalId, proposalParams, txParamsOvr) {
    const [tx, params] = await addProposal(votingContract, proposalId, proposalParams, txParamsOvr);
    // take proposal without timed state
    const proposal = await votingContract.proposal(proposalId);
    await validateInitialProposal(tx, params, proposal, proposalId);

    return proposal;
  }

  function expectLogProposalStateTransition(
    tx,
    proposalId,
    initator,
    legalRep,
    oldState,
    newState,
    idx,
  ) {
    const event =
      idx === undefined
        ? eventValue(tx, "LogProposalStateTransition")
        : eventValueAtIndex(tx, idx, "LogProposalStateTransition");
    expect(event).to.exist;
    expect(event.args.proposalId).to.eq(proposalId);
    expect(event.args.initiator).to.eq(initator);
    expect(event.args.token).to.eq(token.address);
    expect(event.args.votingLegalRep).to.eq(legalRep);
    expect(event.args.oldState).to.be.bignumber.eq(oldState);
    expect(event.args.newState).to.be.bignumber.eq(newState);
  }

  function expectLogTestProposalTransition(tx, proposalId, oldState, newState, idx) {
    const event =
      idx === undefined
        ? eventValue(tx, "LogTestProposalTransition")
        : eventValueAtIndex(tx, idx, "LogTestProposalTransition");
    expect(event).to.exist;
    expect(event.args.proposalId).to.eq(proposalId);
    expect(event.args.oldState).to.be.bignumber.eq(oldState);
    expect(event.args.newState).to.be.bignumber.eq(newState);
  }

  function expectLogVoteCast(tx, proposalId, initator, voter, inFavor, power, idx) {
    const event =
      idx === undefined ? eventValue(tx, "LogVoteCast") : eventValueAtIndex(tx, idx, "LogVoteCast");
    expect(event).to.exist;
    expect(event.args.proposalId).to.eq(proposalId);
    expect(event.args.initiator).to.eq(initator);
    expect(event.args.token).to.eq(token.address);
    expect(event.args.voter).to.eq(voter);
    expect(event.args.voteInFavor).to.eq(inFavor);
    expect(event.args.power).to.be.bignumber.eq(power);
  }

  function expectLogOffChainProposalResult(tx, proposalId, initiator, proOff, contraOff, docUri) {
    const event = eventValue(tx, "LogOffChainProposalResult");
    expect(event).to.exist;
    expect(event.args.proposalId).to.eq(proposalId);
    expect(event.args.initiator).to.eq(initiator);
    expect(event.args.token).to.eq(token.address);
    expect(event.args.votingLegalRep).to.eq(votingLegalRep);
    expect(event.args.inFavor).to.be.bignumber.eq(proOff);
    expect(event.args.against).to.be.bignumber.eq(contraOff);
    expect(event.args.documentUri).to.eq(docUri);
  }

  function expectLogChangeVotingController(tx, oldController, newController, by) {
    const event = eventValue(tx, "LogChangeVotingController");
    expect(event).to.exist;
    expect(event.args.oldController).to.eq(oldController);
    expect(event.args.newController).to.eq(newController);
    expect(event.args.by).to.eq(by);
  }
});
