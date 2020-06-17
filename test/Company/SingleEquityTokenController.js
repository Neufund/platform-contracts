import { expect } from "chai";
import {
  deployPlatformTerms,
  deployUniverse,
  deployEuroTokenUniverse,
  deployIdentityRegistry,
  deployFeeDisbursalUniverse,
} from "../helpers/deployContracts";
import { ZERO_ADDRESS, Q18, decimalBase, daysToSeconds } from "../helpers/constants";
import { contractId, randomBytes32, promisify, toBytes32 } from "../helpers/utils";
import { prettyPrintGasCost, printCodeSize } from "../helpers/gasUtils";
import {
  GovState,
  GovAction,
  GovExecutionState,
  GovTokenType,
  GovTokenState,
  GovTokenVotingRule,
} from "../helpers/govState";
import {
  expectLogResolutionStarted,
  expectLogResolutionExecuted,
  expectLogGovStateTransition,
  expectResolution,
  getCommitmentResolutionId,
  expectResolutionById,
} from "../helpers/govUtils";
import { CommitmentState } from "../helpers/commitmentState";
import { divRound } from "../helpers/unitConverter";
import {
  deployDurationTerms,
  deployETOTerms,
  deployTokenholderRights,
  deployTokenTerms,
  deployETOTermsConstraintsUniverse,
} from "../helpers/deployTerms";
import { knownInterfaces } from "../helpers/knownInterfaces";
import { decodeLogs, eventValue, hasEvent } from "../helpers/events";
import {
  basicTokenTests,
  deployTestErc223Callback,
  deployTestErc677Callback,
  erc223TokenTests,
  erc677TokenTests,
  standardTokenTests,
} from "../helpers/tokenTestCases";
import createAccessPolicy from "../helpers/createAccessPolicy";
import roles from "../helpers/roles";
import { ffControllerV0, greypControllerV3 } from "./bin/legacyControllers";
import { expectLogDisbursalCreated } from "../helpers/disbursal";

const coder = require("web3-eth-abi");

const GovLibrary = artifacts.require("Gov");
const FeeDisbursal = artifacts.require("FeeDisbursal");
const ETOTermsConstraints = artifacts.require("ETOTermsConstraints");
const SingleEquityTokenController = artifacts.require("SingleEquityTokenController");
const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const TokenholderRights = artifacts.require("EquityTokenholderRights");
const EquityToken = artifacts.require("EquityToken");
const TestETOCommitmentSingleTokenController = artifacts.require(
  "TestETOCommitmentSingleTokenController",
);
const MockSingleEquityTokenController = artifacts.require("MockSingleEquityTokenController");
const IControllerGovernancev13 = artifacts.require("IControllerGovernance_v1_3");
const zero = new web3.BigNumber(0);
const ZERO_GOVERNANCE_TOKEN = [ZERO_ADDRESS, zero, zero, ZERO_ADDRESS, false];

