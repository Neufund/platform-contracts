import { expect } from "chai";
import { soliditySha3, sha3 } from "web3-utils";
import { deployUniverse, deployVotingCenter } from "../helpers/deployContracts";
import { ZERO_ADDRESS, Q18, dayInSeconds } from "../helpers/constants";
import { randomBytes32, randomAddress, promisify } from "../helpers/utils";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import {
  GovState,
  GovAction,
  GovExecutionState,
  GovTokenVotingRule,
  GovActionEscalation,
  GovActionLegalRep,
} from "../helpers/govState";
import {
  deployTokenholderRights,
  generateDefaultBylaws,
  applyBylawsToRights,
  decodeBylaw,
  encodeBylaw,
  deployTokenTerms,
  defaultTokenholderTerms,
  defEtoTerms,
  defTokenTerms,
} from "../helpers/deployTerms";
import {
  expectLogResolutionStarted,
  expectLogResolutionExecuted,
  expectResolution,
  expectResolutionById,
  shareCapitalToTokens,
} from "../helpers/govUtils";
import { hasEvent } from "../helpers/events";
import { increaseTime, mineBlock } from "../helpers/evmCommands";
import { ProposalState } from "../helpers/voting";
import { divRound } from "../helpers/unitConverter";

const GovLibrary = artifacts.require("Gov");
const TokenholderRights = artifacts.require("EquityTokenholderRights");
const TestControllerGovernanceEngine = artifacts.require("TestControllerGovernanceEngine");
const TestTokenControllerPassThrough = artifacts.require("TestTokenControllerPassThrough");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const EquityToken = artifacts.require("EquityToken");
const TestVotingController = artifacts.require("TestVotingController");

const bn = n => new web3.BigNumber(n);
const one = bn("1");
const zero = bn("0");

