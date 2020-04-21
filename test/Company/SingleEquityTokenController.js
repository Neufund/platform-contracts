import { expect } from "chai";
import { deployPlatformTerms, deployUniverse } from "../helpers/deployContracts";
import { ZERO_ADDRESS, Q18, decimalBase } from "../helpers/constants";
import { contractId, randomBytes32 } from "../helpers/utils";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import {
  GovState,
  GovAction,
  GovExecutionState,
  GovTokenType,
  GovTokenState,
} from "../helpers/govState";
import {
  expectLogResolutionStarted,
  expectLogResolutionExecuted,
  expectLogGovStateTransition,
  expectResolution,
  getCommitmentResolutionId,
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
import { promisify } from "../helpers/evmCommands";
import { ffControllerV0, greypControllerV3 } from "./bin/legacyControllers";

const coder = require("web3-eth-abi");

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

  beforeEach(async () => {
    [universe, accessPolicy] = await deployUniverse(admin, admin);
    await deployPlatformTerms(universe, admin);
    // revoke voting rights so company can execute all resolutions without voting
    [tokenholderRights] = await deployTokenholderRights(TokenholderRights, {
      GENERAL_VOTING_RULE: zero,
    });
    [durationTerms] = await deployDurationTerms(ETODurationTerms);
    [tokenTerms, tokenTermsDict] = await deployTokenTerms(ETOTokenTerms);
    await deployETO();
    await deployController();
  });

  it("should deploy and check initial state", async () => {
    await prettyPrintGasCost("SingleEquityTokenController deploy", equityTokenController);
    expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Setup);
    const shareholderInfo = await equityTokenController.shareholderInformation();
    expect(shareholderInfo).to.deep.eq([zero, zero, ZERO_ADDRESS, zero, ""]);
    const tokens = await equityTokenController.tokens();
    expect(tokens.length).to.eq(5);
    for (const array of tokens) {
      expect(array.length).to.eq(0);
    }

    const tokenOfferings = await equityTokenController.tokenOfferings();
    expect(tokenOfferings.length).to.eq(2);
    expect(tokenOfferings[0].length).to.eq(0);
    expect(tokenOfferings[1].length).to.eq(0);

    const cid = await equityTokenController.contractId();
    expect(cid[0]).to.eq(contractId("SingleEquityTokenController"));
    expect(cid[1]).to.be.bignumber.eq(0);
    expect(await equityTokenController.migratedTo()).to.eq(ZERO_ADDRESS);
    expect(await equityTokenController.migratedFrom()).to.eq(ZERO_ADDRESS);

    // check if all modules listed
    const moduleId = await equityTokenController.moduleId();
    // have 4 modules including top contract
    expect(moduleId[0].length).to.eq(4);
    expect(moduleId[0][0]).to.eq(contractId("ControllerGovernanceEngine"));
    expect(moduleId[1][0]).to.be.bignumber.eq(zero);
    expect(moduleId[0][1]).to.eq(contractId("ControllerGeneralInformation"));
    expect(moduleId[1][1]).to.be.bignumber.eq(zero);
    expect(moduleId[0][2]).to.eq(contractId("ControllerTokenOfferings"));
    expect(moduleId[1][2]).to.be.bignumber.eq(zero);
    expect(moduleId[0][3]).to.eq(cid[0]);
    expect(moduleId[1][3]).to.be.bignumber.eq(cid[1]);
  });

  describe("offering actions", () => {
    it("should register ETO start", async () => {
      const tx = await startOffering();
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
      expect(await equityTokenController.tokens()).to.deep.eq([[], [], [], [], []]);
      // no shareholder info yet
      expect(await equityTokenController.shareholderInformation()).to.deep.eq([
        zero,
        zero,
        ZERO_ADDRESS,
        zero,
        "",
      ]);
      // no offerings registered
      expect(await equityTokenController.tokenOfferings()).to.deep.eq([[], []]);
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

    it("rejects ETO start from ETO not in universe", async () => {
      await universe.setCollectionInterface(
        knownInterfaces.commitmentInterface,
        testCommitment.address,
        false,
        { from: admin },
      );
      await expect(startOffering()).to.be.rejectedWith("NF_ETC_ETO_NOT_U");
    });

    it("rejects ETO registration when not in universe", async () => {
      // deploy new terms but use same controller
      // default terms have non transferable token
      await deployETO({
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      await universe.setCollectionInterface(
        knownInterfaces.commitmentInterface,
        testCommitment.address,
        false,
        { from: admin },
      );
      const newCommitment = testCommitment;
      const newResolutionId = getCommitmentResolutionId(newCommitment.address);
      // this should trigger custom validator
      await expect(
        equityTokenController.startNewOffering(newResolutionId, newCommitment.address, {
          from: company,
        }),
      ).to.be.rejectedWith("NF_ETC_ETO_NOT_U");
    });

    it("no state transition on second ETO start date", async () => {
      let tx = await startOffering();
      let etcLogs = decodeLogs(tx, equityTokenController.address, SingleEquityTokenController.abi);
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Setup, GovState.Offering);
      tx = await startOffering();
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
      await expect(startOffering()).to.be.rejectedWith("NF_GOV_NOT_EXECUTING");
      // this will still pass
      await startOffering(oldTestCommitment);
    });

    it(
      "rejects register ETO with mismatching terms, addresses, tokens and equity token controller",
    );

    it("rejects on secondary ETO with new equity token");

    it("should allow generating and destroying tokens only by registered ETO in Offering state", async () => {
      const amount = new web3.BigNumber(281871);
      await expect(testCommitment._generateTokens(amount)).to.be.revert;
      await startOffering();
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Offering);
      await testCommitment._generateTokens(amount);
      expect(await equityToken.balanceOf(testCommitment.address)).to.be.bignumber.eq(amount);
      await testCommitment._destroyTokens(amount);
      expect(await equityToken.balanceOf(testCommitment.address)).to.be.bignumber.eq(0);
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
      await startOffering();
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
      expectLogISHAAmended(
        tx,
        resolutionId,
        await testCommitment.signedInvestmentAgreementUrl(),
        increasedShareCapitalUlps,
        expectedValuation,
        tokenholderRights.address,
      );
      expectLogAuthorizedCapitalEstablished(tx, resolutionId, etoTermsDict.AUTHORIZED_CAPITAL);
      // verify offerings and cap table
      expect(await equityTokenController.tokens()).to.deep.equal([
        [equityToken.address],
        [new web3.BigNumber(GovTokenType.Equity)],
        [new web3.BigNumber(GovTokenState.Open)],
        [tokenholderRights.address],
        [etoTermsDict.ENABLE_TRANSFERS_ON_SUCCESS],
      ]);
      expect(await equityTokenController.tokenOfferings()).to.deep.equal([
        [testCommitment.address],
        [equityToken.address],
      ]);
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
      await deployController();
      await startOffering();
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
        etoTermsDict.EXISTING_SHARE_CAPITAL,
        expectedValuation,
        tokenholderRights.address,
      );
      // no authorized capital established after ETO
      expect(hasEvent(tx, "LogAuthorizedCapitalEstablished")).to.be.false;
    });

    it("reject approve when not in funding state", async () => {
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Whitelist, CommitmentState.Claim),
      ).to.be.rejectedWith("NF_ETC_BAD_STATE");
      await startOffering();
      await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Claim,
      );
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Whitelist, CommitmentState.Claim),
      ).to.be.rejectedWith("NF_ETC_BAD_STATE");
    });

    it("rejects approve ETO from registered ETO that was removed from universe", async () => {
      await startOffering();
      await universe.setCollectionsInterfaces(
        [knownInterfaces.commitmentInterface],
        [testCommitment.address],
        [false],
        { from: admin },
      );
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Whitelist, CommitmentState.Claim),
      ).to.be.rejectedWith("NF_ETC_ETO_NOT_U");
    });

    it("should fail ETO", async () => {
      await startOffering();
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
      expect(await equityTokenController.tokens()).to.deep.equal([[], [], [], [], []]);
      expect(await equityTokenController.tokenOfferings()).to.deep.equal([[], []]);
      // expect failed resolution
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      const resolution = await equityTokenController.resolution(resolutionId);
      expectResolution(resolution, resolutionId, GovAction.RegisterOffer, GovExecutionState.Failed);
    });

    it("should approve ETO after first one failed", async () => {
      await startOffering();
      const sharesAmount = 2761;
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);
      // eto failed - must destroy before state transition
      await testCommitment._destroyTokens(tokenTermsDict.EQUITY_TOKENS_PER_SHARE);
      // fail eto
      await testCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Refund);
      // expect failed resolution
      const resolutionId = getCommitmentResolutionId(testCommitment.address);
      const resolution = await equityTokenController.resolution(resolutionId);
      expectResolution(resolution, resolutionId, GovAction.RegisterOffer, GovExecutionState.Failed);
      // now testCommitment will be replaced with new commitment
      const oldCommitment = testCommitment;
      // deploy new terms but use same controller
      // default terms have non transferable token
      await deployETO({
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      const newCommitment = testCommitment;
      const newResolutionId = getCommitmentResolutionId(newCommitment.address);
      // register new offering from legal rep address
      await expect(
        equityTokenController.startNewOffering(newResolutionId, newCommitment.address),
      ).to.be.rejectedWith("NF_GOV_EXEC_ACCESS_DENIED");
      const newOfferTx = await equityTokenController.startNewOffering(
        newResolutionId,
        newCommitment.address,
        { from: company },
      );
      expectLogResolutionStarted(
        newOfferTx,
        0,
        newResolutionId,
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
      await startOffering();
      // generate tokens via new commitment
      await newCommitment._generateTokens(amount);
      // old commitment cannot generate tokens
      await expect(oldCommitment._generateTokens(amount)).to.be.rejectedWith(
        "NF_EQTOKEN_NO_GENERATE",
      );
      // also cannot distribute (we didn't destroy all tokens above)
      await expect(oldCommitment._distributeTokens(investors[0], 1)).to.be.revert;
      await newCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Claim);
      newResolution = await equityTokenController.resolution(newResolutionId);
      expectResolution(
        newResolution,
        newResolutionId,
        GovAction.RegisterOffer,
        GovExecutionState.Completed,
      );
      // the failed ETO didn't destroy all the tokens at the end which would be a critical bug in
      // business logic. we however use this case for test transferability.
      // here we take into account those non destroyed tokens
      // verify offerings and cap table
      const expectedShares = sharesAmount * 2 - 1; // we destroyed 1 share
      expect(await equityTokenController.tokens()).to.deep.equal([
        [equityToken.address],
        [new web3.BigNumber(GovTokenType.Equity)],
        [new web3.BigNumber(GovTokenState.Open)],
        [tokenholderRights.address],
        [true], // transfers were set to true
      ]);
      const tps = await equityToken.tokensPerShare();
      const supply = await equityToken.totalSupply();
      expect(Q18.mul(expectedShares)).to.be.bignumber.eq(divRound(supply.mul(Q18), tps));
      expect(await equityTokenController.tokenOfferings()).to.deep.equal([
        [newCommitment.address],
        [equityToken.address],
      ]);
      // distribute and transfer (transfers were enabled for non retail eto)
      await newCommitment._distributeTokens(investors[0], 10);
      await equityToken.transfer(investors[1], 1, { from: investors[0] });
    });

    // there are many rejection cases: like not from registered ETO, not from ETO, from other ETO in universe but not registered, from registered ETO but in Offering state

    it("rejects fail ETO from ETO not registered before", async () => {});

    async function testTransfersInOffering(transfersEnabled) {
      const amount = new web3.BigNumber(281871);
      // transfers disabled before offering - typical transfer
      expect(await equityTokenController.onTransfer(investors[0], investors[0], investors[1], 0)).to
        .be.false;
      // eto contract trying to generate tokens
      await startOffering();
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
      await deployController();
      await testTransfersInOffering(false);
    });

    it("should allow transfers after eto if requested in terms", async () => {
      await deployETO({
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      await deployController();
      await testTransfersInOffering(true);
    });

    it("should prevent transfers from registered ETO when it fails", async () => {
      await startOffering();
      const sharesAmount = 2761;
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);

      await testCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Refund);

      await expect(testCommitment._distributeTokens(investors[0], 1)).to.be.revert;
    });
  });

  async function preparePostInvestmentState() {
    // register new offering
    await startOffering();
    await generateTokens();
    // add upgrade admin role to admin account, apply to all contracts
    await createAccessPolicy(accessPolicy, [{ subject: admin, role: roles.companyUpgradeAdmin }]);
  }

  async function generateTokens() {
    // make investments
    const amount = new web3.BigNumber(7162 * (await equityToken.tokensPerShare()));
    await testCommitment._generateTokens(amount);
    // finish offering
    const tx = await testCommitment._triggerStateTransition(
      CommitmentState.Whitelist,
      CommitmentState.Claim,
    );
    return tx;
  }

  describe("migrations", () => {
    let newController;
    beforeEach(async () => {
      await preparePostInvestmentState();
      // deploy new mocked token controller for same company
      newController = await MockSingleEquityTokenController.new(
        universe.address,
        company,
        ZERO_ADDRESS,
      );
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
      // now anyone can replace token controller in equity token
      await equityToken.changeTokenController(newController.address);
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
      await startOffering();
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
      const newController2 = await SingleEquityTokenController.new(
        universe.address,
        company,
        ZERO_ADDRESS,
      );
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

      // to change controller in equity token we need to follow the chain
      await expect(
        equityToken.changeTokenController(newController2.address, { from: investors[0] }),
      ).to.be.rejectedWith("NF_ET_NO_PERM_NEW_CONTROLLER");
      await equityToken.changeTokenController(newController.address, { from: investors[1] });
      await equityToken.changeTokenController(newController2.address, { from: investors[2] });

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
      const newController2 = await SingleEquityTokenController.new(
        universe.address,
        company,
        ZERO_ADDRESS,
      );
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

  describe("post investment actions", () => {
    beforeEach(async () => {
      await preparePostInvestmentState();
    });

    it("reverts on investor rights when operational", async () => {
      await expect(equityTokenController.closeCompany()).to.be.rejectedWith("NF_INV_STATE");
      await expect(equityTokenController.cancelCompanyClosing()).to.be.rejectedWith("NF_INV_STATE");
    });

    it("revert on receive ether and euro tokens with NOT_IMPL", async () => {
      // tokenFallback is used to pay dividend in full implementation
      await expect(equityTokenController.tokenFallback(ZERO_ADDRESS, 0, "")).to.be.rejectedWith(
        "NF_NOT_IMPL",
      );
    });

    it("should execute general information rights", async () => {
      const resolutionId = randomBytes32();
      const tx = await equityTokenController.issueGeneralInformation(
        resolutionId,
        "TOKENHOLDERS CALL",
        "ipfs:blah",
        { from: company },
      );
      expectLogResolutionStarted(
        tx,
        0,
        resolutionId,
        "TOKENHOLDERS CALL",
        "ipfs:blah",
        GovAction.None,
        GovExecutionState.Completed,
      );
    });

    it("rejects general information not from company", async () => {
      const resolutionId = randomBytes32();
      await expect(
        equityTokenController.issueGeneralInformation(
          resolutionId,
          "TOKENHOLDERS CALL",
          "ipfs:blah",
          {
            from: admin,
          },
        ),
      ).to.be.rejectedWith("NF_ONLY_COMPANY");
    });

    it("rejects general information in setup", async () => {
      const resolutionId = randomBytes32();
      await deployController();
      await expect(
        equityTokenController.issueGeneralInformation(
          resolutionId,
          "TOKENHOLDERS CALL",
          "ipfs:blah",
          {
            from: admin,
          },
        ),
      ).to.be.rejectedWith("NF_INV_STATE");
    });

    it("rejects amend Agreement (ISHA) by company", async () => {
      // ISHA amendment only through resolution, company cannot do that
      await expect(equityTokenController.amendAgreement("NEW")).to.be.revert;
    });

    it("should return true onApprove", async () => {
      expect(await equityTokenController.onApprove(investors[0], investors[1], 0)).to.be.true;
    });

    it("should return 0 on onAllowance", async () => {
      expect(
        await equityTokenController.onAllowance(investors[0], investors[1]),
      ).to.be.bignumber.eq(0);
    });

    it("should return false on changing nominee", async () => {
      expect(
        await equityTokenController.onChangeNominee(equityToken.address, nominee, investors[0]),
      ).to.be.false;
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
      await deployController();
      // register new offering
      await startOffering();
      // issue equity token with Q18
      await testCommitment._generateTokens(initialBalance);
      // finish offering
      await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Claim,
      );

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
      ovrController ||
      (await SingleEquityTokenController.new(universe.address, company, testCommitment.address));
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
    // pass equity token to eto commitment
    await testCommitment.setStartDate(etoTerms.address, equityToken.address, "0");
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
    );
    await universe.setCollectionsInterfaces(
      [knownInterfaces.commitmentInterface, knownInterfaces.termsInterface],
      [testCommitment.address, etoTerms.address],
      [true, true],
      { from: admin },
    );
    await testCommitment.amendAgreement("AGREEMENT#HASH", { from: nominee });
  }

  async function startOffering(commitmentOvr) {
    const commitment = commitmentOvr || testCommitment;
    const tx = await commitment._triggerStateTransition(
      CommitmentState.Setup,
      CommitmentState.Setup,
    );
    await commitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Whitelist);
    return tx;
  }

  async function migrateController(oldController, newController, options) {
    const opts = Object.assign({}, options);
    // start migration
    const tx = await oldController.startMigrateTo(newController.address, { from: admin });
    expectLogGovStateTransition(tx, GovState.Funded, GovState.Migrating);
    expect(await oldController.isMigrating()).to.be.true;
    expect(await oldController.migratedTo()).to.eq(ZERO_ADDRESS);
    // read state
    const state = await oldController.preMigrationState();
    const tokens = await oldController.tokens();
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
    await newController.migrateGeneralInformation(
      information[4],
      information[0],
      opts.authorizedCapital || information[3],
      information[1],
      opts.transfersEnabled === undefined ? tokens[4][0] : opts.transfersEnabled,
      { from: admin },
    );
    await newController.migrateAddCommitment(offerings[0][0], { from: admin });
    await newController.migrateResolutions(resolutionIds, ...resolutions, { from: admin });
    await newController.migrateGovernance(tokens[3][0], tokens[0][0], { from: admin });
    // link old controller and set the state
    await newController.finishMigrateFrom(oldController.address, state, { from: admin });
    // finish migration
    const migratedTx = await oldController.finishMigrateTo(newController.address, {
      from: admin,
    });
    expectLogMigratedTo(migratedTx, oldController.address, newController.address);
  }

  async function expectControllerEqualState(oldController, newController, options) {
    const opts = Object.assign({ checkLinking: true }, options);
    // compare new and old controller - all should be imported
    expect(await oldController.companyLegalRepresentative()).to.deep.equal(
      await newController.companyLegalRepresentative(),
    );
    const tokens = await oldController.tokens();
    if (opts.transfersEnabled !== undefined) {
      tokens[4] = [opts.transfersEnabled];
    }
    expect(tokens).to.deep.equal(await newController.tokens());
    expect(await oldController.tokenOfferings()).to.deep.equal(
      await newController.tokenOfferings(),
    );
    const information = await oldController.shareholderInformation();
    if (opts.authorizedCapital !== undefined) {
      // sets authorizedCapital without breaking deep equal
      information[3] = information[3].sub(information[3]).add(opts.authorizedCapital);
    }
    expect(await newController.shareholderInformation()).to.deep.equal(information);
    const agreementData = await oldController.currentAgreement();
    expect(agreementData[2]).to.eq((await newController.currentAgreement())[2]);
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
    // compare resolutions
    const resolutionIds = await oldController.resolutionsList();
    expect(await newController.resolutionsList()).to.deep.equal(resolutionIds);
    for (const resolutionId of resolutionIds) {
      const resolution = await oldController.resolution(resolutionId);
      expect(await newController.resolution(resolutionId)).to.deep.equal(resolution);
    }
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

  function expectLogISHAAmended(
    tx,
    resolutionId,
    ishaUrl,
    newShareCapital,
    newValuation,
    newShareholderRights,
  ) {
    const event = eventValue(tx, "LogISHAAmended");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.ISHAUrl).to.eq(ishaUrl);
    expect(event.args.shareCapitalUlps).to.be.bignumber.eq(newShareCapital);
    expect(event.args.companyValuationEurUlps).to.be.bignumber.eq(newValuation);
    expect(event.args.newShareholderRights).eq(newShareholderRights);
  }

  function expectLogAuthorizedCapitalEstablished(tx, resolutionId, authorizedCapital) {
    const event = eventValue(tx, "LogAuthorizedCapitalEstablished");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.authorizedCapitalUlps).to.be.bignumber.eq(authorizedCapital);
  }
});
