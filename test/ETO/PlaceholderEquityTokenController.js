import { expect } from "chai";
import { deployPlatformTerms, deployUniverse } from "../helpers/deployContracts";
import { contractId, ZERO_ADDRESS, toBytes32, Q18 } from "../helpers/constants";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { GovState, GovAction } from "../helpers/govState";
import { CommitmentState } from "../helpers/commitmentState";
import {
  deployDurationTerms,
  deployETOTerms,
  deployShareholderRights,
  deployTokenTerms,
  constTokenTerms,
} from "../helpers/deployTerms";
import { knownInterfaces } from "../helpers/knownInterfaces";
import { decodeLogs, eventValue, eventWithIdxValue, hasEvent } from "../helpers/events";
import {
  basicTokenTests,
  deployTestErc223Callback,
  deployTestErc677Callback,
  erc223TokenTests,
  erc677TokenTests,
  standardTokenTests,
} from "../helpers/tokenTestCases";

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
  let etoTermsDict;
  let tokenTerms;
  let tokenTermsDict;
  let testCommitment;
  let shareholderRights;
  let durationTerms;

  beforeEach(async () => {
    [universe] = await deployUniverse(admin, admin);
    await deployPlatformTerms(universe, admin);
    [shareholderRights] = await deployShareholderRights(ShareholderRights);
    [durationTerms] = await deployDurationTerms(ETODurationTerms);
    [tokenTerms, tokenTermsDict] = await deployTokenTerms(ETOTokenTerms);
    await deployController();
  });

  it("should deploy and check initial state", async () => {
    await prettyPrintGasCost("PlaceholderEquityTokenController deploy", equityTokenController);
    expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Setup);
    const shareholderInfo = await equityTokenController.shareholderInformation();
    for (const v of shareholderInfo) {
      expect(v).to.be.bignumber.eq(0);
    }
    const capTable = await equityTokenController.capTable();
    expect(capTable.length).to.eq(2);
    expect(capTable[0].length).to.eq(0);
    expect(capTable[1].length).to.eq(0);

    const tokenOfferings = await equityTokenController.tokenOfferings();
    expect(tokenOfferings.length).to.eq(2);
    expect(tokenOfferings[0].length).to.eq(0);
    expect(tokenOfferings[1].length).to.eq(0);

    expect((await equityTokenController.contractId())[0]).to.eq(
      contractId("PlaceholderEquityTokenController"),
    );
    expect(await equityTokenController.commitmentObserver()).to.eq(ZERO_ADDRESS);
    expect(await equityTokenController.newTokenController()).to.eq(ZERO_ADDRESS);
    expect(await equityTokenController.oldTokenController()).to.eq(ZERO_ADDRESS);
  });

  describe("offering actions", () => {
    beforeEach(async () => {
      await deployETO();
    });

    it("should register ETO start", async () => {
      const tx = await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      expect(await equityTokenController.commitmentObserver()).to.eq(testCommitment.address);
      const etcLogs = decodeLogs(
        tx,
        equityTokenController.address,
        PlaceholderEquityTokenController.abi,
      );
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Setup, GovState.Offering);
      expectLogResolutionExecuted(tx, 0, toBytes32("0"), GovAction.RegisterOffer);
      expectLogOfferingRegistered(tx, toBytes32("0"), testCommitment.address, equityToken.address);
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Offering);
      // no cap table
      expect(await equityTokenController.capTable()).to.deep.eq([[], []]);
      // no shareholder info yet
      expect(await equityTokenController.shareholderInformation()).to.deep.eq([
        new web3.BigNumber(0),
        new web3.BigNumber(0),
        ZERO_ADDRESS,
      ]);
      // but offering is there
      expect(await equityTokenController.tokenOfferings()).to.deep.eq([
        [testCommitment.address],
        [equityToken.address],
      ]);
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

    it(
      "rejects register ETO with mismatching terms, addresses, tokens and equity token controller",
    );

    it("should allow generating and destroying tokens only by registered ETO in Offering state", async () => {
      const amount = new web3.BigNumber(281871);
      await expect(testCommitment._generateTokens(amount)).to.be.revert;
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
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
      // approve eto - should not be able to issue tokens
      await testCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Claim);
      expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Funded);
      await expect(testCommitment._generateTokens(amount)).to.be.revert;
      await expect(testCommitment._destroyTokens(amount)).to.be.revert;
    });

    it("should approve ETO and execute transfer rights", async () => {
      // approval sets equity token in cap table, sets Agreement to ISHA, sets general company information, moves state to Funded
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      const sharesAmount = 2761;
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);
      let tx = await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Public,
      );
      // placeholder controller ignores this transition
      let etcLogs = decodeLogs(
        tx,
        equityTokenController.address,
        PlaceholderEquityTokenController.abi,
      );
      expect(etcLogs.length).to.eq(0);
      // go to signing - also ignores
      tx = await testCommitment._triggerStateTransition(
        CommitmentState.Public,
        CommitmentState.Signing,
      );
      etcLogs = decodeLogs(tx, equityTokenController.address, PlaceholderEquityTokenController.abi);
      expect(etcLogs.length).to.eq(0);
      tx = await testCommitment._triggerStateTransition(
        CommitmentState.Signing,
        CommitmentState.Claim,
      );
      etcLogs = decodeLogs(tx, equityTokenController.address, PlaceholderEquityTokenController.abi);
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Offering, GovState.Funded);
      expectLogOfferingSucceeded(tx, testCommitment.address, equityToken.address, sharesAmount);
      const tokenAction = etoTermsDict.ENABLE_TRANSFERS_ON_SUCCESS
        ? GovAction.ContinueToken
        : GovAction.StopToken;
      expectLogResolutionExecuted(tx, 1, toBytes32("0x0"), tokenAction);
      expectLogResolutionExecuted(tx, 0, toBytes32("0x0"), GovAction.AmendISHA);
      expectLogTransfersStateChanged(
        tx,
        toBytes32("0x0"),
        equityToken.address,
        etoTermsDict.ENABLE_TRANSFERS_ON_SUCCESS,
      );
      const newTotalShares = etoTermsDict.EXISTING_COMPANY_SHARES.add(sharesAmount);
      const expectedValuation = newTotalShares
        .mul(constTokenTerms.EQUITY_TOKENS_PER_SHARE)
        .mul(tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
      expectLogISHAAmended(
        tx,
        toBytes32("0x0"),
        await testCommitment.signedInvestmentAgreementUrl(),
        newTotalShares,
        expectedValuation,
        shareholderRights.address,
      );
      // verify offerings and cap table
      expect(await equityTokenController.capTable()).to.deep.equal([
        [equityToken.address],
        [new web3.BigNumber(sharesAmount)],
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
    });

    it("should approve ETO with 0 new shares", async () => {
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      const tx = await testCommitment._triggerStateTransition(
        CommitmentState.Signing,
        CommitmentState.Claim,
      );
      const etcLogs = decodeLogs(
        tx,
        equityTokenController.address,
        PlaceholderEquityTokenController.abi,
      );
      tx.logs.push(...etcLogs);
      expectLogISHAAmended(
        tx,
        toBytes32("0x0"),
        await testCommitment.signedInvestmentAgreementUrl(),
        etoTermsDict.EXISTING_COMPANY_SHARES,
        etoTermsDict.EXISTING_COMPANY_SHARES.mul(constTokenTerms.EQUITY_TOKENS_PER_SHARE).mul(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        ),
        shareholderRights.address,
      );
    });

    it("reject approve when not in funding state", async () => {
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Whitelist, CommitmentState.Claim),
      ).to.be.rejectedWith("NF_ETC_UNREG_COMMITMENT");
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Claim,
      );
      await expect(
        testCommitment._triggerStateTransition(CommitmentState.Whitelist, CommitmentState.Claim),
      ).to.be.rejectedWith("NF_ETC_BAD_STATE");
    });

    it("rejects approve ETO from ETO not registered before", async () => {
      // move original commitment to be ready for approval
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      // create identical new one
      const testCommitmentRound2 = await TestETOCommitmentPlaceholderTokenController.new(
        universe.address,
        nominee,
        company,
        etoTerms.address,
        equityToken.address,
      );
      await universe.setCollectionsInterfaces(
        [knownInterfaces.commitmentInterface],
        [testCommitmentRound2.address],
        [true],
        { from: admin },
      );
      await testCommitmentRound2.amendAgreement("AGREEMENT#HASH", { from: nominee });
      // mock approval state
      await expect(
        testCommitmentRound2._triggerStateTransition(
          CommitmentState.Whitelist,
          CommitmentState.Claim,
        ),
      ).to.be.rejectedWith("NF_ETC_UNREG_COMMITMENT");
    });

    it("rejects approve ETO from registered ETO that was removed from universe", async () => {
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
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
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
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
        PlaceholderEquityTokenController.abi,
      );
      tx.logs.push(...etcLogs);
      expectLogGovStateTransition(tx, GovState.Offering, GovState.Setup);
      expectLogOfferingFailed(tx, testCommitment.address, equityToken.address);
      // no transfer change
      expect(hasEvent(tx, "LogTransfersStateChanged")).to.be.false;
      // no ISHA amended
      expect(hasEvent(tx, "LogISHAAmended")).to.be.false;
      // verify offerings and cap table
      expect(await equityTokenController.capTable()).to.deep.equal([[], []]);
      expect(await equityTokenController.tokenOfferings()).to.deep.equal([[], []]);
    });

    it("should approve ETO after first one failed", async () => {
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      const sharesAmount = 2761;
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);
      // eto failed - must destroy before state transition
      await testCommitment._destroyTokens(constTokenTerms.EQUITY_TOKENS_PER_SHARE);
      // fail eto
      await testCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Refund);
      // deploy new terms but use same controller
      // default terms have non transferable token
      [etoTerms, etoTermsDict] = await deployETOTerms(
        universe,
        ETOTerms,
        durationTerms,
        tokenTerms,
        shareholderRights,
        {
          ALLOW_RETAIL_INVESTORS: false,
          ENABLE_TRANSFERS_ON_SUCCESS: true,
          MAX_TICKET_EUR_ULPS: Q18.mul(100000),
        },
      );
      // now testCommitment will be replaced with new commitment
      const oldCommitment = testCommitment;
      await deployETO();
      // make it clear
      const newCommitment = testCommitment;
      await newCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Whitelist);
      // generate tokens via new commitment
      await newCommitment._generateTokens(amount);
      // old commitment cannot generate tokens
      await expect(oldCommitment._generateTokens(amount)).to.be.rejectedWith(
        "NF_EQTOKEN_NO_GENERATE",
      );
      // also cannot distribute (we didn't destroy all tokens above)
      await expect(oldCommitment._distributeTokens(investors[0], 1)).to.be.revert;
      await newCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Claim);
      // the failed ETO didn't destroy all the tokens at the end which would be a critical bug in
      // business logic. we however use this case for test transferability.
      // here we take into account those non destroyed tokens
      // verify offerings and cap table
      const expectedShares = sharesAmount * 2 - 1; // we destroyed 1 share
      expect(await equityTokenController.capTable()).to.deep.equal([
        [equityToken.address],
        [new web3.BigNumber(expectedShares)],
      ]);
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
      // eto contract trying to
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      await testCommitment._generateTokens(amount);
      // transfers disabled for investors
      expect(await equityTokenController.onTransfer(investors[0], investors[0], investors[1], 0)).to
        .be.false;
      // transfers enabled for eto commitment
      expect(
        await equityTokenController.onTransfer(
          testCommitment.address,
          testCommitment.address,
          investors[1],
          0,
        ),
      ).to.be.true;
      // brokered transfers for eto commitment disallowed
      expect(
        await equityTokenController.onTransfer(
          testCommitment.address,
          investors[0],
          investors[1],
          0,
        ),
      ).to.be.false;
      // make actual token distribution
      await testCommitment._distributeTokens(investors[0], 10);
      await testCommitment._distributeTokens(investors[1], 20);
      // approve eto
      await testCommitment._triggerStateTransition(CommitmentState.Setup, CommitmentState.Claim);
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
      await deployController({ ALLOW_RETAIL_INVESTORS: true, ENABLE_TRANSFERS_ON_SUCCESS: false });
      await deployETO();
      await testTransfersInOffering(false);
    });

    it("should allow transfers after eto if requested in terms", async () => {
      await deployController({
        ALLOW_RETAIL_INVESTORS: false,
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      await deployETO();
      await testTransfersInOffering(true);
    });

    it("should prevent transfers from registered ETO when it fails", async () => {
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      const sharesAmount = 2761;
      const amount = new web3.BigNumber(sharesAmount * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);

      await testCommitment._triggerStateTransition(CommitmentState.Signing, CommitmentState.Refund);

      await expect(testCommitment._distributeTokens(investors[0], 1)).to.be.revert;
    });
  });

  describe("post investment actions", () => {
    beforeEach(async () => {
      await deployETO();
      // register new offering
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      // make investments
      const amount = new web3.BigNumber(7162 * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);
      // finish offering
      await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Claim,
      );
    });

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
      expectLogResolutionExecuted(tx, 0, toBytes32("0"), GovAction.ChangeTokenController);
      expectLogMigratedTokenController(tx, toBytes32("0"), newController.address);
      // migrate data from parent
      await newController._finalizeMigration({ from: company });
      // equity token still has old controller - transfers are disabled
      await testCommitment._distributeTokens(investors[0], 10);
      await expect(equityToken.transfer(investors[1], 1, { from: investors[0] })).to.be.revert;
      // now anyone can replace token controller in equity token
      await equityToken.changeTokenController(newController.address);
      // new mocked controller allows to enable transfer at will
      await newController._enableTransfers(true, { from: company });
      equityToken.transfer(investors[1], 1, { from: investors[0] });
      // compare new and old controller - all should be imported
      expect(await equityTokenController.companyLegalRepresentative()).to.deep.equal(
        await newController.companyLegalRepresentative(),
      );
      expect(await equityTokenController.capTable()).to.deep.equal(await newController.capTable());
      expect(await equityTokenController.tokenOfferings()).to.deep.equal(
        await newController.tokenOfferings(),
      );
      expect(await equityTokenController.shareholderInformation()).to.deep.equal(
        await newController.shareholderInformation(),
      );
    });

    it("rejects migrating token controller not by company");
    it("rejects migrating token controller in wrong states");

    it("reverts on investor rights when operational", async () => {
      await expect(
        equityTokenController.startResolution(
          "Secondary Offering",
          "ipfs:blah",
          GovAction.RegisterOffer,
          toBytes32(testCommitment.address),
          { from: company },
        ),
      ).to.be.rejectedWith("NF_NOT_IMPL");
      await expect(equityTokenController.executeResolution(toBytes32("0x0"))).to.be.rejectedWith(
        "NF_NOT_IMPL",
      );
      await expect(equityTokenController.closeCompany()).to.be.rejectedWith("NF_INV_STATE");
      await expect(equityTokenController.cancelCompanyClosing()).to.be.rejectedWith("NF_INV_STATE");
    });

    it("revert on receive ether and euro tokens with NOT_IMPL", async () => {
      // tokenFallback is used to pay dividend in full implementation
      await expect(equityTokenController.tokenFallback(ZERO_ADDRESS, 0, "")).to.be.rejectedWith(
        "NF_NOT_IMPL",
      );
    });

    // we let migrate multiple times in case first one goes wrong
    it("should migrate token controller twice");

    it("should execute general information rights", async () => {
      const tx = await equityTokenController.issueGeneralInformation(
        "TOKENHOLDERS CALL",
        "ipfs:blah",
        { from: company },
      );
      expectLogGeneralInformation(tx, company, "TOKENHOLDERS CALL", "ipfs:blah");
    });

    it("rejects general information not from company", async () => {
      await expect(
        equityTokenController.issueGeneralInformation("TOKENHOLDERS CALL", "ipfs:blah", {
          from: admin,
        }),
      ).to.be.rejectedWith("NF_ONLY_COMPANY");
    });

    it("rejects general information in setup", async () => {
      await deployController();
      await expect(
        equityTokenController.issueGeneralInformation("TOKENHOLDERS CALL", "ipfs:blah", {
          from: admin,
        }),
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
      await deployController({
        ALLOW_RETAIL_INVESTORS: false,
        ENABLE_TRANSFERS_ON_SUCCESS: true,
        MAX_TICKET_EUR_ULPS: Q18.mul(100000),
      });
      await deployETO();
      // register new offering
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
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

  async function deployController(termsOverride) {
    // default terms have non transferable token
    [etoTerms, etoTermsDict] = await deployETOTerms(
      universe,
      ETOTerms,
      durationTerms,
      tokenTerms,
      shareholderRights,
      termsOverride,
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
  }

  async function deployETO() {
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
  }

  function expectLogResolutionExecuted(tx, logIdx, resolutionId, actionType) {
    const event = eventWithIdxValue(tx, logIdx, "LogResolutionExecuted");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.action).to.be.bignumber.eq(actionType);
  }

  function expectLogGovStateTransition(tx, oldState, newState, timestamp) {
    const event = eventValue(tx, "LogGovStateTransition");
    expect(event).to.exist;
    expect(event.args.oldState).to.be.bignumber.eq(oldState);
    expect(event.args.newState).to.be.bignumber.eq(newState);
    if (timestamp) {
      expect(event.args.timestamp).to.be.bignumber.eq(timestamp);
    }
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

  function expectLogMigratedTokenController(tx, resolutionId, newController) {
    const event = eventValue(tx, "LogMigratedTokenController");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.newController).eq(newController);
  }

  function expectLogGeneralInformation(tx, companyLegalRep, infoType, infoUrl) {
    const event = eventValue(tx, "LogGeneralInformation");
    expect(event).to.exist;
    expect(event.args.companyLegalRep).to.eq(companyLegalRep);
    expect(event.args.informationType).eq(infoType);
    expect(event.args.informationUrl).eq(infoUrl);
  }

  function expectLogISHAAmended(
    tx,
    resolutionId,
    ishaUrl,
    newTotalShares,
    newValuation,
    newShareholderRights,
  ) {
    const event = eventValue(tx, "LogISHAAmended");
    expect(event).to.exist;
    expect(event.args.resolutionId).to.eq(resolutionId);
    expect(event.args.ISHAUrl).to.eq(ishaUrl);
    expect(event.args.totalShares).to.be.bignumber.eq(newTotalShares);
    expect(event.args.companyValuationEurUlps).to.be.bignumber.eq(newValuation);
    expect(event.args.newShareholderRights).eq(newShareholderRights);
  }
});