contract("SingleEquityTokenController", ([_, admin, company, nominee, ...investors]) => {
  let equityToken;
  let equityTokenController;
  let accessPolicy;
  let universe;
  let etoTerms;
  let etoTermsDict;
  let tokenTerms;
  let tokenTermsDict;
  let testCommitment;
  let tokenholderRights;
  let durationTerms;
  let termsConstraints;

  const votingRightsOvr = {
    GENERAL_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.Positive),
    TAG_ALONG_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.Negative),
  };
  const nonVotingRightsOvr = {
    GENERAL_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.NoVotingRights),
    TAG_ALONG_VOTING_RULE: new web3.BigNumber(GovTokenVotingRule.NoVotingRights),
  };

  before(async () => {
    const lib = await GovLibrary.new();
    await prettyPrintGasCost("Gov deploy", lib);
    await printCodeSize("Gov code size", lib);
    GovLibrary.address = lib.address;
    await SingleEquityTokenController.link(GovLibrary, lib.address);
    await MockSingleEquityTokenController.link(GovLibrary, lib.address);
  });

  beforeEach(async () => {
    [universe, accessPolicy] = await deployUniverse(admin, admin);
    await deployPlatformTerms(universe, admin);
    // revoke voting rights so company can execute all resolutions without voting
    [tokenholderRights] = await deployTokenholderRights(TokenholderRights, nonVotingRightsOvr);
    [durationTerms] = await deployDurationTerms(ETODurationTerms);
    [tokenTerms, tokenTermsDict] = await deployTokenTerms(ETOTokenTerms);
    await deployController();
  });

  it("should deploy and check initial state", async () => {
    await prettyPrintGasCost("SingleEquityTokenController deploy", equityTokenController);
    await printCodeSize("SingleEquityTokenController code size", equityTokenController);
    expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Setup);
    const shareholderInfo = await equityTokenController.shareholderInformation();
    expect(shareholderInfo).to.deep.eq([zero, zero, zero, "", ZERO_ADDRESS]);
    const tokens = await equityTokenController.governanceToken();
    expect(tokens).to.deep.eq(ZERO_GOVERNANCE_TOKEN);

    const tokenOfferings = await equityTokenController.tokenOfferings();
    expect(tokenOfferings.length).to.eq(0);

    const cid = await equityTokenController.contractId();
    expect(cid[0]).to.eq(contractId("SingleEquityTokenController"));
    expect(cid[1]).to.be.bignumber.eq(0);
    expect(await equityTokenController.migratedTo()).to.eq(ZERO_ADDRESS);
    expect(await equityTokenController.migratedFrom()).to.eq(ZERO_ADDRESS);

    // check if all modules listed
    const moduleId = await equityTokenController.moduleId();
    // have 4 modules including top contract
    expect(moduleId[0].length).to.eq(6);
    expect(moduleId[0][0]).to.eq(contractId("ControllerGovernanceEngine"));
    expect(moduleId[1][0]).to.be.bignumber.eq(zero);
    expect(moduleId[0][1]).to.eq(contractId("ControllerGeneralInformation"));
    expect(moduleId[1][1]).to.be.bignumber.eq(zero);
    expect(moduleId[0][2]).to.eq(contractId("ControllerGovernanceToken"));
    expect(moduleId[1][2]).to.be.bignumber.eq(zero);
    expect(moduleId[0][3]).to.eq(contractId("ControllerETO"));
    expect(moduleId[1][3]).to.be.bignumber.eq(zero);
    expect(moduleId[0][4]).to.eq(contractId("ControllerDividends"));
    expect(moduleId[1][4]).to.be.bignumber.eq(zero);
    expect(moduleId[0][5]).to.eq(cid[0]);
    expect(moduleId[1][5]).to.be.bignumber.eq(cid[1]);
  });

  describe("offering actions", () => {
    beforeEach(async () => {
      await deployETO();
      await registerOffering();
    });

    it("should register ETO start", async () => {
      const tx = await runOffering();
      expect(await testCommitment.commitmentObserver()).to.eq(equityTokenController.address);
      const etcLogs = decodeLogs(
        tx,
        equityTokenController.address,
        SingleEquityTokenController.abi,
      );
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Setup, GovState.Offering);
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Offering);
      // no cap table
      expect(await equityTokenController.governanceToken()).to.deep.eq(ZERO_GOVERNANCE_TOKEN);
      // no shareholder info yet
      expect(await equityTokenController.shareholderInformation()).to.deep.eq([
        zero,
        zero,
        zero,
        "",
        ZERO_ADDRESS,
      ]);
      // no offerings registered
      expect(await equityTokenController.tokenOfferings()).to.deep.eq([]);
      // there's however a singular resolution ongoing
      const resolutions = await equityTokenController.resolutionsList();
      expect(resolutions.length).to.eq(1);
      // verify resolutionId as keccak of address packed
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      expect(resolutions[0]).to.eq(resolutionId);
      const resolution = await equityTokenController.resolution(resolutionId);
      expectResolution(
        resolution,
        resolutionId,
        GovAction.RegisterOffer,
        GovExecutionState.Executing,
      );
    });

    it("accepts ETO not registered in universe", async () => {
      await universe.setCollectionInterface(
        knownInterfaces.commitmentInterface,
        testCommitment.address,
        false,
        { from: admin },
      );
      await runOffering();
    });

    it("no state transition on second ETO start date", async () => {
      let tx = await runOffering();
      let etcLogs = decodeLogs(tx, equityTokenController.address, SingleEquityTokenController.abi);
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Setup, GovState.Offering);
      tx = await runOffering();
      etcLogs = decodeLogs(tx, equityTokenController.address, SingleEquityTokenController.abi);
      tx.logs.push(...etcLogs);
      expect(hasEvent(tx, "LogGovStateTransition")).to.be.false;
    });

    it("rejects with unknown resolution on unregistered offer", async () => {
      const oldTestCommitment = testCommitment;
      // deploy another ETO and add to universe
      await deployETO();
      // add old token controller as observer without registering
      await testCommitment.setStartDate(etoTerms.address, equityToken.address, "0");
      // try to start eto from unknown address, as resolutionId is calculated from address, it will not be known!
      await expect(runOffering()).to.be.rejectedWith("NF_GOV_NOT_EXECUTING");
      // this will still pass
      await runOffering(oldTestCommitment);
    });

    it(
      "rejects register ETO with mismatching terms, addresses, tokens and equity token controller",
    );

    it("should allow generating only by registered ETO in Offering state", async () => {
      const amount = new web3.BigNumber(281871);
      await expect(testCommitment._generateTokens(amount)).to.be.revert;
      await runOffering();
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Offering);
      await testCommitment._generateTokens(amount);
      expect(await equityToken.balanceOf(testCommitment.address)).to.be.bignumber.eq(amount);
      // single token controller does not allow the offering to destroy tokens
      await expect(testCommitment._destroyTokens(amount)).to.be.rejectedWith(
        "NF_EQTOKEN_NO_DESTROY",
      );
      expect(await equityToken.balanceOf(testCommitment.address)).to.be.bignumber.eq(amount);
      // try to issue via other address
      await expect(equityToken.issueTokens(amount, { from: company })).to.be.revert;
      // try to destroy
      await testCommitment._generateTokens(amount);
      await expect(equityToken.destroyTokens(amount, { from: company })).to.be.revert;
      // approve eto
      await testCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Claim);
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Funded);
      // should have single executed resolution
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      const resolution = await equityTokenController.resolution(resolutionId);
      expectResolution(
        resolution,
        resolutionId,
        GovAction.RegisterOffer,
        GovExecutionState.Completed,
      );
      // should not be able to issue tokens
      await expect(testCommitment._generateTokens(amount)).to.be.revert;
      await expect(testCommitment._destroyTokens(amount)).to.be.revert;
    });

    it("should approve ETO and execute transfer rights", async () => {
      // approval sets equity token in cap table, sets Agreement to ISHA, sets general company information, moves state to Funded
      await runOffering();
      const sharesAmount = new web3.BigNumber("2761");
      const amount = sharesAmount.mul(await equityToken.tokensPerShare());
      await testCommitment._generateTokens(amount);
      let tx = await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Public,
      );
      // token controller ignores this transition
      let etcLogs = decodeLogs(tx, equityTokenController.address, SingleEquityTokenController.abi);
      expect(etcLogs.length).to.eq(0);
      // go to signing - also ignores
      tx = await testCommitment._triggerStateTransition(
        CommitmentState.Public,
        CommitmentState.Signing,
      );
      etcLogs = decodeLogs(tx, equityTokenController.address, SingleEquityTokenController.abi);
      expect(etcLogs.length).to.eq(0);
      tx = await testCommitment._triggerStateTransition(
        CommitmentState.Signing,
        CommitmentState.Claim,
      );
      etcLogs = decodeLogs(tx, equityTokenController.address, SingleEquityTokenController.abi);
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Offering, GovState.Funded);
      expectLogOfferingSucceeded(tx, testCommitment.address, equityToken.address, sharesAmount);
      // all events attached to original resolutionId
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      expectLogOfferingRegistered(tx, resolutionId, testCommitment.address, equityToken.address);
      expectLogResolutionExecuted(
        tx,
        0,
        resolutionId,
        GovAction.RegisterOffer,
        GovExecutionState.Completed,
      );
      expectLogTransfersStateChanged(
        tx,
        resolutionId,
        equityToken.address,
        etoTermsDict.ENABLE_TRANSFERS_ON_SUCCESS,
      );
      const capitalIncreaseEurUlps = sharesAmount.mul(tokenTermsDict.SHARE_NOMINAL_VALUE_ULPS);
      const increasedShareCapitalUlps = etoTermsDict.EXISTING_SHARE_CAPITAL.add(
        capitalIncreaseEurUlps,
      );
      const expectedValuation = divRound(
        increasedShareCapitalUlps
          .mul(tokenTermsDict.EQUITY_TOKENS_PER_SHARE)
          .mul(tokenTermsDict.TOKEN_PRICE_EUR_ULPS)
          .divToInt(getTokenPower()),
        tokenTermsDict.SHARE_NOMINAL_VALUE_ULPS,
      );
      expectLogISHAAmended(tx, resolutionId, await testCommitment.signedInvestmentAgreementUrl());
      expectLogTokenholderRightsAmended(
        tx,
        resolutionId,
        GovTokenType.Equity,
        equityToken.address,
        tokenholderRights.address,
      );
      expectLogCompanyValuationAmended(tx, resolutionId, expectedValuation);
      expectLogShareCapitalAmended(tx, resolutionId, increasedShareCapitalUlps);
      expectLogAuthorizedCapitalEstablished(tx, resolutionId, etoTermsDict.AUTHORIZED_CAPITAL);
      // verify offerings and cap table
      expect(await equityTokenController.governanceToken()).to.deep.equal([
        equityToken.address,
        new web3.BigNumber(GovTokenType.Equity),
        new web3.BigNumber(GovTokenState.Open),
        tokenholderRights.address,
        etoTermsDict.ENABLE_TRANSFERS_ON_SUCCESS,
      ]);
      expect(await equityTokenController.tokenOfferings()).to.deep.equal([testCommitment.address]);
      // check if agreement was amended
      const agreement = await equityTokenController.currentAgreement();
      // as its signed as a result of resolution, the issuer contract is the signing party
      expect(agreement[0]).to.eq(equityTokenController.address);
      expect(agreement[2]).to.eq("RAAAAA");
      expect(agreement[3]).to.be.bignumber.eq(0);
      // resolution is completed
      const resolution = await equityTokenController.resolution(resolutionId);
      expectResolution(
        resolution,
        resolutionId,
        GovAction.RegisterOffer,
        GovExecutionState.Completed,
      );
    });

    it("should approve ETO with 0 new shares", async () => {
      // no authorized capital
      await deployETO({ AUTHORIZED_CAPITAL: zero });
      await registerOffering();
      await runOffering();
      const tx = await testCommitment._triggerStateTransition(
        CommitmentState.Signing,
        CommitmentState.Claim,
      );
      const etcLogs = decodeLogs(
        tx,
        equityTokenController.address,
        SingleEquityTokenController.abi,
      );
      tx.logs.push(...etcLogs);
      // this valuation computation with 0 shares increase is basically meaningless
      // as apparently price of a share was too high and pre money valuation was not really real...
      // so we checks math here
      const expectedValuation = divRound(
        etoTermsDict.EXISTING_SHARE_CAPITAL.mul(await tokenTerms.SHARE_PRICE_EUR_ULPS()),
        tokenTermsDict.SHARE_NOMINAL_VALUE_ULPS,
      );
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      expectLogISHAAmended(
        tx,
        resolutionId,
        await testCommitment.signedInvestmentAgreementUrl(),
        tokenholderRights.address,
      );
      expectLogCompanyValuationAmended(tx, resolutionId, expectedValuation);
      expectLogShareCapitalAmended(tx, resolutionId, etoTermsDict.EXISTING_SHARE_CAPITAL);
      // no authorized capital established after ETO
      expect(hasEvent(tx, "LogAuthorizedCapitalEstablished")).to.be.false;
    });

    it("reject approve when not in funding state", async () => {
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Whitelist, CommitmentState.Claim),
      ).to.be.rejectedWith("NF_ETC_BAD_STATE");
      await runOffering();
      await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Claim,
      );
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Whitelist, CommitmentState.Claim),
      ).to.be.rejectedWith("NF_ETC_BAD_STATE");
    });

    it("should fail ETO", async () => {
      await runOffering();
      const sharesAmount = 2761;
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);

      const tx = await testCommitment._triggerStateTransition(
        CommitmentState.Signing,
        CommitmentState.Refund,
      );
      const etcLogs = decodeLogs(
        tx,
        equityTokenController.address,
        SingleEquityTokenController.abi,
      );
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Offering, GovState.Setup);
      expectLogOfferingFailed(tx, testCommitment.address, equityToken.address);
      // no transfer change
      expect(hasEvent(tx, "LogTransfersStateChanged")).to.be.false;
      // no ISHA amended
      expect(hasEvent(tx, "LogISHAAmended")).to.be.false;
      // verify offerings and cap table
      expect(await equityTokenController.governanceToken()).to.deep.equal(ZERO_GOVERNANCE_TOKEN);
      expect(await equityTokenController.tokenOfferings()).to.deep.equal([]);
      // expect failed resolution
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      const resolution = await equityTokenController.resolution(resolutionId);
      expectResolution(resolution, resolutionId, GovAction.RegisterOffer, GovExecutionState.Failed);
    });

    async function secondaryETO(
      sharesAmount,
      primaryFinalState,
      primaryResolutionState,
      enableTransfers,
    ) {
      await runOffering();
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      // generate some tokens if approved
      if (primaryFinalState === CommitmentState.Claim) {
        await testCommitment._generateTokens(amount);
      }
      // approve or fail eto
      await testCommitment._triggerStateTransition(CommitmentState.Signing, primaryFinalState);
      // expect failed resolution
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      const resolution = await equityTokenController.resolution(resolutionId);
      expectResolution(resolution, resolutionId, GovAction.RegisterOffer, primaryResolutionState);
      // now testCommitment will be replaced with new commitment
      const oldCommitment = testCommitment;
      // deploy new terms but use same controller
      // default terms have non transferable token
      await deployETO({
        ENABLE_TRANSFERS_ON_SUCCESS: enableTransfers,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      const newCommitment = testCommitment;
      const newResolutionId = getCommitmentResolutionId(newCommitment.address);
      // register new offering from any address in Setup state...
      const newOfferTx = await equityTokenController.startNewOffering(
        newResolutionId,
        newCommitment.address,
        { from: company },
      );
      expectLogResolutionStarted(
        newOfferTx,
        0,
        newResolutionId,
        // no token if previous eto failed
        primaryResolutionState === GovExecutionState.Failed ? ZERO_ADDRESS : equityToken.address,
        "",
        etoTermsDict.INVESTOR_OFFERING_DOCUMENT_URL,
        GovAction.RegisterOffer,
        GovExecutionState.Executing,
      );
      // we should have 2 resolutions now
      const resolutions = await equityTokenController.resolutionsList();
      expect(resolutions.length).to.eq(2);
      let newResolution = await equityTokenController.resolution(newResolutionId);
      expectResolution(
        newResolution,
        newResolutionId,
        GovAction.RegisterOffer,
        GovExecutionState.Executing,
      );
      // subsequent call to startNewOffering should be denied as once executed
      await expect(
        equityTokenController.startNewOffering(newResolutionId, newCommitment.address),
      ).to.be.rejectedWith("NF_GOV_ALREADY_EXECUTED");
      // set observer
      await newCommitment.setStartDate(etoTerms.address, equityToken.address, "0");
      // perform ETO
      await runOffering();
      // generate tokens via new commitment
      await newCommitment._generateTokens(amount);
      // old commitment cannot generate tokens
      await expect(oldCommitment._generateTokens(amount)).to.be.rejectedWith(
        "NF_EQTOKEN_NO_GENERATE",
      );

      await newCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Claim);
      newResolution = await equityTokenController.resolution(newResolutionId);
      expectResolution(
        newResolution,
        newResolutionId,
        GovAction.RegisterOffer,
        GovExecutionState.Completed,
      );
      return [oldCommitment, newCommitment];
    }

    async function expectEquityTokenSupply(expectedShares) {
      const tps = await equityToken.tokensPerShare();
      const supply = await equityToken.totalSupply();
      expect(Q18.mul(expectedShares)).to.be.bignumber.eq(divRound(supply.mul(Q18), tps));
    }

    it("should approve ETO after first one failed", async () => {
      const sharesAmount = 2761;
      const [oldCommitment, newCommitment] = await secondaryETO(
        sharesAmount,
        CommitmentState.Refund,
        GovExecutionState.Failed,
        false,
      );
      // give old commitment some tokens so it can possibly distribute
      await newCommitment._distributeTokens(oldCommitment.address, 10);
      expect(await equityToken.balanceOf(oldCommitment.address)).to.be.bignumber.eq(10);
      // but it cannot distribute because it has failed and transfers are disabled
      await expect(oldCommitment._distributeTokens(investors[0], 1)).to.be.revert;

      // verify offerings and cap table
      expect(await equityTokenController.governanceToken()).to.deep.equal([
        equityToken.address,
        new web3.BigNumber(GovTokenType.Equity),
        new web3.BigNumber(GovTokenState.Open),
        tokenholderRights.address,
        false,
      ]);
      expect(await equityTokenController.tokenOfferings()).to.be.deep.eq([newCommitment.address]);
      await expectEquityTokenSupply(sharesAmount);
      expect(await equityTokenController.tokenOfferings()).to.deep.equal([newCommitment.address]);
    });

    it("should approve secondary eto", async () => {
      const sharesAmount = 27611;
      const [oldCommitment, newCommitment] = await secondaryETO(
        sharesAmount,
        CommitmentState.Claim,
        GovExecutionState.Completed,
        false,
      );
      expect(await equityTokenController.tokenOfferings()).to.be.deep.eq([
        oldCommitment.address,
        newCommitment.address,
      ]);
      await expectEquityTokenSupply(sharesAmount * 2);
      // still old commitment contract can distribute
      await oldCommitment._distributeTokens(investors[0], 1);
      // distribute but transfers disabled
      await newCommitment._distributeTokens(investors[0], 10);
      await expect(equityToken.transfer(investors[1], 1, { from: investors[0] })).to.revert;
    });

    it("should approve secondary eto that enables transfers", async () => {
      const sharesAmount = 27611;
      const [oldCommitment, newCommitment] = await secondaryETO(
        sharesAmount,
        CommitmentState.Claim,
        GovExecutionState.Completed,
        true,
      );
      // still old commitment contract can distribute
      await oldCommitment._distributeTokens(investors[0], 1);
      // distribute and transfer (transfers were enabled for non retail eto)
      await newCommitment._distributeTokens(investors[0], 10);
      await equityToken.transfer(investors[1], 1, { from: investors[0] });
      const tokens = await equityTokenController.governanceToken();
      expect(tokens[4]).to.eq(true); // transfers were set to true
    });

    it("rejects on secondary ETO with new equity token");

    // there are many rejection cases: like not from registered ETO, not from ETO, from other ETO in universe but not registered, from registered ETO but in Offering state

    it("rejects fail ETO from ETO not registered before", async () => {});

    async function testTransfersInOffering(transfersEnabled) {
      const amount = new web3.BigNumber(281871);
      // transfers disabled before offering - typical transfer
      expect(await equityTokenController.onTransfer(investors[0], investors[0], investors[1], 0)).to
        .be.false;
      // eto contract trying to generate tokens
      await runOffering();
      await testCommitment._generateTokens(amount);
      // transfers disabled for investors
      expect(await equityTokenController.onTransfer(investors[0], investors[0], investors[1], 0)).to
        .be.false;
      // transfers disabled for eto commitment before claim
      expect(
        await equityTokenController.onTransfer(
          testCommitment.address,
          testCommitment.address,
          investors[1],
          0,
        ),
      ).to.be.false;
      // brokered transfers for eto commitment disallowed
      expect(
        await equityTokenController.onTransfer(
          testCommitment.address,
          investors[0],
          investors[1],
          0,
        ),
      ).to.be.false;
      // distribution before claim will revert
      await expect(testCommitment._distributeTokens(investors[0], 10)).to.revert;
      // approve eto
      await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Claim,
      );
      expect(
        await equityTokenController.onTransfer(investors[0], investors[0], investors[1], 0),
      ).to.eq(transfersEnabled);
      // transfers enabled for eto commitment
      expect(
        await equityTokenController.onTransfer(
          testCommitment.address,
          testCommitment.address,
          investors[1],
          0,
        ),
      ).to.be.true;
      // make actual token distribution
      await testCommitment._distributeTokens(investors[0], 10);
      await testCommitment._distributeTokens(investors[1], 20);
      // brokered transfers for eto commitment disallowed
      expect(
        await equityTokenController.onTransfer(
          testCommitment.address,
          investors[0],
          investors[1],
          0,
        ),
      ).to.eq(transfersEnabled);
      // distribution works in offering
      await testCommitment._distributeTokens(investors[0], 1);
      if (transfersEnabled) {
        // make a few actual transfers
        await equityToken.transfer(investors[1], 1, { from: investors[0] });
        await equityToken.approve(investors[2], 5, { from: investors[1] });
        await equityToken.transferFrom(investors[1], investors[3], 5, { from: investors[2] });
      }
    }

    it("should allow transfer if transfers disabled only from registered ETO and only after Setup state", async () => {
      await deployETO({ ENABLE_TRANSFERS_ON_SUCCESS: false });
      await registerOffering();
      await testTransfersInOffering(false);
    });

    it("should allow transfers after eto if requested in terms", async () => {
      await deployETO({
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      await registerOffering();
      await testTransfersInOffering(true);
    });

    it("should prevent transfers from registered ETO when it fails", async () => {
      await runOffering();
      const sharesAmount = 2761;
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);

      await testCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Refund);

      await expect(testCommitment._distributeTokens(investors[0], 1)).to.be.revert;
    });
  });

  describe("mock controller", () => {
    it("should shift time", async () => {
      const mockController = await MockSingleEquityTokenController.new(universe.address, company);
      await deployController(mockController);
      await deployETO();
      const resolutionId = await registerOffering();
      const resolution = await mockController.resolution(resolutionId);
      const delta = daysToSeconds(1);
      await mockController._mockShiftBackTime(delta);
      const shifted = await mockController.resolution(resolutionId);
      expect(resolution[2]).to.be.bignumber.eq(shifted[2].add(delta));
      expect(resolution[3]).to.be.bignumber.eq(0);
      expect(resolution[7]).to.be.bignumber.eq(0);
      await preparePostInvestmentState();
      // another shift with finished resolution
      const preshifted2 = await mockController.resolution(resolutionId);
      await mockController._mockShiftBackTime(delta);
      const shifted2 = await mockController.resolution(resolutionId);
      expect(preshifted2[2]).to.be.bignumber.eq(shifted2[2].add(delta));
      expect(preshifted2[3]).to.be.bignumber.eq(shifted2[3].add(delta));
      expect(preshifted2[7]).to.be.bignumber.eq(0);
    });
  });

  describe("special migrations", () => {
    let newController;

    beforeEach(async () => {
      // add upgrade admin role to admin account, apply to all contracts
      await createAccessPolicy(accessPolicy, [{ subject: admin, role: roles.companyUpgradeAdmin }]);
      // deploy new mocked token controller for same company
      newController = await MockSingleEquityTokenController.new(universe.address, company);
      await prettyPrintGasCost("MockSingleEquityTokenController deploy", equityTokenController);
      await printCodeSize("MockSingleEquityTokenController code size", equityTokenController);
    });

    it.skip("should migrate empty controller", async () => {
      // abuse migration function to keep controller empty in funded state
      await equityTokenController.finishMigrateFrom(ZERO_ADDRESS, GovState.Funded, { from: admin });
      await migrateController(equityTokenController, newController);
    });

    it("should migrate controller without token");
  });

  describe("migrations", () => {
    let newController;

    beforeEach(async () => {
      await deployETO();
      await registerOffering();
      await preparePostInvestmentState();
      // deploy new mocked token controller for same company
      newController = await MockSingleEquityTokenController.new(universe.address, company);
    });

    async function startSecondaryOffering() {
      // register secondary offering before migration
      const oldCommitment = testCommitment;
      await deployETO();
      const newCommitment = testCommitment;
      testCommitment = oldCommitment;
      const newResolutionId = getCommitmentResolutionId(newCommitment.address);
      await equityTokenController.startNewOffering(newResolutionId, newCommitment.address, {
        from: company,
      });

      return newCommitment;
    }

    it("should migrate token controller", async () => {
      const newCommitment = await startSecondaryOffering();
      // migrate data from parent
      await migrateController(equityTokenController, newController);

      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Migrated);
      expect(await equityTokenController.migratedTo()).to.eq(newController.address);
      // equity token still has old controller - transfers are disabled
      await testCommitment._distributeTokens(investors[0], 10);
      await expect(equityToken.transfer(investors[1], 1, { from: investors[0] })).to.be.revert;
      // new mocked controller allows to enable transfer at will
      await newController._enableTransfers(true, { from: company });
      equityToken.transfer(investors[1], 1, { from: investors[0] });
      // make sure state is identical
      await expectControllerEqualState(equityTokenController, newController, {
        transfersEnabled: true,
      });
      expect(await newController.state()).to.be.bignumber.eq(GovState.Funded);
      // swap token controller
      equityTokenController = newController;
      testCommitment = newCommitment;
      // set start date again to change observer via equityToken.controller
      await testCommitment.setStartDate(etoTerms.address, equityToken.address, "0");
      // finish offering on new controller
      await runOffering();
      const tx = await generateTokens();
      const etcLogs = decodeLogs(
        tx,
        equityTokenController.address,
        SingleEquityTokenController.abi,
      );
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Offering, GovState.Funded);
    });

    it("should cancel migration", async () => {
      // start migration
      await expect(equityTokenController.cancelMigrateTo({ from: admin })).to.be.rejectedWith(
        "NF_INV_STATE",
      );
      await equityTokenController.startMigrateTo(newController.address, { from: admin });
      expect(await equityTokenController.preMigrationState()).to.be.bignumber.eq(GovState.Funded);
      await expect(equityTokenController.cancelMigrateTo({ from: company })).to.revert;
      await equityTokenController.cancelMigrateTo({ from: admin });
      // no access to pre migration state when not migrated nor migrating
      await expect(equityTokenController.preMigrationState()).to.revert;
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Funded);
    });

    it("should migrate token controller with authorized capital change", async () => {
      // migrate data from parent
      const authorizedCapital = Q18.mul(5000);
      await migrateController(equityTokenController, newController, {
        authorizedCapital,
        transfersEnabled: null,
      });
      await expectControllerEqualState(equityTokenController, newController, { authorizedCapital });
    });

    it("rejects migrating token controller not by upgrade admin", async () => {
      // deploy new mocked token controller
      await expect(
        newController.finishMigrateFrom(equityTokenController.address, GovState.Funded, {
          from: company,
        }),
      ).to.revert;
      await newController.finishMigrateFrom(equityTokenController.address, GovState.Funded, {
        from: admin,
      });
      await expect(
        equityTokenController.startMigrateTo(newController.address, {
          from: company,
        }),
      ).to.revert;
      await equityTokenController.startMigrateTo(newController.address, {
        from: admin,
      });
      await expect(
        equityTokenController.finishMigrateTo(newController.address, {
          from: company,
        }),
      ).to.revert;
      await equityTokenController.finishMigrateTo(newController.address, {
        from: admin,
      });
    });

    it("rejects migrating token controller to new controller that migrated from different old controller", async () => {
      await newController.finishMigrateFrom(equityTokenController.address, GovState.Funded, {
        from: admin,
      });
      // mockup old controller changing change chain
      await newController._overrideOldController(investors[0]);
      // now there's mismatch between old and new controller chain, so revert
      await equityTokenController.startMigrateTo(newController.address, {
        from: admin,
      });
      await expect(
        equityTokenController.finishMigrateTo(newController.address, {
          from: admin,
        }),
      ).to.be.rejectedWith("NF_NOT_MIGRATED_FROM_US");
    });

    it("should migrate twice", async () => {
      // first migration
      await startSecondaryOffering();
      await migrateController(equityTokenController, newController);

      // second migration
      const newController2 = await SingleEquityTokenController.new(universe.address, company);
      await migrateController(newController, newController2);

      // first and third identical state
      await expectControllerEqualState(equityTokenController, newController2, {
        checkLinking: false,
      });

      // verify change chain
      const oldInNewAddress = await newController2.migratedFrom();
      expect(oldInNewAddress).to.eq(newController.address);
      expect(await newController.migratedTo()).to.eq(newController2.address);
      expect(await newController.migratedFrom()).to.eq(equityTokenController.address);
      expect(await equityTokenController.migratedTo()).to.eq(newController.address);
      expect(await equityTokenController.migratedFrom()).to.eq(ZERO_ADDRESS);

      await expect(
        equityToken.changeTokenController(newController2.address, { from: investors[0] }),
      ).to.be.rejectedWith("NF_ET_NO_PERM_NEW_CONTROLLER");

      expect(await equityToken.tokenController()).to.be.eq(newController2.address);
    });

    it("rejects migrate token controller in wrong states", async () => {
      // can be accepted only in Setup state
      await newController._overrideState(GovState.Offering);
      expect(await newController.state()).to.be.bignumber.eq(GovState.Offering);
      await expect(
        newController.finishMigrateFrom(equityTokenController.address, GovState.Funded, {
          from: admin,
        }),
      ).to.be.rejectedWith("NF_INV_STATE");
      // migrate
      await newController._overrideState(GovState.Setup);
      await newController.finishMigrateFrom(equityTokenController.address, GovState.Funded, {
        from: admin,
      });
      await equityTokenController.startMigrateTo(newController.address, {
        from: admin,
      });
      await equityTokenController.finishMigrateTo(newController.address, {
        from: admin,
      });
      const newController2 = await SingleEquityTokenController.new(universe.address, company);
      await newController2.finishMigrateFrom(newController.address, GovState.Funded, {
        from: admin,
      });
      // cannot migrate when company is closing
      await newController._overrideState(GovState.Closing);
      await expect(
        newController.startMigrateTo(newController2.address, {
          from: admin,
        }),
      ).to.be.rejectedWith("NF_INV_STATE");
      // can migrate when company is closed
      await newController._overrideState(GovState.Closed);
      await newController.startMigrateTo(newController2.address, {
        from: admin,
      });
    });
  });

  describe("legacy migrations", () => {
    async function expectLegacyController(data, version) {
      // encode constructor parameters
      const parameters = coder
        .encodeParameters(["address", "address"], [universe.address, company])
        .substring(2);
      const tx = await promisify(web3.eth.sendTransaction)({
        from: admin,
        data: data + parameters,
        gasPrice: "0x1",
        gas: 6000000,
      });
      const receipt = await promisify(web3.eth.getTransactionReceipt)(tx);
      const legacyController = await IControllerGovernancev13.at(receipt.contractAddress);
      const cId = await legacyController.contractId();
      // detect version
      expect(cId[0]).to.eq(contractId("PlaceholderEquityTokenController"));
      expect(cId[1]).to.be.bignumber.eq(version);
      // read and check full empty state
      expect(await legacyController.capTable()).to.deep.equal([[], []]);
      expect(await legacyController.tokenOfferings()).to.deep.equal([[], []]);
      expect(await legacyController.amendmentsCount()).to.be.bignumber.eq(zero);
      expect(await legacyController.shareholderInformation()).to.deep.equal([
        zero,
        zero,
        ZERO_ADDRESS,
      ]);
      expect(await legacyController.newTokenController()).to.eq(ZERO_ADDRESS);
      expect(await legacyController.oldTokenController()).to.eq(ZERO_ADDRESS);
      await expect(legacyController.changeTokenController(ZERO_ADDRESS)).to.be.rejectedWith(
        "NF_INV_STATE",
      );
      expect(await legacyController.state()).to.be.bignumber.eq(GovState.Setup);
    }

    it("should verify initial state of placeholder controler v 0 (FF)", async () => {
      await expectLegacyController(ffControllerV0, "0");
    });

    it("should verify initial state of placeholder controler v 3 (Greyp)", async () => {
      await expectLegacyController(greypControllerV3, "3");
    });
  });

  describe("without ETO", async () => {
    const ishaUrl = "ipfs:739ann3092id903";
    const shareCapitalUlps = Q18.mul("25000");
    // valuation not yet known
    const companyValuationEurUlps = zero;
    const authorizedCapital = Q18;

    it("should amend ISHA in setup and then do ETO", async () => {
      // company may amend ISHA in Setup state and make it operational without token and ETO
      const resolutionId = randomBytes32();
      // only company may do it
      await expect(
        equityTokenController.amendISHAResolution(
          resolutionId,
          ishaUrl,
          shareCapitalUlps,
          authorizedCapital,
          companyValuationEurUlps,
          tokenholderRights.address,
          { from: admin },
        ),
      ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");

      // mind that tokenholderRights should not contain voting rights

      const tx = await equityTokenController.amendISHAResolution(
        resolutionId,
        ishaUrl,
        shareCapitalUlps,
        authorizedCapital,
        companyValuationEurUlps,
        tokenholderRights.address,
        { from: company },
      );
      expectLogISHAAmended(tx, resolutionId, ishaUrl);
      expectLogTokenholderRightsAmended(
        tx,
        resolutionId,
        GovTokenType.None,
        ZERO_ADDRESS,
        tokenholderRights.address,
      );
      expectLogCompanyValuationAmended(tx, resolutionId, companyValuationEurUlps);
      expectLogShareCapitalAmended(tx, resolutionId, shareCapitalUlps);
      expectLogAuthorizedCapitalEstablished(tx, resolutionId, authorizedCapital);
      // in setup we transition to Funded
      expectLogGovStateTransition(tx, GovState.Setup, GovState.Funded);
      // expect None token to be present
      const tokens = await equityTokenController.governanceToken();
      expect(tokens).to.deep.eq([ZERO_ADDRESS, zero, zero, tokenholderRights.address, false]);

      // can execute any action ie. amend valuation
      const amendRid = randomBytes32();
      const docUrl = "ABC";
      const newValuation = Q18.mul("125000000");
      const amendTx = await equityTokenController.amendCompanyValuationResolution(
        amendRid,
        newValuation,
        docUrl,
        { from: company },
      );
      expectLogResolutionStarted(
        amendTx,
        0,
        amendRid,
        ZERO_ADDRESS,
        "",
        docUrl,
        GovAction.AmendValuation,
        GovExecutionState.Executing,
      );
      expectLogResolutionExecuted(
        amendTx,
        0,
        amendRid,
        GovAction.AmendValuation,
        GovExecutionState.Completed,
      );
      await expectResolutionById(
        equityTokenController,
        amendRid,
        GovAction.AmendValuation,
        GovExecutionState.Completed,
      );

      // start offering replace none token
      await deployController(equityTokenController);
      await deployETO({
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      // register new offering
      await registerOffering();
      await runOffering();
      // issue equity tokens and move to claim
      await generateTokens();
      const newTokens = await equityTokenController.governanceToken();
      expect(newTokens).to.deep.eq([
        equityToken.address,
        new web3.BigNumber(GovTokenType.Equity),
        zero,
        tokenholderRights.address,
        true,
      ]);
    });

    it("rejects start ETO in setup state not from universe manager", async () => {
      await deployETO();
      // in setup state company can do it or role with universe manager
      await expect(registerOffering(investors[0])).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      // universe manager (admin) can register resolution
      await registerOffering(admin);
      // company as well
      await deployETO();
      await registerOffering(company);
    });

    it("rejects amend ISHA after setup with voting rights and no token", async () => {
      // deploy governance with voting rights
      [tokenholderRights] = await deployTokenholderRights(TokenholderRights, votingRightsOvr);
      // company may amend ISHA in Setup state and make it operational without token and ETO
      let resolutionId = randomBytes32();
      await equityTokenController.amendISHAResolution(
        resolutionId,
        ishaUrl,
        shareCapitalUlps,
        authorizedCapital,
        companyValuationEurUlps,
        tokenholderRights.address,
        { from: company },
      );
      resolutionId = randomBytes32();
      // here we try to do SHR but there's no token so governance will fail
      await expect(
        equityTokenController.amendISHAResolution(
          resolutionId,
          ishaUrl,
          shareCapitalUlps,
          authorizedCapital,
          companyValuationEurUlps,
          tokenholderRights.address,
          { from: company },
        ),
      ).to.be.rejectedWith("NF_GOV_NO_GOVERNANCE_TOKEN");
    });
  });

  describe("post investment actions", () => {
    let resolutionId;

    beforeEach(async () => {
      await deployETO();
      await registerOffering();
      await preparePostInvestmentState();
      resolutionId = randomBytes32();
    });

    describe("general information", () => {
      it("should issue general information by company", async () => {
        const tx = await equityTokenController.generalResolution(
          resolutionId,
          GovAction.CompanyNone,
          "TOKENHOLDERS CALL",
          "ipfs:blah",
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          equityToken.address,
          "TOKENHOLDERS CALL",
          "ipfs:blah",
          GovAction.CompanyNone,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.CompanyNone,
          GovExecutionState.Completed,
        );
      });

      it("rejects general information not from company", async () => {
        await expect(
          equityTokenController.generalResolution(
            resolutionId,
            GovAction.CompanyNone,
            "TOKENHOLDERS CALL",
            "ipfs:blah",
            {
              from: admin,
            },
          ),
        ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      });

      it("rejects general resolution for non general actions", async () => {
        await expect(
          equityTokenController.generalResolution(
            resolutionId,
            GovAction.AmendGovernance,
            "TOKENHOLDERS CALL",
            "ipfs:blah",
            {
              from: company,
            },
          ),
        ).to.be.rejectedWith("NF_NOT_GENERAL_ACTION");
      });

      it("rejects amend Agreement (ISHA) by company", async () => {
        // ISHA amendment only through resolution, company cannot do that
        await expect(equityTokenController.amendAgreement("NEW")).to.be.revert;
      });

      it("should amend ISHA", async () => {
        const ishaUrl = "ipfs:739ann3092id903";
        const shareCapitalUlps = Q18.mul("25000");
        // valuation not yet known
        const companyValuationEurUlps = Q18.mul("123654123");
        const authorizedCapital = Q18.mul("1276");
        // new tokenholder rights
        const [newRights] = await deployTokenholderRights(TokenholderRights, votingRightsOvr);
        const tx = await equityTokenController.amendISHAResolution(
          resolutionId,
          ishaUrl,
          shareCapitalUlps,
          authorizedCapital,
          companyValuationEurUlps,
          newRights.address,
          { from: company },
        );
        // events already tested, make sure state transition was not executed
        expect(hasEvent(tx, "LogGovStateTransition")).to.be.false;
        // read general info
        const information = await equityTokenController.shareholderInformation();
        expect(information[0]).to.be.bignumber.eq(shareCapitalUlps);
        expect(information[1]).to.be.bignumber.eq(companyValuationEurUlps);
        expect(information[2]).to.be.bignumber.eq(authorizedCapital);
        expect(information[3]).to.eq(ishaUrl);
        expect(information[4]).to.eq(newRights.address);
        // check agreement
        const agreement = await equityTokenController.currentAgreement();
        expect(agreement[2]).to.eq(ishaUrl);
        // check if rights with the token changed
        const tokens = await equityTokenController.governanceToken();
        expect(tokens[3]).to.eq(newRights.address);
      });

      it("should establish authorized capital", async () => {
        const authorizedCapital = Q18.mul("1");
        const tx = await equityTokenController.establishAuthorizedCapitalResolution(
          resolutionId,
          authorizedCapital,
          "",
          { from: company },
        );
        expectLogAuthorizedCapitalEstablished(tx, resolutionId, authorizedCapital);
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          equityToken.address,
          "",
          "",
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
        const information = await equityTokenController.shareholderInformation();
        expect(information[2]).to.be.bignumber.eq(authorizedCapital);
      });

      it("should execute annual meeting", async () => {
        const assemblyDoc = "doc";
        const tx = await equityTokenController.generalResolution(
          resolutionId,
          GovAction.AnnualGeneralMeeting,
          "SHAREHOLDER MEETING",
          assemblyDoc,
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          equityToken.address,
          "SHAREHOLDER MEETING",
          assemblyDoc,
          GovAction.AnnualGeneralMeeting,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.AnnualGeneralMeeting,
          GovExecutionState.Completed,
        );
      });

      it("should set company valuation", async () => {
        const newValuation = Q18.mul("782719991");
        const tx = await equityTokenController.amendCompanyValuationResolution(
          resolutionId,
          newValuation,
          "",
          { from: company },
        );
        expectLogCompanyValuationAmended(tx, resolutionId, newValuation);
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          equityToken.address,
          "",
          "",
          GovAction.AmendValuation,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.AmendValuation,
          GovExecutionState.Completed,
        );
        const information = await equityTokenController.shareholderInformation();
        expect(information[1]).to.be.bignumber.eq(newValuation);
      });

      it("should set share capital", async () => {
        const newValuation = Q18.mul("782719991");
        const shareCapitalUlps = Q18.mul("25000");
        const authorizedCapital = Q18.mul("1276");
        const tx = await equityTokenController.amendShareCapitalResolution(
          resolutionId,
          shareCapitalUlps,
          authorizedCapital,
          newValuation,
          "",
          { from: company },
        );

        expectLogAuthorizedCapitalEstablished(tx, resolutionId, authorizedCapital);
        expectLogCompanyValuationAmended(tx, resolutionId, newValuation);

        expectLogShareCapitalAmended(tx, resolutionId, shareCapitalUlps);
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          equityToken.address,
          "",
          "",
          GovAction.AmendSharesAndValuation,
          GovExecutionState.Executing,
        );
        expectLogResolutionExecuted(
          tx,
          0,
          resolutionId,
          GovAction.AmendSharesAndValuation,
          GovExecutionState.Completed,
        );

        const information = await equityTokenController.shareholderInformation();
        expect(information[0]).to.be.bignumber.eq(shareCapitalUlps);
        expect(information[1]).to.be.bignumber.eq(newValuation);
        expect(information[2]).to.be.bignumber.eq(authorizedCapital);
      });

      it("should skip events if values not changed");
    });

    describe("voting rights", () => {
      it("should escalate to THR voting on tag along without voting rights");

      it("should start SHR with token holder initiative");

      it("should start THR with token holder initiative");
    });

    describe("economic rights", () => {
      it("should distribute ordinary dividend", async () => {
        // identity and disbursal must be deployed before the token so it can config permissions
        const identityRegistry = await deployIdentityRegistry(universe, admin, admin);
        const [feeDisbursal] = await deployFeeDisbursalUniverse(universe, admin);
        const [euroToken] = await deployEuroTokenUniverse(
          universe,
          admin,
          admin,
          admin,
          zero,
          zero,
          zero,
        );
        // promise to disburse 1000 euro
        const amount = Q18.mul("1000");
        const recycleAfter = daysToSeconds(30);
        const tx = await equityTokenController.ordinaryPayoutResolution(
          resolutionId,
          euroToken.address,
          amount,
          recycleAfter,
          "",
          { from: company },
        );
        expectLogResolutionStarted(
          tx,
          0,
          resolutionId,
          equityToken.address,
          "",
          "",
          GovAction.OrdinaryPayout,
          GovExecutionState.Executing,
        );

        // extract unpacked promise from the event
        const promise = eventValue(tx, "LogResolutionStarted").args.promise;

        // make payout from company wallet
        await identityRegistry.setClaims(company, toBytes32("0x0"), toBytes32("0x1"), {
          from: admin,
        });
        await euroToken.deposit(company, amount, 0x0, { from: admin });
        const trTx = await euroToken.transfer[
          "address,uint256,bytes"
        ](equityTokenController.address, amount, promise, { from: company });
        // add controller logs
        const etcLogs = decodeLogs(
          trTx,
          equityTokenController.address,
          SingleEquityTokenController.abi,
        );
        trTx.logs.push(...etcLogs);
        expectLogResolutionExecuted(
          trTx,
          0,
          resolutionId,
          GovAction.OrdinaryPayout,
          GovExecutionState.Completed,
        );
        // add disbursal logs
        const disbursalLogs = decodeLogs(trTx, feeDisbursal.address, FeeDisbursal.abi);
        trTx.logs.push(...disbursalLogs);
        // check if disbural happened in feeDisbursal
        expectLogDisbursalCreated(
          trTx,
          equityToken.address,
          euroToken.address,
          amount,
          equityTokenController.address,
          recycleAfter,
          0,
        );
        // todo: get funds
      });

      it("should pay dividend via erc20 broker");

      it("revert on unexpected token transfer", async () => {
        // token transfer must be done against valid resolution and unpacked promise must be present in data
        await expect(equityTokenController.tokenFallback(ZERO_ADDRESS, 0, "")).to.be.rejectedWith(
          "NF_UNEXPECTED_TOKEN_TX",
        );
      });

      it("revert on unexpected dividend payout", async () => {
        // mock data to sig of ordinaryPayoutResolution
        const sig = coder.encodeFunctionSignature(
          "extraOrdinaryPayoutResolution(bytes32,address,uint256,uint256,string",
        );
        await expect(equityTokenController.tokenFallback(ZERO_ADDRESS, 0, sig)).to.be.rejectedWith(
          "NF_UNEXPECTED_TOKEN_TX",
        );
      });

      it("should cancel dividend payout");
    });

    describe("dissolve and change of control", () => {
      it.skip("reverts on investor rights when operational", async () => {
        await expect(equityTokenController.closeCompany()).to.be.rejectedWith("NF_INV_STATE");
        await expect(equityTokenController.cancelCompanyClosing()).to.be.rejectedWith(
          "NF_INV_STATE",
        );
      });
    });

    describe("token transfers", () => {
      it("should return true onApprove", async () => {
        expect(await equityTokenController.onApprove(investors[0], investors[1], 0)).to.be.true;
      });

      it("should return 0 on onAllowance", async () => {
        expect(
          await equityTokenController.onAllowance(investors[0], investors[1]),
        ).to.be.bignumber.eq(0);
      });
    });

    describe("token ops", async () => {
      it("should return false on changing nominee", async () => {
        expect(
          await equityTokenController.onChangeNominee(equityToken.address, nominee, investors[0]),
        ).to.be.false;
      });
    });
  });

  describe("EquityToken basic functions", () => {
    const initialBalance = new web3.BigNumber(5092819281);
    const getToken = () => equityToken;

    beforeEach(async () => {
      // token must be transferable to run standard test suite
      await deployETO({
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      // register new offering
      await registerOffering();
      await runOffering();
      // issue equity tokens and move to claim
      await generateTokens(initialBalance);

      await testCommitment._distributeTokens(investors[1], initialBalance);
    });

    describe("IBasicToken tests", () => {
      basicTokenTests(getToken, investors[1], investors[2], initialBalance);
    });

    describe("IERC20Allowance tests", () => {
      standardTokenTests(getToken, investors[1], investors[2], investors[3], initialBalance);
    });

    describe("IERC677Token tests", () => {
      let erc667cb;
      const getTestErc667cb = () => erc667cb;

      beforeEach(async () => {
        erc667cb = await deployTestErc677Callback();
      });

      erc677TokenTests(getToken, getTestErc667cb, investors[1], initialBalance);
    });

    describe("IERC223Token tests", () => {
      let erc223cb;
      const getTestErc223cb = () => erc223cb;

      beforeEach(async () => {
        erc223cb = await deployTestErc223Callback(true);
      });

      erc223TokenTests(getToken, getTestErc223cb, investors[1], investors[2], initialBalance);
    });

    it("rejects nominee change", async () => {
      await expect(equityToken.changeNominee(investors[0])).to.be.revert;
    });
  });

  async function deployController(ovrController) {
    equityTokenController =
      ovrController || (await SingleEquityTokenController.new(universe.address, company));
    equityToken = await EquityToken.new(
      universe.address,
      equityTokenController.address,
      tokenTerms.address,
      nominee,
      company,
    );
    await equityToken.amendAgreement("AGREEMENT#HASH", { from: nominee });
    await universe.setCollectionsInterfaces(
      [knownInterfaces.equityTokenInterface, knownInterfaces.equityTokenControllerInterface],
      [equityToken.address, equityTokenController.address],
      [true, true],
      { from: admin },
    );
  }

  async function deployETO(termsOverride, constraintsOverride) {
    [termsConstraints] = await deployETOTermsConstraintsUniverse(
      admin,
      universe,
      ETOTermsConstraints,
      constraintsOverride,
    );
    // default terms have non transferable token
    [etoTerms, etoTermsDict] = await deployETOTerms(
      universe,
      ETOTerms,
      durationTerms,
      tokenTerms,
      tokenholderRights,
      termsConstraints,
      termsOverride,
    );
    testCommitment = await TestETOCommitmentSingleTokenController.new(
      universe.address,
      nominee,
      company,
      etoTerms.address,
      equityToken.address,
    );
    await universe.setCollectionsInterfaces(
      [knownInterfaces.commitmentInterface, knownInterfaces.termsInterface],
      [testCommitment.address, etoTerms.address],
      [true, true],
      { from: admin },
    );
    await testCommitment.amendAgreement("AGREEMENT#HASH", { from: nominee });
  }

  async function registerOffering(fromAccount) {
    // start new offering
    const resolutionId = getCommitmentResolutionId(testCommitment.address);
    await equityTokenController.startNewOffering(resolutionId, testCommitment.address, {
      from: fromAccount || company,
    });
    // pass equity token to eto commitment
    await testCommitment.setStartDate(etoTerms.address, equityToken.address, "0");
    return resolutionId;
  }

  async function runOffering(commitmentOvr) {
    const commitment = commitmentOvr || testCommitment;
    const tx = await commitment._triggerStateTransition(
      CommitmentState.Setup,
      CommitmentState.Setup,
    );
    await commitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Whitelist);
    return tx;
  }

  async function preparePostInvestmentState() {
    // register new offering
    await runOffering();
    await generateTokens();
    // add upgrade admin role to admin account, apply to all contracts
    await createAccessPolicy(accessPolicy, [{ subject: admin, role: roles.companyUpgradeAdmin }]);
  }

  async function generateTokens(amountOvr) {
    // make investments
    const amount = amountOvr || new web3.BigNumber((await equityToken.tokensPerShare()).mul(7162));
    await testCommitment._generateTokens(amount);
    // finish offering
    const tx = await testCommitment._triggerStateTransition(
      CommitmentState.Whitelist,
      CommitmentState.Claim,
    );
    return tx;
  }

  async function migrateController(oldController, newController, options) {
    const opts = Object.assign({}, options);
    // compare implementation first
    const oldModules = await oldController.moduleId();
    const newModules = await newController.moduleId();
    expect(oldModules).to.be.deep.eq(newModules);
    // start migration
    const tx = await oldController.startMigrateTo(newController.address, { from: admin });
    expectLogGovStateTransition(tx, GovState.Funded, GovState.Migrating);
    expect(await oldController.isMigrating()).to.be.true;
    expect(await oldController.migratedTo()).to.eq(ZERO_ADDRESS);
    // read state
    const state = await oldController.preMigrationState();
    const tokens = await oldController.governanceToken();
    const offerings = await oldController.tokenOfferings();
    // const agreement = await oldController.currentAgreement();
    const information = await oldController.shareholderInformation();
    const resolutionIds = await oldController.resolutionsList();
    // read resolutions
    let resolutions;
    for (const resolutionId of resolutionIds) {
      const resolution = await oldController.resolution(resolutionId);
      if (resolutions) {
        resolutions = resolutions.map((v, i) => [...v, resolution[i]]);
      } else {
        resolutions = resolution.map(v => [v]);
      }
    }
    // write state

    // governance engine module
    await newController.migrateResolutions(resolutionIds, ...resolutions, { from: admin });
    // token module
    if (opts.transfersEnabled !== undefined) {
      tokens[4] = opts.transfersEnabled;
    }
    await newController.migrateToken(...tokens, { from: admin });
    // general information module
    if (opts.authorizedCapital !== undefined) {
      information[2] = opts.authorizedCapital;
    }
    await newController.migrateGeneralInformation(...information, { from: admin });
    // offering module
    await newController.migrateOfferings(offerings, { from: admin });

    // link old controller and set the state
    await newController.finishMigrateFrom(oldController.address, state, { from: admin });
    // finish migration
    const migratedTx = await oldController.finishMigrateTo(newController.address, {
      from: admin,
    });
    expectLogMigratedTo(migratedTx, oldController.address, newController.address);
    // this also changed token controller in the equity token
    // now anyone can replace token controller in equity token
    expect(await equityToken.tokenController()).to.eq(newController.address);
  }

  async function expectControllerEqualState(oldController, newController, options) {
    const opts = Object.assign({ checkLinking: true }, options);
    // compare new and old controller - all should be imported

    // governance module
    expect(await oldController.companyLegalRepresentative()).to.deep.equal(
      await newController.companyLegalRepresentative(),
    );
    const resolutionIds = await oldController.resolutionsList();
    expect(await newController.resolutionsList()).to.deep.equal(resolutionIds);
    for (const resolutionId of resolutionIds) {
      const resolution = await oldController.resolution(resolutionId);
      expect(await newController.resolution(resolutionId)).to.deep.equal(resolution);
    }

    // information module
    const information = await oldController.shareholderInformation();
    if (opts.authorizedCapital !== undefined) {
      // sets authorizedCapital without breaking deep equal
      information[2] = information[2].sub(information[2]).add(opts.authorizedCapital);
    }
    expect(await newController.shareholderInformation()).to.deep.equal(information);
    const agreementData = await oldController.currentAgreement();
    expect(agreementData[2]).to.eq((await newController.currentAgreement())[2]);

    // token module
    const tokens = await oldController.governanceToken();
    if (opts.transfersEnabled !== undefined) {
      tokens[4] = opts.transfersEnabled;
    }
    expect(tokens).to.deep.equal(await newController.governanceToken());

    // offerings module
    expect(await oldController.tokenOfferings()).to.deep.equal(
      await newController.tokenOfferings(),
    );

    // check linking
    if (opts.checkLinking) {
      const oldInNewAddress = await newController.migratedFrom();
      expect(oldInNewAddress).to.eq(oldController.address);
      const newInOldAddress = await oldController.migratedTo();
      expect(newInOldAddress).to.eq(newController.address);
    }
    // compare state
    expect(await newController.state()).to.be.bignumber.eq(await oldController.preMigrationState());
    expect(await oldController.state()).to.be.bignumber.eq(GovState.Migrated);
  }

  function getTokenPower(terms) {
    return decimalBase.pow((terms || tokenTermsDict).EQUITY_TOKEN_DECIMALS);
  }

  function expectLogOfferingRegistered(tx, resolutionId, commitmentAddress, equityTokenAddress) {
    const event = eventValue(tx, "LogOfferingRegistered");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.etoCommitment).to.eq(commitmentAddress);
    expect(event.args.equityToken).to.eq(equityTokenAddress);
  }

  function expectLogTransfersStateChanged(tx, resolutionId, equityTokenAddress, transfersEnabled) {
    const event = eventValue(tx, "LogTransfersStateChanged");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.equityToken).to.eq(equityTokenAddress);
    expect(event.args.transfersEnabled).to.eq(transfersEnabled);
  }

  function expectLogOfferingSucceeded(tx, commitmentAddress, equityTokenAddress, newShares) {
    const event = eventValue(tx, "LogOfferingSucceeded");
    expect(event).to.exist;
    expect(event.args.etoCommitment).to.eq(commitmentAddress);
    expect(event.args.equityToken).to.eq(equityTokenAddress);
    expect(event.args.newShares).to.be.bignumber.eq(newShares);
  }

  function expectLogOfferingFailed(tx, commitmentAddress, equityTokenAddress) {
    const event = eventValue(tx, "LogOfferingFailed");
    expect(event).to.exist;
    expect(event.args.etoCommitment).to.eq(commitmentAddress);
    expect(event.args.equityToken).to.eq(equityTokenAddress);
  }

  function expectLogMigratedTo(tx, oldController, newController) {
    const event = eventValue(tx, "LogMigratedTo");
    expect(event).to.exist;
    expect(event.args.oldImpl).to.eq(oldController);
    expect(event.args.newImpl).eq(newController);
  }

  function expectLogISHAAmended(tx, resolutionId, ishaUrl) {
    const event = eventValue(tx, "LogISHAAmended");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.ISHAUrl).to.eq(ishaUrl);
  }

  function expectLogTokenholderRightsAmended(tx, resolutionId, tokenType, token, rights) {
    const event = eventValue(tx, "LogTokenholderRightsAmended");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.tokenType).to.be.bignumber.eq(tokenType);
    expect(event.args.token).to.eq(token);
    expect(event.args.tokenholderRights).to.eq(rights);
  }

  function expectLogCompanyValuationAmended(tx, resolutionId, newValuation) {
    const event = eventValue(tx, "LogCompanyValuationAmended");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.companyValuationEurUlps).to.be.bignumber.eq(newValuation);
  }

  function expectLogShareCapitalAmended(tx, resolutionId, newShareCapital) {
    const event = eventValue(tx, "LogShareCapitalAmended");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.shareCapitalUlps).to.be.bignumber.eq(newShareCapital);
  }

  function expectLogAuthorizedCapitalEstablished(tx, resolutionId, authorizedCapital) {
    const event = eventValue(tx, "LogAuthorizedCapitalEstablished");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.authorizedCapitalUlps).to.be.bignumber.eq(authorizedCapital);
  }
});