contract("TestControllerGovernanceEngine", ([_, admin, company, nominee, anyone, ...investors]) => {
  let universe;
  let tokenholderRights;
  let governanceEngine;
  let equityToken;
  let votingCenter;

  const votingRightsOvr = {
    GENERAL_VOTING_RULE: bn(GovTokenVotingRule.Positive),
    TAG_ALONG_VOTING_RULE: bn(GovTokenVotingRule.Negative),
  };
  const nonVotingRightsOvr = {
    GENERAL_VOTING_RULE: bn(GovTokenVotingRule.NoVotingRights),
    // tag along is for tokenholder voting so voting is always possible
    TAG_ALONG_VOTING_RULE: bn(GovTokenVotingRule.Negative),
  };

  before(async () => {
    const lib = await GovLibrary.new();
    GovLibrary.address = lib.address;
    await TestControllerGovernanceEngine.link(GovLibrary, lib.address);
  });

  beforeEach(async () => {
    [universe] = await deployUniverse(admin, admin);
    [votingCenter] = await deployVotingCenter(TestVotingController, universe, admin);
  });

  it("should deploy", async () => {
    await deployGovernanceEngine(nonVotingRightsOvr);
    await prettyPrintGasCost("TestControllerGovernanceEngine deploy", governanceEngine);
  });

  describe("with no voting rights", () => {
    beforeEach(async () => {
      await deployGovernanceEngine(nonVotingRightsOvr);
    });

    describe("execute atomically", () => {
      it("should execute single resolution", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        const tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Completed,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        const resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(
          resolution,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Completed,
        );
        const txdata = await promisify(web3.eth.getTransaction)(tx.tx);
        // verify promise
        expect(resolution[5]).to.eq(sha3(txdata.input, { encoding: "hex" }));
        // expect right payload to be set
        expect(await governanceEngine.addressPayload()).to.eq(payload);
      });

      it("rejects on validator", async () => {
        const resolutionId = randomBytes32();
        // special address on which custom validator will trigger
        const payload = "0xcCA9fB1AFfA05fD1aD6A339379d4b7dd4301EB49";
        const docUrl = "uri:90283092809209832";
        await expect(
          governanceEngine.executeAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_TEST_INVALID_ADDR_PAYLOAD");
      });

      it("rejects on double execution", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        await expect(
          governanceEngine.executeAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_GOV_ALREADY_EXECUTED");
        const newPayload = randomAddress();
        await expect(
          governanceEngine.executeAtomically(
            resolutionId,
            newPayload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_GOV_ALREADY_EXECUTED");
      });

      it("rejects on non-company", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        await expect(
          governanceEngine.executeAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            "",
            { from: nominee },
          ),
        ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      });

      it("rejects on token holder", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        await expect(
          governanceEngine.executeAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            "",
            { from: investors[0] },
          ),
        ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      });

      it("should execute many", async () => {
        const resolutionId = randomBytes32();
        let payload = randomAddress();
        let docUrl = "uri:90283092809209832";
        await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        const resolutionId2 = randomBytes32();
        // this will fail resolution
        payload = "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8";
        docUrl = "ipfs:90283092809209833";
        const tx = await governanceEngine.executeAtomically(
          resolutionId2,
          payload,
          GovAction.ChangeOfControl,
          docUrl,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId2,
          "",
          docUrl,
          GovAction.ChangeOfControl,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId2,
          GovAction.ChangeOfControl,
          GovExecutionState.Failed,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([
          resolutionId,
          resolutionId2,
        ]);
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Completed,
        );
        const failedCode = soliditySha3({ type: "string", value: "NF_TEST_INVALID_ADDR_PAYLOAD" });
        await expectResolutionById(
          governanceEngine,
          resolutionId2,
          GovAction.ChangeOfControl,
          GovExecutionState.Failed,
          failedCode,
        );
      });

      it("should not continue on non-atomic", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        await expect(
          governanceEngine.continueNonAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
          ),
        ).to.be.rejectedWith("NF_GOV_NOT_EXECUTING");
      });

      it("should fail execution", async () => {
        // special address that makes fail with code
        const resolutionId = randomBytes32();
        const payload = "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8";
        const docUrl = "uri:90283092809209832";
        const tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Failed,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        const failedCode = soliditySha3({ type: "string", value: "NF_TEST_INVALID_ADDR_PAYLOAD" });
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Failed,
          failedCode,
        );
        // payload must be zero
        expect(await governanceEngine.addressPayload()).to.eq(ZERO_ADDRESS);
      });
    });

    describe("execute non-atomically", () => {
      it("should execute single resolution", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        const tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Executing,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        const resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(
          resolution,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Executing,
        );
        const txdata = await promisify(web3.eth.getTransaction)(tx.tx);
        // verify promise
        expect(resolution[5]).to.eq(sha3(txdata.input, { encoding: "hex" }));
        // expect right payload to be set
        expect(await governanceEngine.addressPayload()).to.eq(payload);

        // continue execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        expect(await governanceEngine.addressPayload()).to.eq(ZERO_ADDRESS);
        const continueTx = await governanceEngine.continueNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: investors[1] }, // anyone can push execution forward
        );
        expect(hasEvent(continueTx, "LogResolutionExecuted")).to.be.false;
        expect(await governanceEngine.addressPayload()).to.eq(payload);
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Executing,
        );
        // one more time
        await governanceEngine._setPayload(ZERO_ADDRESS);
        await governanceEngine.continueNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: investors[1] }, // anyone can push execution forward
        );
        expect(await governanceEngine.addressPayload()).to.eq(payload);

        // finalize execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        // anyone can finalize
        const finalizeTx = await governanceEngine.finalizeAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: nominee },
        );
        expectLogResolutionExecuted(
          finalizeTx,
          0,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Completed,
        );
        expect(await governanceEngine.addressPayload()).to.eq(payload);
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Completed,
        );
      });

      it("should fail at every step");

      it("rejects on validator", async () => {
        const resolutionId = randomBytes32();
        // special address on which custom validator will trigger
        const payload = "0xcCA9fB1AFfA05fD1aD6A339379d4b7dd4301EB49";
        const docUrl = "uri:90283092809209832";
        await expect(
          governanceEngine.executeNonAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_TEST_INVALID_ADDR_PAYLOAD");
      });

      it("rejects on double execution", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        await expect(
          governanceEngine.executeNonAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_GOV_ALREADY_EXECUTED");
        const newPayload = randomAddress();
        await expect(
          governanceEngine.executeNonAtomically(
            resolutionId,
            newPayload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_GOV_ALREADY_EXECUTED");
      });

      it("rejects on non-company", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        await expect(
          governanceEngine.executeNonAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            "",
            { from: nominee },
          ),
        ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      });

      it("rejects on token holder", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        await expect(
          governanceEngine.executeNonAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            "",
            { from: investors[0] },
          ),
        ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      });

      it("reject continuation on atomic execution", async () => {
        // must reject execution of resolution started non atomic and continued on new atomic
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        await expect(
          governanceEngine.executeAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_GOV_ALREADY_EXECUTED");
      });

      it("rejects on unkept promise", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        // expect right payload to be set
        expect(await governanceEngine.addressPayload()).to.eq(payload);

        // you must send exactly same parameters to continue resolution
        await expect(
          governanceEngine.continueNonAtomically(
            resolutionId,
            randomAddress(), // different param sent
            GovAction.EstablishAuthorizedCapital,
            docUrl,
          ),
        ).to.be.rejectedWith("NF_GOV_UNKEPT_PROMISE");
        await expect(
          governanceEngine.finalizeAtomically(
            resolutionId,
            payload,
            GovAction.ChangeOfControl,
            docUrl,
          ),
        ).to.be.rejectedWith("NF_GOV_UNKEPT_PROMISE");
        // finalize execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        await governanceEngine.finalizeAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
        );
        expect(await governanceEngine.addressPayload()).to.eq(payload);
      });

      it("should execute with steps", async () => {
        const resolutionId = randomBytes32();
        const payload = randomAddress();
        const docUrl = "uri:90283092809209832";
        await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        // continue execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        await governanceEngine.continueNonAtomicallyWithStep(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          1,
        );
        expect(await governanceEngine.addressPayload()).to.eq(payload);
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Executing,
          undefined,
          undefined,
          1,
        );
        // step cannot repeated
        await expect(
          governanceEngine.continueNonAtomicallyWithStep(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            1,
          ),
        ).to.be.rejectedWith("NF_GOV_INVALID_NEXT_STEP");
        // next step 0 is not checked and does not progress
        await governanceEngine.continueNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
        );
        // next step
        await governanceEngine.continueNonAtomicallyWithStep(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          2,
        );
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Executing,
          undefined,
          undefined,
          2,
        );
        // finalize requires step
        await expect(
          governanceEngine.finalizeAtomicallyWithStep(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            4,
          ),
        ).to.be.rejectedWith("NF_GOV_INVALID_NEXT_STEP");
        await governanceEngine.finalizeAtomicallyWithStep(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          3,
        );
        // however final next step is not written to save on gas
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Completed,
          undefined,
          undefined,
          2,
        );
      });

      it("should execute many");
    });
  });

  describe("with voting rights", async () => {
    const resolutionId = randomBytes32();
    const payload = randomAddress();
    const docUrl = "uri:90283092809209832";

    beforeEach(async () => {
      await deployGovernanceEngine(votingRightsOvr);
      const holders = {};
      holders[investors[0]] = bn("10000");
      holders[investors[1]] = one;
      holders[investors[2]] = bn("123.562");
      await issueTokensToHolders(holders);
    });

    describe("with atomic execution", async () => {
      it("should execute single SHR", async () => {
        // None is a standard SHR
        let tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.None,
          GovExecutionState.Escalating,
        );
        expect(hasEvent(tx, "LogResolutionExecuted")).to.be.false;
        const bylaw = await tokenholderRights.getBylaw(GovAction.None);
        await expectVoting(resolutionId, GovAction.None, "0x0".concat(bylaw.toString(16)), false);
        await expectVotingResult(resolutionId, "NF_GOV_VOTING_NOT_FINAL");
        // check status again - anyone can move resolution forward
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );
        expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;
        let resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.None, GovExecutionState.Escalating);
        // vote and push forward
        await votingCenter.vote(resolutionId, true, { from: investors[0] });
        // move to tally
        await increaseTime(defaultTokenholderTerms.GENERAL_VOTING_DURATION.toNumber());
        await expectVotingResult(resolutionId, "NF_GOV_VOTING_NOT_FINAL");
        // await votingCenter.handleStateTransitions(resolutionId);
        // should be still escalating
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );
        expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;
        resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.None, GovExecutionState.Escalating);
        // cast offchain vote
        await expectVotingResult(resolutionId, "NF_GOV_VOTING_NOT_FINAL");
        await votingCenter.addOffchainVote(
          resolutionId,
          tokensToShares("0"),
          tokensToShares("1299"),
          "free lunch",
          { from: company },
        );
        await expectVotingResult(resolutionId, true);
        // tally is over, execute
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.None,
          GovExecutionState.Completed,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.None, GovExecutionState.Completed);
        const txdata = await promisify(web3.eth.getTransaction)(tx.tx);
        // verify promise
        expect(resolution[5]).to.eq(sha3(txdata.input, { encoding: "hex" }));
        // expect right payload to be set
        expect(await governanceEngine.addressPayload()).to.eq(payload);
      });

      it("should execute single THR", async () => {
        // TagAlong is a THR without off-chain
        let tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.TagAlong,
          docUrl,
          { from: nominee },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.TagAlong,
          GovExecutionState.Escalating,
        );
        expect(hasEvent(tx, "LogResolutionExecuted")).to.be.false;
        const bylaw = await tokenholderRights.getBylaw(GovAction.TagAlong);
        await expectVoting(
          resolutionId,
          GovAction.TagAlong,
          "0x0".concat(bylaw.toString(16)),
          false,
        );
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.TagAlong,
          docUrl,
        );
        expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;
        let resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(
          resolution,
          resolutionId,
          GovAction.TagAlong,
          GovExecutionState.Escalating,
        );
        // vote and push forward
        await votingCenter.vote(resolutionId, true, { from: investors[0] });
        // move to final - no tally
        await increaseTime(defaultTokenholderTerms.GENERAL_VOTING_DURATION.add(36000).toNumber());
        // mine block otherwise ganache provides wrong block timestamp in call
        await mineBlock();
        await expectVotingResult(resolutionId, true);
        // execute
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.TagAlong,
          docUrl,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.TagAlong,
          GovExecutionState.Completed,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.TagAlong, GovExecutionState.Completed);
      });

      it("should reject resolution if voting not passed", async () => {
        // RestrictedNone is a SHR with longer duration and typically larger majority and quorum
        let tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.RestrictedNone,
          docUrl,
          { from: company },
        );
        // vote but against
        await votingCenter.vote(resolutionId, false, { from: investors[0] });
        // move to tally
        await increaseTime(defaultTokenholderTerms.RESTRICTED_ACT_VOTING_DURATION.toNumber());
        // cast offchain vote
        await votingCenter.addOffchainVote(
          resolutionId,
          tokensToShares("1299"),
          zero,
          "free lunch",
          { from: company },
        );
        await expectVotingResult(resolutionId, false);
        // tally is over, execute
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.RestrictedNone,
          docUrl,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.RestrictedNone,
          GovExecutionState.Rejected,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        const resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(
          resolution,
          resolutionId,
          GovAction.RestrictedNone,
          GovExecutionState.Rejected,
        );
      });

      it("should execute SHR with campaign", async () => {
        // None is a standard SHR with tokenholder initative
        let tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          // tokenholder starts
          { from: investors[0] },
        );
        // a silent start and resolution will not be present
        expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;
        expect(hasEvent(tx, "LogResolutionExecuted")).to.be.false;
        const bylaw = await tokenholderRights.getBylaw(GovAction.None);
        await expectVoting(resolutionId, GovAction.None, "0x0".concat(bylaw.toString(16)), true);
        // check status again - still new
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          { from: company },
        );
        expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;

        // vote and push forward
        await votingCenter.vote(resolutionId, true, { from: investors[0] });
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          { from: company },
        );
        // now the resolution is really started
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.None,
          GovExecutionState.Escalating,
        );
        // move to tally
        await increaseTime(defaultTokenholderTerms.GENERAL_VOTING_DURATION.toNumber());
        // should be still escalating
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );
        let resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.None, GovExecutionState.Escalating);
        // cast offchain vote
        await votingCenter.addOffchainVote(
          resolutionId,
          tokensToShares("0"),
          tokensToShares("1299"),
          "free lunch",
          { from: company },
        );
        // tally is over, execute
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.None,
          GovExecutionState.Completed,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.None, GovExecutionState.Completed);
      });

      it("should start and execute campaign SHR in final", async () => {
        // None is a standard SHR with tokenholder initative
        let tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          // tokenholder starts
          { from: investors[0] },
        );

        // vote and push forward
        await votingCenter.vote(resolutionId, true, { from: investors[0] });
        // move to final, skipping tally due to timeout - still voting is valid if enough power participated
        await increaseTime(
          defaultTokenholderTerms.GENERAL_VOTING_DURATION.add(
            defaultTokenholderTerms.VOTING_FINALIZATION_DURATION,
          )
            .add(60)
            .toNumber(),
        );
        // tally is over, execute
        tx = await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );
        // now the resolution is really started
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.None,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.None,
          GovExecutionState.Completed,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        const resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.None, GovExecutionState.Completed);
      });

      it("reverts on failed campaign SHR in final", async () => {
        await governanceEngine.executeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          // tokenholder starts
          { from: investors[0] },
        );

        // move to final because of failed campaign
        await increaseTime(defaultTokenholderTerms.GENERAL_VOTING_DURATION.toNumber());

        // execution is rejected
        await expect(
          governanceEngine.executeAtomically(resolutionId, payload, GovAction.None, docUrl),
        ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      });

      it("should fail on validator not new", async () => {
        let tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Escalating,
        );
        expect(await governanceEngine.addressPayload()).to.eq(ZERO_ADDRESS);
        // repeat to get escalation result, anyone can
        tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
        );
        expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;
        expect(await governanceEngine.addressPayload()).to.eq(ZERO_ADDRESS);
        // mock validator to fail on payload
        await governanceEngine._mockValidator(payload);
        tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.EstablishAuthorizedCapital,
          docUrl,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Failed,
        );
        const failedCode = soliditySha3({ type: "string", value: "NF_TEST_INVALID_ADDR_PAYLOAD" });
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.EstablishAuthorizedCapital,
          GovExecutionState.Failed,
          failedCode,
        );
      });
    });

    describe("with non atomic execution", () => {
      it("should execute single resolution", async () => {
        let tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.None,
          GovExecutionState.Escalating,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        const resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(resolution, resolutionId, GovAction.None, GovExecutionState.Escalating);

        // vote and push forward
        await votingCenter.vote(resolutionId, true, { from: investors[0] });
        // move to final, skipping tally due to timeout - still voting is valid if enough power participated
        await increaseTime(
          defaultTokenholderTerms.GENERAL_VOTING_DURATION.add(
            defaultTokenholderTerms.VOTING_FINALIZATION_DURATION,
          )
            .add(60)
            .toNumber(),
        );
        // ready to execute
        tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );

        // continue execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        expect(await governanceEngine.addressPayload()).to.eq(ZERO_ADDRESS);
        const continueTx = await governanceEngine.continueNonAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          { from: investors[1] }, // anyone can push execution forward
        );
        expect(hasEvent(continueTx, "LogResolutionExecuted")).to.be.false;
        expect(await governanceEngine.addressPayload()).to.eq(payload);
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.None,
          GovExecutionState.Executing,
        );
        // one more time
        await governanceEngine._setPayload(ZERO_ADDRESS);
        await governanceEngine.continueNonAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          { from: investors[1] }, // anyone can push execution forward
        );
        expect(await governanceEngine.addressPayload()).to.eq(payload);

        // finalize execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        // anyone can finalize
        const finalizeTx = await governanceEngine.finalizeAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
          { from: nominee },
        );
        expectLogResolutionExecuted(
          finalizeTx,
          0,
          resolutionId,
          GovAction.None,
          GovExecutionState.Completed,
        );
        expect(await governanceEngine.addressPayload()).to.eq(payload);
        await expectResolutionById(
          governanceEngine,
          resolutionId,
          GovAction.None,
          GovExecutionState.Completed,
        );
      });

      it("rejects continuation on escalation", async () => {
        const tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.TagAlong,
          docUrl,
          { from: nominee },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          "",
          docUrl,
          GovAction.TagAlong,
          GovExecutionState.Escalating,
        );
        expect(await governanceEngine.resolutionsList()).to.be.deep.eq([resolutionId]);
        const resolution = await governanceEngine.resolution(resolutionId);
        expectResolution(
          resolution,
          resolutionId,
          GovAction.TagAlong,
          GovExecutionState.Escalating,
        );

        // continue execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        expect(await governanceEngine.addressPayload()).to.eq(ZERO_ADDRESS);
        await expect(
          governanceEngine.continueNonAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: investors[1] }, // anyone can push execution forward
          ),
        ).to.be.rejectedWith("NF_GOV_NOT_EXECUTING");
      });

      it("rejects continuation on rejected voting", async () => {
        await governanceEngine.executeNonAtomically(resolutionId, payload, GovAction.None, docUrl, {
          from: company,
        });
        // make whole token to vote against
        await votingCenter.vote(resolutionId, false, { from: investors[0] });
        // move to final, skipping tally due to timeout
        await increaseTime(
          defaultTokenholderTerms.GENERAL_VOTING_DURATION.add(
            defaultTokenholderTerms.VOTING_FINALIZATION_DURATION,
          )
            .add(60)
            .toNumber(),
        );
        // continue execution
        await governanceEngine._setPayload(ZERO_ADDRESS);
        expect(await governanceEngine.addressPayload()).to.eq(ZERO_ADDRESS);
        await expect(
          governanceEngine.continueNonAtomically(
            resolutionId,
            payload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: investors[1] }, // anyone can push execution forward
          ),
        ).to.be.rejectedWith("NF_GOV_NOT_EXECUTING");
        const tx = await governanceEngine.executeNonAtomically(
          resolutionId,
          payload,
          GovAction.None,
          docUrl,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.None,
          GovExecutionState.Rejected,
        );
      });
    });

    it("should compute total voting power", async () => {
      // change shareCapital and get raw token storage
    });
  });

  describe("escalations", () => {
    const payload = randomAddress();
    const docUrl = "uri:90283092809209832";

    const makeResolution = (initiator, action, resolutionId) =>
      governanceEngine.executeNonAtomically(resolutionId, payload, action, docUrl, {
        from: initiator,
      });

    const expectResStarted = (tx, action, resolutionId, state = GovExecutionState.Executing) =>
      expectLogResolutionStarted(tx, 0, resolutionId, "", docUrl, action, state);

    const expectAccessDenied = (initiator, action, resolutionId) =>
      expect(makeResolution(initiator, action, resolutionId)).to.be.rejectedWith(
        "NF_GOV_EXEC_ACCESS_DENIED",
      );

    it("should escalate all cases", async () => {
      // generate bylaws with all escalation cases
      const templateBylaw = [
        GovActionEscalation.Anyone,
        bn(dayInSeconds),
        Q18,
        Q18,
        Q18.mul("0.7"),
        GovTokenVotingRule.Prorata,
        GovActionLegalRep.None,
        GovActionLegalRep.Nominee,
        false,
      ];
      const sourceTerms = Object.assign({}, defaultTokenholderTerms, nonVotingRightsOvr);
      const bylaws = generateDefaultBylaws(sourceTerms);
      const escalations = Object.keys(GovActionEscalation);
      for (let ii = 0; ii < escalations.length; ii += 1) {
        templateBylaw[0] = ii;
        // for shr, legal rep is company, otherwise we keep nominee default
        if (ii === GovActionEscalation.SHR) {
          templateBylaw[6] = GovActionLegalRep.CompanyLegalRep;
          templateBylaw[7] = GovActionLegalRep.CompanyLegalRep;
        }
        bylaws[ii] = encodeBylaw(...templateBylaw);
      }
      const terms = applyBylawsToRights(sourceTerms, bylaws);
      await deployGovernanceEngine(terms, true);

      // we issue tokens using share as an unit
      const holders = {};
      holders[investors[2]] = bn("1200.5");
      await issueTokensToHolders(holders);

      for (let ii = 0; ii < escalations.length; ii += 1) {
        const resolutionId = randomBytes32();
        const resolutionId2 = randomBytes32();
        let tx;
        switch (ii) {
          case GovActionEscalation.Anyone:
            // anyone can initate resolution
            tx = await makeResolution(anyone, ii, resolutionId);
            expectResStarted(tx, ii, resolutionId);
            break;
          case GovActionEscalation.TokenHolder:
            await expectAccessDenied(investors[1], ii, resolutionId);
            // issue token
            await equityToken.issueTokens("1", { from: investors[1] });
            tx = await makeResolution(investors[1], ii, resolutionId);
            expectResStarted(tx, ii, resolutionId);
            break;
          case GovActionEscalation.CompanyLegalRep:
            await expectAccessDenied(investors[2], ii, resolutionId);
            await expectAccessDenied(nominee, ii, resolutionId);
            tx = await makeResolution(company, ii, resolutionId);
            expectResStarted(tx, ii, resolutionId);
            break;
          case GovActionEscalation.Nominee:
            await expectAccessDenied(investors[2], ii, resolutionId);
            await expectAccessDenied(company, ii, resolutionId);
            tx = await makeResolution(nominee, ii, resolutionId);
            expectResStarted(tx, ii, resolutionId);
            break;
          case GovActionEscalation.CompanyOrNominee:
            await expectAccessDenied(investors[2], ii, resolutionId);
            tx = await makeResolution(nominee, ii, resolutionId);
            expectResStarted(tx, ii, resolutionId);
            tx = await makeResolution(company, ii, resolutionId2);
            expectResStarted(tx, ii, resolutionId2);
            break;
          case GovActionEscalation.THR:
            // can't be started by token holder
            await expectAccessDenied(investors[2], ii, resolutionId);
            await expectAccessDenied(company, ii, resolutionId);
            // can be started by nominee
            tx = await makeResolution(nominee, ii, resolutionId);
            expectResStarted(tx, ii, resolutionId, GovExecutionState.Escalating);
            await expectVoting(resolutionId, ii, bylaws[ii], false);
            break;
          case GovActionEscalation.SHR:
            // can't be started by token holder
            await expectAccessDenied(investors[2], ii, resolutionId);
            await expectAccessDenied(nominee, ii, resolutionId);
            // can be started by company
            tx = await makeResolution(company, ii, resolutionId);
            expectResStarted(tx, ii, resolutionId, GovExecutionState.Escalating);
            await expectVoting(resolutionId, ii, bylaws[ii], false);
            break;
          default:
            break;
        }
      }
    });

    it("should escalate with token holder voting initative", async () => {
      // generate bylaws with all escalation cases
      const THRBylaw = [
        GovActionEscalation.THR,
        bn(dayInSeconds),
        Q18.mul("0.5"),
        Q18.mul("0.5"),
        zero,
        GovTokenVotingRule.Positive,
        GovActionLegalRep.None,
        GovActionLegalRep.Nominee,
        true,
      ];
      const SHRBylaw = [
        GovActionEscalation.SHR,
        bn(dayInSeconds),
        Q18.mul("0.25"),
        Q18.mul("0.5"),
        Q18.mul("0.7"),
        GovTokenVotingRule.Negative,
        GovActionLegalRep.CompanyLegalRep,
        GovActionLegalRep.CompanyLegalRep,
        true,
      ];

      const sourceTerms = Object.assign({}, defaultTokenholderTerms, votingRightsOvr);
      const bylaws = generateDefaultBylaws(sourceTerms);
      bylaws[GovAction.None] = encodeBylaw(...THRBylaw);
      bylaws[GovAction.RestrictedNone] = encodeBylaw(...SHRBylaw);
      const terms = applyBylawsToRights(sourceTerms, bylaws);
      await deployGovernanceEngine(terms, true);

      // set value which gives enough total voting power to start camapiging in SHR
      const totalVotingPower = await shareCapitalVotingPower(defEtoTerms.EXISTING_SHARE_CAPITAL);
      await equityToken.issueTokens(totalVotingPower.div("4").floor(), { from: investors[2] });
      await advanceSnapshotId();
      // holders[investors[2]] = totalVotingPower.div("4").floor();
      // await issueTokensToHolders(holders);

      // THR bylaw
      let resolutionId = randomBytes32();
      await expectAccessDenied(investors[1], GovAction.None, resolutionId);
      await expectAccessDenied(company, GovAction.None, resolutionId);
      // can be started by token holder
      let tx = await makeResolution(investors[2], GovAction.None, resolutionId);
      // event will not be generated until quorum will be passed
      expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;
      await expectVoting(resolutionId, GovAction.None, bylaws[GovAction.None], true);

      // SHR bylaw
      resolutionId = randomBytes32();
      await expectAccessDenied(investors[1], GovAction.RestrictedNone, resolutionId);
      await expectAccessDenied(nominee, GovAction.RestrictedNone, resolutionId);
      // can be started by token holder
      tx = await makeResolution(investors[2], GovAction.RestrictedNone, resolutionId);
      // event will not be generated until quorum will be passed
      expect(hasEvent(tx, "LogResolutionStarted")).to.be.false;
      await expectVoting(
        resolutionId,
        GovAction.RestrictedNone,
        bylaws[GovAction.RestrictedNone],
        true,
      );

      // SHR bylaw with not enough voting power in token for campaign
      await equityToken.destroyTokens(totalVotingPower.div("6").floor(), { from: investors[2] });
      await advanceSnapshotId();
      resolutionId = randomBytes32();
      await expect(
        makeResolution(investors[2], GovAction.RestrictedNone, resolutionId),
      ).to.be.rejectedWith("NF_VC_NO_CAMP_VOTING_POWER");

      // SHR bylaw with more power in the token that total power in share capital
      await equityToken.issueTokens(totalVotingPower, { from: investors[1] });
      await advanceSnapshotId();
      resolutionId = randomBytes32();
      await expect(
        makeResolution(investors[2], GovAction.RestrictedNone, resolutionId),
      ).to.be.rejectedWith("NF_VC_TOTPOWER_LT_TOKEN");
    });
  });

  describe("evaluate passing proposal", () => {
    function mockStandardBylaws(standardRights, bylawsOvr) {
      const sourceTerms = Object.assign({}, defaultTokenholderTerms, standardRights);
      const bylaws = generateDefaultBylaws(sourceTerms);

      for (let ii = 0; ii < bylawsOvr.length; ii += 1) {
        bylaws[ii] = encodeBylaw(...bylawsOvr[ii]);
      }

      return applyBylawsToRights(sourceTerms, bylaws);
    }

    it("should evaluate positive voting rule", async () => {
      // 35% quorum 70% majority, absolute majority disabled
      const quorumMajorityBylaw = [
        GovActionEscalation.Anyone,
        bn(dayInSeconds),
        Q18.mul("0.35"),
        Q18.mul("0.7"),
        zero,
        GovTokenVotingRule.Positive,
        GovActionLegalRep.Nominee,
        GovActionLegalRep.Nominee,
        false,
      ];
      // 81% absolute voting majority
      const absoluteMajorityBylaw = [
        GovActionEscalation.Anyone,
        bn(dayInSeconds),
        Q18.mul("0.35"),
        Q18.mul("0.7"),
        Q18.mul("0.81"),
        GovTokenVotingRule.Positive,
        GovActionLegalRep.Nominee,
        GovActionLegalRep.Nominee,
        false,
      ];
      const terms = mockStandardBylaws(votingRightsOvr, [
        quorumMajorityBylaw,
        absoluteMajorityBylaw,
      ]);
      await deployGovernanceEngine(terms, true);

      // all voting power in the token, simple majority votes no to get rejected
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5"),
          Q18.mul("0.5"),
          zero,
          zero,
          Q18,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5").add(1),
          Q18.mul("0.5").sub(1),
          zero,
          zero,
          Q18,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5").sub(1),
          Q18.mul("0.5").add(1),
          zero,
          zero,
          Q18,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);

      // quorum in the token, zero off-chain voting
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.175"),
          Q18.mul("0.175"),
          zero,
          zero,
          Q18.mul("0.35"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // wei below the quorum
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.175"),
          Q18.mul("0.175").sub(1),
          zero,
          zero,
          Q18.mul("0.35").sub(1),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);

      // minority in the token, quorum in off chain
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.15"),
          Q18.mul("0.15"),
          zero,
          Q18.mul("0.05"),
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // less than quorum
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.15"),
          Q18.mul("0.15"),
          zero,
          Q18.mul("0.05").sub(1),
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // quorum + wei below majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.15"),
          Q18.mul("0.15"),
          Q18.mul("0.4"),
          Q18.mul("0.3"),
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // quorum + simple majority (sub(2) because of rounding down)
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.15"),
          Q18.mul("0.15"),
          Q18.mul("0.4"),
          Q18.mul("0.3").sub(2),
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);

      // no token power, all off chain
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          zero,
          zero,
          Q18.mul("0.3"),
          Q18.mul("0.05").sub(1),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          zero,
          zero,
          Q18.mul("0.3"),
          Q18.mul("0.05"),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // almost simple majority of 0.7
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          zero,
          zero,
          Q18.mul("0.426343822982"),
          Q18.mul("0.182718781278"),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // simple majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          zero,
          zero,
          Q18.mul("0.426343822982"),
          Q18.mul("0.182718781278").sub(1),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);

      // absolute majority, token has absolute majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          Q18.mul("0.405"),
          zero,
          zero,
          Q18.mul("0.81").add(1),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // token goes veto
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          Q18.mul("0.405").sub(1),
          Q18.mul("0.405").add(1),
          zero,
          zero,
          Q18.mul("0.81").add(1),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // token has wei below absolute majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          Q18.mul("0.405"),
          zero,
          zero,
          Q18.mul("0.81"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);

      // minority in the token + off chain
      // token votes no, not enough off-chain yes
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          Q18.mul("0.21"),
          Q18.mul("0.81"),
          zero,
          Q18.mul("0.25"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // absolute majority reached
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          Q18.mul("0.21"),
          Q18.mul("0.81").add(1),
          zero,
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // token votes yes, not enough off-chain
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          zero,
          Q18.mul("0.51"),
          zero,
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          zero,
          Q18.mul("0.51").add(1),
          zero,
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);

      // no token power, all off chain
      // almost simple majority of 0.81
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          zero,
          Q18.mul("0.81"),
          zero,
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // simple majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          zero,
          zero,
          Q18.mul("0.81").add(1),
          Q18.mul("0.19").sub(1),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
    });

    it("should evaluate positive voting rule", async () => {
      // 51% quorum 10% majority, absolute majority disabled
      const quorumMajorityBylaw = [
        GovActionEscalation.Anyone,
        bn(dayInSeconds),
        Q18.mul("0.51"),
        Q18.mul("0.1"),
        zero,
        GovTokenVotingRule.Negative,
        GovActionLegalRep.Nominee,
        GovActionLegalRep.Nominee,
        false,
      ];
      // 51% absolute voting majority
      const absoluteMajorityBylaw = [
        GovActionEscalation.Anyone,
        bn(dayInSeconds),
        zero,
        zero,
        Q18.mul("0.51"),
        GovTokenVotingRule.Negative,
        GovActionLegalRep.Nominee,
        GovActionLegalRep.Nominee,
        false,
      ];
      const terms = mockStandardBylaws(votingRightsOvr, [
        quorumMajorityBylaw,
        absoluteMajorityBylaw,
      ]);
      await deployGovernanceEngine(terms, true);

      // all voting power in the token, simple majority votes yes to pass the decision
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5"),
          Q18.mul("0.5"),
          zero,
          zero,
          Q18,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5").add(1),
          Q18.mul("0.5"),
          zero,
          zero,
          Q18,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5"),
          Q18.mul("0.5").sub(1),
          zero,
          zero,
          Q18,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // quorum in the token
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.255"),
          Q18.mul("0.255"),
          zero,
          zero,
          Q18.mul("0.51"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // wei below the quorum
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.255"),
          Q18.mul("0.255").sub(1),
          zero,
          zero,
          Q18.mul("0.51").sub(1),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // reaching quorum
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.255").add(1),
          Q18.mul("0.25"),
          zero,
          zero,
          Q18.mul("0.51"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);

      // minority in the token, quorum in off chain
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.25"),
          Q18.mul("0.2"),
          zero,
          Q18.mul("0.01").sub(1),
          Q18.mul("0.5"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // less than quorum
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.25").add(1),
          zero,
          zero,
          Q18.mul("0.01"),
          Q18.mul("0.5"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // quorum + wei below majority (token votes no)
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.25"),
          Q18.mul("0.25"),
          Q18.mul("0.1"),
          Q18.mul("0.4"),
          Q18.mul("0.5"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // quorum + simple majority (token votes no)
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.25"),
          Q18.mul("0.25"),
          Q18.mul("0.1").add(1),
          Q18.mul("0.4").sub(1),
          Q18.mul("0.5"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // quorum + simple majority (token votes yes)
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.1"),
          zero,
          one,
          Q18.mul("0.9").sub(1),
          Q18.mul("0.1"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.1"),
          zero,
          zero,
          Q18.mul("0.9").sub(1),
          Q18.mul("0.1"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);

      // absolute majority 51%

      // minority in the token + off chain
      // token votes no, not enough off-chain yes
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          Q18.mul("0.15"),
          zero,
          Q18.mul("0.51"),
          zero,
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // absolute majority reached
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          Q18.mul("0.15"),
          zero,
          Q18.mul("0.51").add(1),
          zero,
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // token votes yes, not enough off-chain
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          Q18.mul("0.15").add(1),
          zero,
          Q18.mul("0.21"),
          zero,
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          Q18.mul("0.15").add(1),
          zero,
          Q18.mul("0.21").add(1),
          zero,
          Q18.mul("0.3"),
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
    });

    it("should evaluate prorata voting rule", async () => {
      // 50% quorum 60% majority, absolute majority disabled
      const quorumMajorityBylaw = [
        GovActionEscalation.Anyone,
        bn(dayInSeconds),
        Q18.mul("0.5"),
        Q18.mul("0.6"),
        zero,
        GovTokenVotingRule.Prorata,
        GovActionLegalRep.Nominee,
        GovActionLegalRep.Nominee,
        false,
      ];
      // 75% absolute voting majority
      const absoluteMajorityBylaw = [
        GovActionEscalation.Anyone,
        bn(dayInSeconds),
        zero,
        zero,
        Q18.mul("0.75"),
        GovTokenVotingRule.Prorata,
        GovActionLegalRep.Nominee,
        GovActionLegalRep.Nominee,
        false,
      ];
      const terms = mockStandardBylaws(votingRightsOvr, [
        quorumMajorityBylaw,
        absoluteMajorityBylaw,
      ]);
      await deployGovernanceEngine(terms, true);

      // token and off-chain voting power should add up in pro-rata
      const pro = Q18.mul("0.866025403784438647");
      const contra = Q18.mul("0.5773502691896257645");
      const total = pro.add(contra);
      // quorum, no majority
      expect(
        await governanceEngine._hasProposalPassed.call(0, pro, contra, zero, zero, zero, total),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // has both quorum and majority (add 2 for rounding errors)
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          pro.add(2),
          contra.sub(2),
          zero,
          zero,
          zero,
          total,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // no quorum but majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5").sub(1),
          zero,
          zero,
          zero,
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // both quorum and majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.5"),
          zero,
          zero,
          zero,
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);

      // minority in the token, quorum in off chain
      const inToken = Q18.mul("0.2");
      const proOffchain = pro.sub(inToken);
      const contraOffchain = contra.sub(inToken);
      // quorum, no majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          inToken,
          inToken,
          proOffchain,
          contraOffchain,
          zero,
          total,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // has both quorum and majority (add 2 for rounding errors)
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          inToken,
          inToken,
          proOffchain.add(2),
          contraOffchain.sub(2),
          zero,
          total,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
      // no quorum but majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.2"),
          zero,
          Q18.mul("0.2").sub(1),
          Q18.mul("0.1"),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // both quorum and majority
      expect(
        await governanceEngine._hasProposalPassed.call(
          0,
          Q18.mul("0.2"),
          zero,
          Q18.mul("0.2"),
          Q18.mul("0.1"),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);

      // absolute majority 51%

      // minority in the token + off chain
      // absolute majority not reached
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          Q18.mul("0.25"),
          one,
          Q18.mul("0.50"),
          Q18.mul("0.24"),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Rejected);
      // absolute majority reached
      expect(
        await governanceEngine._hasProposalPassed.call(
          1,
          Q18.mul("0.25").add(1),
          one,
          Q18.mul("0.50"),
          Q18.mul("0.24"),
          zero,
          Q18,
        ),
      ).to.be.bignumber.eq(GovExecutionState.Executing);
    });
  });

  async function shareCapitalVotingPower(shareCapital) {
    return shareCapitalToTokens(
      shareCapital,
      await equityToken.tokensPerShare(),
      await equityToken.shareNominalValueUlps(),
    );
  }

  async function expectVoting(resolutionId, action, bylaw, withCampaign) {
    const decodedBylaw = decodeBylaw(action, bylaw);
    const proposal = await votingCenter.timedProposal(resolutionId);
    const supply = await equityToken.totalSupplyAt(proposal[2]);
    const state = withCampaign ? ProposalState.Campaigning : ProposalState.Public;
    expect(proposal[0]).to.be.bignumber.eq(state);
    expect(proposal[3]).to.eq(governanceEngine.address);
    let totalVotingPower = supply;
    if (decodedBylaw[7].eq(GovActionLegalRep.None)) {
      // no offchain
      expect(proposal[4]).to.eq(ZERO_ADDRESS);
      expect(proposal[6]).to.be.bignumber.eq(zero);
    } else {
      const legalRepAddr = decodedBylaw[7].eq(GovActionLegalRep.Nominee) ? nominee : company;
      expect(proposal[4]).to.eq(legalRepAddr);
      totalVotingPower = await shareCapitalVotingPower(defEtoTerms.EXISTING_SHARE_CAPITAL);
      const offchainVotingPower = totalVotingPower.sub(supply);
      expect(proposal[6]).to.be.bignumber.eq(offchainVotingPower);
    }
    // action
    expect(proposal[7]).to.be.bignumber.eq(action);
    // must have payload
    expect(proposal[8].length).to.gt(3);
    // no observer
    expect(proposal[9]).to.eq(false);
    const deadlines = proposal[10];
    const votingPeriod = deadlines[ProposalState.Reveal].sub(deadlines[ProposalState.Campaigning]);
    if (withCampaign) {
      // campaign quorum must be majority of quorum
      const majOfQuorumFrac = decodedBylaw[3]
        .mul(decodedBylaw[4])
        .div(Q18)
        .floor();
      const campaignTokenQuorum = divRound(majOfQuorumFrac.mul(totalVotingPower), Q18);
      expect(proposal[5]).to.be.bignumber.eq(campaignTokenQuorum);
      // voting period must be twice bylaw
      expect(votingPeriod).to.be.bignumber.eq(decodedBylaw[2].mul(2));
    } else {
      expect(votingPeriod).to.be.bignumber.eq(decodedBylaw[2]);
    }
  }

  async function expectVotingResult(resolutionId, expectedResult) {
    if (typeof expectedResult === "string") {
      await expect(
        governanceEngine.votingResult(votingCenter.address, resolutionId),
      ).to.be.rejectedWith(expectedResult);
    } else {
      expect(await governanceEngine.votingResult(votingCenter.address, resolutionId)).eq(
        expectedResult,
      );
    }
  }

  async function deployGovernanceEngine(termsOvr, fullTerms = false) {
    [tokenholderRights] = await deployTokenholderRights(TokenholderRights, termsOvr, fullTerms);
    const controller = await TestTokenControllerPassThrough.new();
    const [tokenTerms] = await deployTokenTerms(ETOTokenTerms);
    equityToken = await EquityToken.new(
      universe.address,
      controller.address,
      tokenTerms.address,
      nominee,
      company,
    );
    await equityToken.amendAgreement("AGREEMENT#HASH", { from: nominee });
    governanceEngine = await TestControllerGovernanceEngine.new(
      universe.address,
      company,
      equityToken.address,
      tokenholderRights.address,
      GovState.Funded,
      defEtoTerms.EXISTING_SHARE_CAPITAL,
    );
  }

  async function advanceSnapshotId() {
    // move to the next day
    await increaseTime(dayInSeconds);
  }

  async function issueTokensToHolders(allocation) {
    // allocation of whole tokens
    const tps = await equityToken.tokensPerShare();
    for (const key of Object.keys(allocation)) {
      await equityToken.issueTokens(allocation[key].mul(tps), { from: key });
    }
    // seal snapshot
    await advanceSnapshotId();
  }

  function tokensToShares(shares) {
    return defTokenTerms.EQUITY_TOKENS_PER_SHARE.mul(shares);
  }
});
