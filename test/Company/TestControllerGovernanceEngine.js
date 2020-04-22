import { expect } from "chai";
import { soliditySha3, sha3 } from "web3-utils";
import { deployUniverse } from "../helpers/deployContracts";
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
  encodeBylaw,
  deployTokenTerms,
  defaultTokenholderTerms,
} from "../helpers/deployTerms";
import {
  expectLogResolutionStarted,
  expectLogResolutionExecuted,
  expectResolution,
  expectResolutionById,
} from "../helpers/govUtils";
import { hasEvent } from "../helpers/events";

const TokenholderRights = artifacts.require("EquityTokenholderRights");
const TestControllerGovernanceEngine = artifacts.require("TestControllerGovernanceEngine");
const TestTokenControllerPassThrough = artifacts.require("TestTokenControllerPassThrough");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const EquityToken = artifacts.require("EquityToken");

contract("TestControllerGovernanceEngine", ([_, admin, company, nominee, anyone, ...investors]) => {
  let universe;
  let tokenholderRights;
  let governanceEngine;
  let equityToken;

  const votingRightsOvr = {
    GENERAL_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.Positive),
    TAG_ALONG_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.Negative),
  };
  const nonVotingRightsOvr = {
    GENERAL_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.NoVotingRights),
    TAG_ALONG_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.NoVotingRights),
  };

  beforeEach(async () => {
    [universe] = await deployUniverse(admin, admin);
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
        expect(resolution[5]).to.eq(`0x${sha3(txdata.input, { encoding: "hex" })}`);
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
        ).to.be.rejectedWith("NF_GOV_RESOLUTION_TERMINATED");
        const newPayload = randomAddress();
        await expect(
          governanceEngine.executeAtomically(
            resolutionId,
            newPayload,
            GovAction.EstablishAuthorizedCapital,
            docUrl,
            { from: company },
          ),
        ).to.be.rejectedWith("NF_GOV_RESOLUTION_TERMINATED");
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

      it("should escalate on THR", async () => {
        // even with no voting rights, several action require THR
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
        expect(resolution[5]).to.eq(`0x${sha3(txdata.input, { encoding: "hex" })}`);
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
        ).to.be.rejectedWith("NF_GOV_RESOLUTION_TERMINATED");
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

      it("should execute many", async () => {});
    });

    describe("escalations", () => {
      it("should escalate all cases", async () => {
        // generate bylaws with all escalation cases
        const templateBylaw = [
          GovActionEscalation.Anyone,
          new web3.BigNumber(dayInSeconds),
          Q18,
          Q18,
          Q18.mul("0.7"),
          GovTokenVotingRule.Prorata,
          GovActionLegalRep.Nominee,
        ];
        const sourceTerms = Object.assign({}, defaultTokenholderTerms, nonVotingRightsOvr);
        const bylaws = generateDefaultBylaws(sourceTerms);
        const escalations = Object.keys(GovActionEscalation);
        for (let ii = 0; ii < escalations.length; ii += 1) {
          templateBylaw[0] = ii;
          // for shr, legal rep is company, otherwise we keep nominee default
          if (ii === GovActionEscalation.SHR) {
            templateBylaw[6] = GovActionLegalRep.CompanyLegalRep;
          }
          bylaws[ii] = encodeBylaw(...templateBylaw);
        }
        const terms = applyBylawsToRights(sourceTerms, bylaws);
        await deployGovernanceEngine(terms, true);

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

        await equityToken.issueTokens("1", { from: investors[2] });

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
              break;
            case GovActionEscalation.SHR:
              // can't be started by token holder
              await expectAccessDenied(investors[2], ii, resolutionId);
              await expectAccessDenied(nominee, ii, resolutionId);
              // can be started by company
              tx = await makeResolution(company, ii, resolutionId);
              expectResStarted(tx, ii, resolutionId, GovExecutionState.Escalating);
              break;
            default:
              break;
          }
        }
      });
    });
  });

  describe("with voting rights", async () => {
    beforeEach(async () => {
      await deployGovernanceEngine(votingRightsOvr);
    });

    it("should fail on validator not new", async () => {
      const resolutionId = randomBytes32();
      const payload = randomAddress();
      const docUrl = "uri:90283092809209832";
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
    );
  }
});
