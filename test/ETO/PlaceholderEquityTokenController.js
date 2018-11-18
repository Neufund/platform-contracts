import { expect } from "chai";
import { deployPlatformTerms, deployUniverse } from "../helpers/deployContracts";
import { contractId, ZERO_ADDRESS, toBytes32 } from "../helpers/constants";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { GovState, GovAction } from "../helpers/govState";
import { CommitmentState } from "../helpers/commitmentState";
import {
  deployDurationTerms,
  deployETOTerms,
  deployShareholderRights,
  deployTokenTerms,
} from "../helpers/deployTerms";
import { knownInterfaces } from "../helpers/knownInterfaces";
import { decodeLogs, eventValue } from "../helpers/events";

const PlaceholderEquityTokenController = artifacts.require("PlaceholderEquityTokenController");
const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const ShareholderRights = artifacts.require("ShareholderRights");
const EquityToken = artifacts.require("EquityToken");
const TestETOCommitmentPlaceholderTokenController = artifacts.require(
  "TestETOCommitmentPlaceholderTokenController",
);
const MockPlaceholderEquityTokenController = artifacts.require(
  "MockPlaceholderEquityTokenController",
);

contract("PlaceholderEquityTokenController", ([_, admin, company, nominee, ...investors]) => {
  let equityToken;
  let equityTokenController;
  // let accessPolicy;
  let universe;
  let etoTerms;
  // let etoTermsDict;
  let tokenTerms;
  let testCommitment;

  beforeEach(async () => {
    [universe] = await deployUniverse(admin, admin);
    await deployPlatformTerms(universe, admin);
    const [shareholderRights] = await deployShareholderRights(ShareholderRights);
    const [durationTerms] = await deployDurationTerms(ETODurationTerms);
    [tokenTerms] = await deployTokenTerms(ETOTokenTerms);
    [etoTerms] = await deployETOTerms(
      universe,
      ETOTerms,
      durationTerms,
      tokenTerms,
      shareholderRights,
    );
    equityTokenController = await PlaceholderEquityTokenController.new(universe.address, company);
    equityToken = await EquityToken.new(
      universe.address,
      equityTokenController.address,
      etoTerms.address,
      nominee,
      company,
    );
    await equityToken.amendAgreement("AGREEMENT#HASH", { from: nominee });
  });

  it("should deploy and check initial state", async () => {
    await prettyPrintGasCost("PlaceholderEquityTokenController deploy", equityTokenController);
    expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Setup);
    const shareholderInfo = await equityTokenController.shareholderInformation();
    for (const v of shareholderInfo) {
      expect(v).to.be.bignumber.eq(0);
    }
    const capTable = await equityTokenController.capTable();
    expect(capTable[0].length).to.eq(0);
    expect(capTable[1].length).to.eq(0);
    expect(capTable[2].length).to.eq(0);
    expect((await equityTokenController.contractId())[0]).to.eq(
      contractId("PlaceholderEquityTokenController"),
    );
    expect(await equityTokenController.commitmentObserver()).to.eq(ZERO_ADDRESS);
    expect(await equityTokenController.newTokenController()).to.eq(ZERO_ADDRESS);
    expect(await equityTokenController.oldTokenController()).to.eq(ZERO_ADDRESS);
  });

  describe("offering actions", () => {
    beforeEach(async () => {
      testCommitment = await TestETOCommitmentPlaceholderTokenController.new(
        universe.address,
        nominee,
        company,
        etoTerms.address,
        equityToken.address,
      );
      await universe.setCollectionsInterfaces(
        [
          knownInterfaces.commitmentInterface,
          knownInterfaces.equityTokenInterface,
          knownInterfaces.equityTokenControllerInterface,
        ],
        [testCommitment.address, equityToken.address, equityTokenController.address],
        [true, true, true],
        { from: admin },
      );
      await testCommitment.amendAgreement("AGREEMENT#HASH", { from: nominee });
    });

    // for each test all state data should be obtained from the contract and compared to what we want
    it("should register ETO start", async () => {
      const tx = await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      expect(await equityTokenController.commitmentObserver()).to.eq(testCommitment.address);
      const etoLogs = decodeLogs(
        tx,
        equityTokenController.address,
        PlaceholderEquityTokenController.abi,
      );
      tx.logs.push(...etoLogs);
      // expectLogGovStateTransition();
      expectLogResolutionExecuted(tx, toBytes32("0"), GovAction.RegisterOffer);
      // LogOfferingRegistered();
      // check cap table and investor information
    });

    it("rejects register ETO start from ETO not in universe", async () => {
      await universe.setCollectionInterface(
        knownInterfaces.commitmentInterface,
        testCommitment.address,
        false,
        { from: admin },
      );
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Whitelist),
      ).to.be.rejectedWith("NF_ETC_ETO_NOT_U");
    });

    it("rejects duplicate register ETO start", async () => {
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Whitelist),
      ).to.be.rejectedWith("NF_ETC_BAD_STATE");
    });

    it("rejects register ETO with mismatching terms, addresses, tokens");

    it("should allow generating and destroying tokens only by registered ETO in Offering state", async () => {
      const amount = new web3.BigNumber(281871);
      await expect(testCommitment._generateTokens(amount)).to.be.revert;
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      await testCommitment._generateTokens(amount);
      expect(await equityToken.balanceOf(testCommitment.address)).to.be.bignumber.eq(amount);
      await testCommitment._destroyTokens(amount);
      expect(await equityToken.balanceOf(testCommitment.address)).to.be.bignumber.eq(0);
      // try to issue via other address
      await expect(equityToken.issueTokens(amount, { from: company })).to.be.revert;
      // try to destroy
      await testCommitment._generateTokens(amount);
      await expect(equityToken.destroyTokens(amount, { from: company })).to.be.revert;
      // approve eto - should not be able to issue tokens
      await testCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Claim);
      await expect(testCommitment._generateTokens(amount)).to.be.revert;
      await expect(testCommitment._destroyTokens(amount)).to.be.revert;
    });

    // approval sets equity token in cap table, sets Agreement to ISHA, sets general company information, moves state to Funded
    it("should approve ETO and execute transfer rights");
    it("rejects approve ETO from ETO not registered before");
    it("rejects approve ETO from registered ETO that was removed from universe");
    it("should fail ETO - refund");
    it("rejects fail ETO from ETO not registered before");
    // there are many rejection cases: like not from registered ETO, not from ETO, from other ETO in universe but not registered, from registered ETO but in Offering state
    it(
      "should allow transfer if transfers disabled only from registered ETO and only in Offering state",
    );
  });

  describe("post investment actions", () => {
    beforeEach(async () => {
      // prepare offering
      testCommitment = await TestETOCommitmentPlaceholderTokenController.new(
        universe.address,
        nominee,
        company,
        etoTerms.address,
        equityToken.address,
      );
      await universe.setCollectionsInterfaces(
        [
          knownInterfaces.commitmentInterface,
          knownInterfaces.equityTokenInterface,
          knownInterfaces.equityTokenControllerInterface,
        ],
        [testCommitment.address, equityToken.address, equityTokenController.address],
        [true, true, true],
        { from: admin },
      );
      await testCommitment.amendAgreement("AGREEMENT#HASH", { from: nominee });
      // register new offering
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      // make investments
      const amount = new web3.BigNumber(7162 * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);
      // finish offering
      await testCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Claim);
    });

    // startResolution, executeResolution, closeCompany, cancelCompanyClosing
    it("reverts on voting rights");
    // tokenFallback is used to pay dividend in full implementation
    it("reverts on tokenFallback");

    it("should migrate token controller", async () => {
      // deploy new mocked token controller
      const newController = await MockPlaceholderEquityTokenController.new(
        universe.address,
        equityTokenController.address,
      );
      const tx = await equityTokenController.changeTokenController(newController.address, {
        from: company,
      });
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Migrated);
      expect(await equityTokenController.newTokenController()).to.eq(newController.address);
      expectLogResolutionExecuted(tx, toBytes32("0"), GovAction.ChangeTokenController);
      expectLogMigratedTokenController(tx, toBytes32("0"), newController.address);
      // migrate data from parent
      await newController._finalizeMigration({ from: company });
      // equity token still has old controller - transfers are enabled
      await testCommitment._distributeTokens(investors[0], 10);
      await equityToken.transfer(investors[1], 1, { from: investors[0] });
      // now anyone can replace token controller in equity token
      await equityToken.changeTokenController(newController.address);
      await expect(equityToken.transfer(investors[1], 1, { from: investors[0] })).to.be.revert;
      // compare new and old controller - all should be imported
      expect(await equityTokenController.companyLegalRepresentative()).to.deep.equal(
        await equityTokenController.companyLegalRepresentative(),
      );
      expect(await equityTokenController.capTable()).to.deep.equal(
        await equityTokenController.capTable(),
      );
      expect(await equityTokenController.shareholderInformation()).to.deep.equal(
        await equityTokenController.shareholderInformation(),
      );
    });

    it("rejects migrating token controller not by company");
    it("rejects migrating token controller in wrong states");
    it("should not allow closing token");
    it("should allow changing token controller");
    // we let migrate multiple times in case first one goes wrong
    it("should migrate token controller twice");
    it("should execute general information rights");
    it("rejects amend Agreement (ISHA) by company");
    it("should return true onApprove");
    it("should return 0 on onAllowance");
    it("should return false on changing nominee");
  });

  // a set of tests vs EquityToken
  // first -> run a full test suite for tokens as in EquityToken.js for Placeholder controller with enabled transfers.
  it("rejects transfer if disallowed");
  it("rejects transferFrom is disallowed");
  it("rejects closing token");
  it("rejects nominee change");
  it("should change token controller if old controller properly migrated");
  it("revert on receive ether and euro tokens with NOT_IMPL");

  function expectLogResolutionExecuted(tx, resolutionId, actionType) {
    const event = eventValue(tx, "LogResolutionExecuted");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.action).to.be.bignumber.eq(actionType);
  }

  function expectLogMigratedTokenController(tx, resolutionId, newController) {
    const event = eventValue(tx, "LogMigratedTokenController");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.newController).eq(newController);
  }
});
