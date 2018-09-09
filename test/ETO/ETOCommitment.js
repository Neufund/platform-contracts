import { expect } from "chai";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { divRound } from "../helpers/unitConverter";
import {
  deployUniverse,
  deployPlatformTerms,
  deployEuroTokenUniverse,
  deployIdentityRegistry,
  deployNeumarkUniverse,
  deployEtherTokenUniverse,
  deploySimpleExchangeUniverse,
  deployEtherTokenMigration,
  deployEuroTokenMigration,
} from "../helpers/deployContracts";
import {
  deployShareholderRights,
  deployDurationTerms,
  deployETOTerms,
  deployTokenTerms,
} from "../helpers/deployTerms";
import { CommitmentState } from "../helpers/commitmentState";
import { GovState } from "../helpers/govState";
import { knownInterfaces } from "../helpers/knownInterfaces";
import { eventValue, decodeLogs, eventWithIdxValue } from "../helpers/events";
import increaseTime, { setTimeTo } from "../helpers/increaseTime";
import { latestTimestamp } from "../helpers/latestTime";
import roles from "../helpers/roles";
import createAccessPolicy from "../helpers/createAccessPolicy";
import { deserializeClaims } from "../helpers/identityClaims";
import {
  ZERO_ADDRESS,
  Q18,
  dayInSeconds,
  toBytes32,
  contractId,
  monthInSeconds,
} from "../helpers/constants";
import { expectLogFundsCommitted } from "../helpers/commitment";

const EquityToken = artifacts.require("EquityToken");
const PlaceholderEquityTokenController = artifacts.require("PlaceholderEquityTokenController");
const ETOCommitment = artifacts.require("ETOCommitment");
const MockETOCommitment = artifacts.require("MockETOCommitment");
const ETOTerms = artifacts.require("ETOTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ShareholderRights = artifacts.require("ShareholderRights");

const PLATFORM_SHARE = web3.toBigNumber("2");
const minDepositAmountEurUlps = Q18.mul(500);
const minWithdrawAmountEurUlps = Q18.mul(20);
const maxSimpleExchangeAllowanceEurUlps = Q18.mul(50);
const platformWallet = "0x00447f37bde6c89ad47c1d1e16025e707d3d363a";
const defEthPrice = "657.39278932";
const UNKNOWN_STATE_START_TS = 10000000; // state startOf timeestamps invalid below this
const platformShare = nmk => nmk.div(PLATFORM_SHARE).round(0, 1); // round down
// we take one wei of NEU so we do not have to deal with rounding errors
const investorShare = nmk => nmk.sub(platformShare(nmk)).sub(1);

contract("ETOCommitment", ([deployer, admin, company, nominee, ...investors]) => {
  // basic infrastructure
  let universe;
  let identityRegistry;
  let accessPolicy;
  // tokens
  let etherToken;
  let euroToken;
  let euroTokenController;
  let neumark;
  // token prices
  let rateOracle;
  let gasExchange;
  // terms
  let platformTerms;
  let platformTermsDict;
  let tokenTerms;
  let tokenTermsDict;
  let etoTerms;
  let etoTermsDict;
  let shareholderRights;
  // let shareholderTermsDict;
  let durationTerms;
  let durTermsDict;
  // eto contracts
  let equityTokenController;
  let equityToken;
  let etoCommitment;

  beforeEach(async () => {
    // deploy access policy and universe contract, admin account has all permissions of the platform
    [universe, accessPolicy] = await deployUniverse(admin, admin);
    // note that all deploy... functions also set up permissions and set singletons in universe
    identityRegistry = await deployIdentityRegistry(universe, admin, admin);
    // set simple address (platform wallet) for fees disbursal
    await universe.setSingleton(knownInterfaces.feeDisbursal, platformWallet, { from: admin });
    // set simple address for platform portfolio
    await universe.setSingleton(knownInterfaces.platformPortfolio, platformWallet, { from: admin });
    // platform wallet is verified
    await identityRegistry.setClaims(platformWallet, "0x0", toBytes32(web3.toHex(1)), {
      from: admin,
    });
    // deploy ether token
    etherToken = await deployEtherTokenUniverse(universe, admin);
    // euro token with default settings
    [euroToken, euroTokenController] = await deployEuroTokenUniverse(
      universe,
      admin,
      admin,
      admin,
      minDepositAmountEurUlps,
      minWithdrawAmountEurUlps,
      maxSimpleExchangeAllowanceEurUlps,
    );
    // deploy neumark
    neumark = await deployNeumarkUniverse(universe, admin);
    // deploy token price oracle
    [gasExchange, rateOracle] = await deploySimpleExchangeUniverse(
      universe,
      admin,
      etherToken,
      euroToken,
      admin,
      admin,
    );
    // set eth to eur rate
    await gasExchange.setExchangeRate(etherToken.address, euroToken.address, Q18.mul(defEthPrice), {
      from: admin,
    });
    // deploy general terms of the platform
    [platformTerms, platformTermsDict] = await deployPlatformTerms(universe, admin);
  });

  describe("setup tests", () => {
    beforeEach(async () => {
      await deployETO();
    });

    it("should deploy", async () => {
      await prettyPrintGasCost("ETOCommitment deploy", etoCommitment);
      await prettyPrintGasCost("PlaceholderEquityTokenController deploy", equityTokenController);
      // check getters
      expect(await etoCommitment.etoTerms()).to.eq(etoTerms.address);
      expect(await etoCommitment.equityToken()).to.eq(equityToken.address);
      expect(await etoCommitment.nominee()).to.eq(nominee);
      expect(await etoCommitment.companyLegalRep()).to.eq(company);
      const singletons = await etoCommitment.singletons();
      expect(singletons[0]).to.eq(platformWallet);
      expect(singletons[1]).to.eq(identityRegistry.address);
      expect(singletons[2]).to.eq(universe.address);
      expect(singletons[3]).to.eq(platformTerms.address);

      // check state machine
      expect(await etoCommitment.state()).to.be.bignumber.eq(0);
      expect(await etoCommitment.commitmentObserver()).to.eq(equityTokenController.address);
      const startOfStates = await etoCommitment.startOfStates(); // array of 7
      for (const startOf of startOfStates) {
        expect(startOf).to.be.bignumber.lt(UNKNOWN_STATE_START_TS);
      }
      await expectStateStarts({ Refund: 0 }, defaultDurationTable());
      // check initial eto progress
      expect(await etoCommitment.failed()).to.be.false;
      expect(await etoCommitment.finalized()).to.be.false;
      expect(await etoCommitment.success()).to.be.false;
      const contribution = await etoCommitment.contributionSummary();
      expect(contribution.length).to.eq(8);
      for (const v of contribution) {
        expect(v).to.be.bignumber.eq(0);
      }
      const ticket = await etoCommitment.investorTicket(investors[0]);
      expect(ticket.length).to.eq(10);
      // skip two false flags
      for (const v of ticket.slice(0, -2)) {
        expect(v).to.be.bignumber.eq(0);
      }
      await expectProperETOSetup(etoCommitment.address);
      const cid = await etoCommitment.contractId();
      expect(cid[0]).to.eq(contractId("ETOCommitment"));
    });

    it("should set start date", async () => {
      // company confirms terms and sets start date
      let startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
      startDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
      const tx = await etoCommitment.setStartDate(
        etoTerms.address,
        equityToken.address,
        startDate,
        {
          from: company,
        },
      );
      expectLogTermsSet(tx, company, etoTerms.address, equityToken.address);
      expectLogETOStartDateSet(tx, company, 0, startDate);
      // timed state machine works now and we can read out expected starts of states
      await expectStateStarts({ Whitelist: startDate, Refund: 0 }, defaultDurationTable());
    });

    it("should reset start date", async () => {
      // company confirms terms and sets start date
      let startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
      startDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
      await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
        from: company,
      });
      // timed state machine works now and we can read out expected starts of states
      await expectStateStarts({ Whitelist: startDate, Refund: 0 }, defaultDurationTable());

      let newStartDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds * 2);
      newStartDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
      await etoCommitment.setStartDate(etoTerms.address, equityToken.address, newStartDate, {
        from: company,
      });
      // timed state machine works now and we can read out expected starts of states
      await expectStateStarts({ Whitelist: newStartDate, Refund: 0 }, defaultDurationTable());
    });

    it("rejects setting initial start date closer than DATE_TO_WHITELIST_MIN_DURATION to now", async () => {
      // set exactly DATE_TO_WHITELIST_MIN_DURATION - 1 second
      let startDate = new web3.BigNumber((await latestTimestamp()) - 1);
      startDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
      await expect(
        etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: company,
        }),
      ).to.revert;
    });

    // @marcin: not sure how to test this, do we have some kind of time machine mechanism?
    // yes, there are ways to time travel ;> increaseTime and setTimeTo - only ganache
    it(
      "rejects re-setting start date if now is less than DATE_TO_WHITELIST_MIN_DURATION to previous start date",
    );

    it("rejects setting date not from company", async () => {
      // company confirms terms and sets start date
      let startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
      startDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
      await expect(
        etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: investors[0],
        }),
      ).to.revert;
    });

    it("rejects setting date before block.timestamp");

    it("rejects setting agreement not from Nominee");

    it("should reclaim ether");

    // ether token, euro token, NEU, equity tokern - achtung needs to be implemented in the contract
    it("reject on reclaiming any token");
  });

  describe("MockETOCommitment tests", () => {
    it("should mock time", async () => {
      await deployETO(MockETOCommitment);
      await prettyPrintGasCost("MockETOCommitment deploy", etoCommitment);
      const timestamp = await latestTimestamp();
      const startDate = new web3.BigNumber(timestamp - 3 * dayInSeconds);
      // set start data to the past via mocker
      await etoCommitment._mockStartDate(etoTerms.address, equityToken.address, startDate);
      const tx = await etoCommitment.handleStateTransitions();
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, startDate);
      // we should have correct state times
      const durTable = defaultDurationTable();
      const publicStartOf = startDate.add(durTable[CommitmentState.Whitelist]);
      await expectStateStarts({ Whitelist: startDate, Public: publicStartOf, Refund: 0 }, durTable);
      // mock public state directly
      const newPublicTs = publicStartOf.add(1000);
      await etoCommitment._mockPastTime(1, newPublicTs);
      await expectStateStarts({ Whitelist: startDate, Public: newPublicTs, Refund: 0 }, durTable);
      await etoCommitment._mockPastTime(1, publicStartOf);
      // rollback past so should transition to public
      const whitelistD = durTable[CommitmentState.Whitelist].add(1);
      await etoCommitment._mockShiftBackTime(whitelistD);
      await expectStateStarts(
        {
          Whitelist: startDate.sub(whitelistD),
          Public: publicStartOf.sub(whitelistD),
          Refund: 0,
        },
        durTable,
      );
      // this will transition to public and invest (tokenFallback is self transitioning)
      await investAmount(investors[0], Q18.mul(23987.288912), "EUR");
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
    });
  });

  // investment cases
  it("with changing ether price during ETO");
  it("reject if ETH price feed outdated");
  it("reject if investment from unknown payment token");

  // specific cases
  it("unverified investor cannot invest");
  it("frozen investor cannot invest");
  it("cannot invest when ETO not in Universe"); // drop working ETO from universe and invest
  it("cannot invest when ETO cannot issue NEU"); // drop NEU permission from working ETO
  it("investor with fixed slot may invest more than maximum ticket"); // providing fixed slot is bigger
  it("not enough EUR to send nominal value to Nominee");
  it("go from public to signing by reaching max cap exactly");
  it("go from public to signing by reaching max cap within minimum ticket");
  it("two tests above but by crossing from whitelist. two state transitions must occur.");
  it("go from whitelist to public if whitelist maximum cap exceeded and no fixed slots");
  it("fixed slots may exceed whitelist maximum cap but will not induce state transition");
  it("fixed slots will induce signing state if total max cap exceeded");
  it(
    "go from whitelist to public if whitelist maximum cap exceeded and fixed slots do not count to the cap",
  );
  it("sign to claim with feeDisbursal as simple address");
  it("sign to claim with feeDisbursal as contract implementing fallback");
  it(
    "should invest with induced state transition from setup to whitelist and whitelist to public (big ticket)",
  );
  it("should invest with induced state transition from setup to signing (very big ticket)");
  it("refund nominee returns nominal value");
  it("should refund if company signs too late");
  it("should refund if nominee signs too late");
  it("should allow to fundraise again on the same token");
  it("reverts on euro token overflow > 2**96");
  // simulates abandoned ETO
  it("go from Setup with start date to Refund with one large increase time");
  // this prevents situation that ETO fails because there is no ticket size that can bring it to min cap
  it(
    "should transition to signing if total investment amount below min cap but within minimum ticket to max cap",
  );

  describe("all claim cases", () => {
    it("should claim in claim");
    it("should claim in payout");
    it("should claim twice without effect");
    it("should claim without ticket without effect");
    it("should claim many in claim");
    it("should claim many in payout");
    it("should claim many with duplicates without effect");
    it("should claim many without tickets without effect");
  });

  describe("calculateContribution", () => {
    it("calculate contribution in whitelist (with discounts)");
    it("calculate contribution in whitelist when fixed slots");
    it("max cap flag exceeded should be set in whitelist and public");
  });
  // describe("all whitelist cases");
  // describe("all public cases");

  describe("simulated cases", () => {
    describe("with new money", () => {
      beforeEach(async () => {
        await deployETO();
      });
      it("mixed currency and successful", async () => {
        // add investor1 and investor2 to whitelist - no discount
        await etoTerms.addWhitelisted(
          [investors[0], investors[1]],
          [0, 0],
          [Q18.mul(1), Q18.mul(1)],
          {
            from: deployer,
          },
        );
        let startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
        startDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
        await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: company,
        });
        // skip time to after start date to test state machine
        await skipTimeTo(startDate.add(10));
        let tx = await etoCommitment.handleStateTransitions();
        // actual block time and startDate may differ slightly
        expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, startDate);
        const whitelistTs = new web3.BigNumber(await latestTimestamp());
        // we should be in whitelist state now
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
        // we should have correct state times
        const durTable = defaultDurationTable();
        const publicStartOf = startDate.add(durTable[CommitmentState.Whitelist]);
        await expectStateStarts(
          { Whitelist: startDate, Public: publicStartOf, Refund: 0 },
          durTable,
        );
        // whitelist timestamp should come at least 10 seconds after startDate
        expect(whitelistTs.sub(startDate)).to.be.bignumber.gte(10);
        // token controller should be in offering state and have preliminary entry in cap table
        expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Offering);
        const capTable = await equityTokenController.capTable();
        expect(capTable[0].length).to.eq(0);
        expect(capTable[1].length).to.eq(0);
        expect(capTable[2].length).to.eq(0);
        const generalInfo = await equityTokenController.shareholderInformation();
        expect(generalInfo[0]).to.be.bignumber.eq(etoTermsDict.EXISTING_COMPANY_SHARES);
        expect(generalInfo[1]).to.be.bignumber.eq(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS.mul(etoTermsDict.EXISTING_COMPANY_SHARES).mul(
            platformTermsDict.EQUITY_TOKENS_PER_SHARE,
          ),
        );
        expect(generalInfo[2]).to.eq(ZERO_ADDRESS);
        // apply whitelist general discount, fixed slots not tested here
        const disountedPrice = discountedPrice(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          etoTermsDict.WHITELIST_DISCOUNT_FRAC,
        );
        // invest some
        await investAmount(investors[0], Q18, "ETH", disountedPrice);
        await investAmount(investors[0], Q18.mul(1.1289791), "ETH", disountedPrice);
        await investAmount(investors[1], Q18.mul(0.9528763), "ETH", disountedPrice);
        await investAmount(investors[0], Q18.mul(30876.18912), "EUR", disountedPrice);
        const publicStartDate = startDate.add(durTermsDict.WHITELIST_DURATION);
        // console.log(new Date(publicStartDate * 1000));
        await skipTimeTo(publicStartDate.add(1));
        tx = await etoCommitment.handleStateTransitions();
        // we should be in public state now
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
        // actual block time and startDate may differ slightly
        expectLogStateTransition(
          tx,
          CommitmentState.Whitelist,
          CommitmentState.Public,
          publicStartDate,
        );
        const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
        await expectStateStarts(
          { Whitelist: startDate, Public: publicStartDate, Signing: signingStartOf, Refund: 0 },
          durTable,
        );
        // we have constant price in this use case - no discounts
        const tokenprice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
        // invest so we have min cap
        await investAmount(investors[1], Q18.mul(130876.61721), "EUR", tokenprice);
        // out of whitelist
        await investAmount(investors[2], Q18.mul(1500.1721), "ETH", tokenprice);
        await investAmount(
          investors[3],
          etoTermsDict.MAX_TICKET_EUR_ULPS.div(2),
          "EUR",
          tokenprice,
        );
        await investAmount(investors[4], Q18.mul(1000), "EUR", tokenprice);
        // must still be public
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
        const totalInvestment = await etoCommitment.totalInvestment();
        // we must cross MIN CAP
        if (tokenTermsDict.MIN_NUMBER_OF_TOKENS.gt(totalInvestment[1])) {
          const missingTokens = tokenTermsDict.MIN_NUMBER_OF_TOKENS.sub(totalInvestment[1]);
          let missingAmount = missingTokens.mul(tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
          if (missingAmount.lt(etoTermsDict.MIN_TICKET_EUR_ULPS)) {
            missingAmount = etoTermsDict.MIN_TICKET_EUR_ULPS;
          }
          // console.log(`min cap investment: ${missingTokens} ${missingAmount} EUR`);
          await investAmount(investors[4], missingAmount, "EUR", tokenprice);
        }
        // go to signing
        await skipTimeTo(signingStartOf.add(1));
        tx = await etoCommitment.handleStateTransitions();
        // we should be in public state now
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
        // actual block time and startDate may differ slightly
        expectLogStateTransition(
          tx,
          CommitmentState.Public,
          CommitmentState.Signing,
          signingStartOf,
        );
        const claimStartOf = signingStartOf.add(durTable[CommitmentState.Signing]);
        await expectStateStarts(
          {
            Whitelist: startDate,
            Public: publicStartDate,
            Signing: signingStartOf,
            Claim: claimStartOf,
            Refund: 0,
          },
          durTable,
        );
        // check various total before signing
        const contribution = await expectValidSigningState(investors);
        expectLogSigningStarted(tx, nominee, company, contribution[0], contribution[1]);
        // sign
        const investmentAgreementUrl = "ipfs:3290890ABINVESTMENT";
        const companySignTx = await etoCommitment.companySignsInvestmentAgreement(
          investmentAgreementUrl,
          { from: company },
        );
        expectLogCompanySignedAgreement(companySignTx, company, nominee, investmentAgreementUrl);
        // move time before nominee signs
        await increaseTime(
          durTermsDict.SIGNING_DURATION.div(2)
            .round()
            .toNumber(),
        );
        const nomineeSignTx = await etoCommitment.nomineeConfirmsInvestmentAgreement(
          investmentAgreementUrl,
          { from: nominee },
        );
        expectLogNomineeConfirmedAgreement(nomineeSignTx, nominee, company, investmentAgreementUrl);
        // this is also state transition into claim
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Claim);
        expect(await etoCommitment.signedInvestmentAgreementUrl()).to.eq(investmentAgreementUrl);
        const claimTs = new web3.BigNumber(await latestTimestamp());
        expectLogStateTransition(
          nomineeSignTx,
          CommitmentState.Signing,
          CommitmentState.Claim,
          claimTs,
        );
        const payoutStartOf = claimTs.add(durTable[CommitmentState.Claim]);
        await expectStateStarts(
          {
            Whitelist: startDate,
            Public: publicStartDate,
            Signing: signingStartOf,
            Claim: claimTs,
            Payout: payoutStartOf,
            Refund: 0,
          },
          durTable,
        );
        await expectValidClaimState(nomineeSignTx, contribution);
        await claimInvestor(investors[0]);
        await claimMultipleInvestors(investors.slice(1));
        // everyone claimed so the only equity tokens left is the platform fee
        expect(await equityToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
          contribution[4],
        );
        // investors and platform operator got their neu
        expect((await neumark.balanceOf(etoCommitment.address)).sub(8).abs()).to.be.bignumber.lt(
          10,
        );
        await skipTimeTo(payoutStartOf.add(1));
        tx = await etoCommitment.handleStateTransitions();
        expectLogStateTransition(tx, CommitmentState.Claim, CommitmentState.Payout, payoutStartOf);
        await expectStateStarts(
          {
            Whitelist: startDate,
            Public: publicStartDate,
            Signing: signingStartOf,
            Claim: claimTs,
            Payout: payoutStartOf,
            Refund: 0,
          },
          durTable,
        );
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Payout);
        await expectValidPayoutState(tx, contribution);
        await expectValidPayoutStateFullClaim(tx);
      });

      it("mixed currency and refunded");
      it("ether only and successful");
      it("euro only and successful");
      it("no min cap empty commitment");
      it("with min cap empty commitment");
    });

    describe("with LockedAccount", () => {
      beforeEach(async () => {
        await deployLockedAccounts();
        await deployETO();
      });

      it("mixed currency and successful", async () => {
        await createLockedAccounts(investors.slice(0, 5));
        const durTable = defaultDurationTable();
        let startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
        startDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
        await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: company,
        });
        await skipTimeTo(startDate);
        await etoCommitment.handleStateTransitions();
        // apply whitelist general discount, fixed slots not tested here
        const disountedPrice = discountedPrice(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          etoTermsDict.WHITELIST_DISCOUNT_FRAC,
        );
        // invest from ICBM contract
        await investICBMAmount(investors[0], Q18, "ETH", disountedPrice);
        await investICBMAmount(investors[0], Q18.mul(7.87261621), "ETH", disountedPrice);
        await investICBMAmount(investors[1], Q18.mul(34.098171), "ETH", disountedPrice);
        await investICBMAmount(investors[0], Q18.mul(73692.76198871), "EUR", disountedPrice);
        const publicStartDate = startDate.add(durTermsDict.WHITELIST_DURATION);
        await skipTimeTo(publicStartDate.add(1));
        await etoCommitment.handleStateTransitions();
        // we have constant price in this use case - no discounts
        const tokenprice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
        // invest so we have min cap
        await investICBMAmount(investors[1], Q18.mul(611527.8172891), "EUR", tokenprice);
        // out of whitelist
        await investICBMAmount(investors[2], Q18.mul(417.817278172), "ETH", tokenprice);
        await investICBMAmount(
          investors[3],
          etoTermsDict.MAX_TICKET_EUR_ULPS.div(2),
          "EUR",
          tokenprice,
        );
        await investICBMAmount(investors[4], Q18.mul(1000), "EUR", tokenprice);
        // must still be public
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
        const totalInvestment = await etoCommitment.totalInvestment();
        // we must cross MIN CAP
        if (tokenTermsDict.MIN_NUMBER_OF_TOKENS.gt(totalInvestment[1])) {
          const missingTokens = tokenTermsDict.MIN_NUMBER_OF_TOKENS.sub(totalInvestment[1]);
          let missingAmount = missingTokens.mul(tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
          if (missingAmount.lt(etoTermsDict.MIN_TICKET_EUR_ULPS)) {
            missingAmount = etoTermsDict.MIN_TICKET_EUR_ULPS;
          }
          // console.log(`min cap investment: ${missingTokens} ${missingAmount} EUR`);
          await investICBMAmount(investors[4], missingAmount, "EUR", tokenprice);
        }
        // go to signing
        const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
        await skipTimeTo(signingStartOf.add(1));
        await etoCommitment.handleStateTransitions();
        // check various total before signing
        const contribution = await expectValidSigningState(investors);
        const investmentAgreementUrl = "ipfs:3290890ABINVESTMENT";
        await etoCommitment.companySignsInvestmentAgreement(investmentAgreementUrl, {
          from: company,
        });
        const nomineeSignTx = await etoCommitment.nomineeConfirmsInvestmentAgreement(
          investmentAgreementUrl,
          { from: nominee },
        );
        const claimTs = new web3.BigNumber(await latestTimestamp());
        const payoutStartOf = claimTs.add(durTable[CommitmentState.Claim]);
        await expectValidClaimState(nomineeSignTx, contribution);
        await claimInvestor(investors[0]);
        await claimMultipleInvestors(investors.slice(1));
        await expectNoICBMPendingCommitments(investors);
        // everyone claimed so the only equity tokens left is the platform fee
        expect(await equityToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
          contribution[4],
        );
        // investors and platform operator got their neu
        expect((await neumark.balanceOf(etoCommitment.address)).sub(8).abs()).to.be.bignumber.lt(
          10,
        );
        await skipTimeTo(payoutStartOf.add(1));
        const tx = await etoCommitment.handleStateTransitions();
        await expectValidPayoutState(tx, contribution);
        await expectValidPayoutStateFullClaim(tx);
      });

      it("mixed currency and refunded", async () => {
        const participatingInvestors = investors.slice(0, 3);
        await createLockedAccounts(participatingInvestors);
        let startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
        startDate = startDate.add(await platformTerms.DATE_TO_WHITELIST_MIN_DURATION());
        await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: company,
        });
        await skipTimeTo(startDate);
        await etoCommitment.handleStateTransitions();
        // apply whitelist general discount, fixed slots not tested here
        const disountedPrice = discountedPrice(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          etoTermsDict.WHITELIST_DISCOUNT_FRAC,
        );
        // invest from ICBM contract
        await investICBMAmount(investors[0], Q18, "ETH", disountedPrice);
        await investICBMAmount(investors[1], Q18.mul(73692.76198871), "EUR", disountedPrice);
        await investICBMAmount(investors[2], Q18.mul(367.7162812), "ETH", disountedPrice);
        const refundStartDate = startDate
          .add(durTermsDict.WHITELIST_DURATION)
          .add(durTermsDict.PUBLIC_DURATION);
        await skipTimeTo(refundStartDate.add(1));
        const refundTx = await etoCommitment.handleStateTransitions();
        await expectValidRefundState(refundTx, participatingInvestors);
        await refundInvestor(investors[0]);
        await refundMultipleInvestors(participatingInvestors.slice(1));
        await expectNoICBMPendingCommitments(participatingInvestors);
        await expectICBMFullWallets(participatingInvestors);
      });

      it("ether only and successful");
      it("euro only and successful");
    });

    describe("with LockedAccount and new money", () => {
      it("mixed currency and successful");
      it("mixed currency and refunded");
      it("ether only and successful");
      it("euro only and successful");
    });
  });

  // helper functions here
  let euroLockedAccount;
  let etherLockedAccount;
  let icbmEuroLockedAccount;
  let icbmEtherLockedAccount;
  let icbmEuroToken;
  let icbmEtherToken;
  let icbmEuroController;
  let icbmEtherController;

  async function deployLockedAccounts() {
    const LOCK_PERIOD = 18 * monthInSeconds;
    const UNLOCK_PENALTY_FRACTION = Q18.mul(0.1).round(0, 0);
    [
      etherLockedAccount,
      icbmEtherLockedAccount,
      icbmEtherToken,
      icbmEtherController,
    ] = await deployEtherTokenMigration(
      universe,
      admin,
      platformWallet,
      LOCK_PERIOD,
      UNLOCK_PENALTY_FRACTION,
    );
    await icbmEtherLockedAccount.enableMigration(etherLockedAccount.address, {
      from: admin,
    });
    [
      euroLockedAccount,
      icbmEuroLockedAccount,
      icbmEuroToken,
      icbmEuroController,
    ] = await deployEuroTokenMigration(
      universe,
      admin,
      platformWallet,
      LOCK_PERIOD,
      UNLOCK_PENALTY_FRACTION,
    );
    await icbmEuroLockedAccount.enableMigration(euroLockedAccount.address, {
      from: admin,
    });
    // reload euro lock settings
    await euroTokenController.applySettings(
      minDepositAmountEurUlps,
      minWithdrawAmountEurUlps,
      maxSimpleExchangeAllowanceEurUlps,
      { from: admin },
    );
  }

  async function expectNoICBMPendingCommitments(investorsSlice) {
    for (const investor of investorsSlice) {
      const eurPending = await euroLockedAccount.pendingCommitments(
        etoCommitment.address,
        investor,
      );
      expect(eurPending[0]).to.be.bignumber.eq(0);
      const ethPending = await etherLockedAccount.pendingCommitments(
        etoCommitment.address,
        investor,
      );
      expect(ethPending[0]).to.be.bignumber.eq(0);
    }
  }

  const initialICBMEthBalance = Q18.mul(500);
  const initialICBMEurBalance = Q18.mul(5000000);
  const initialICBMNeuRate = 3.25;

  async function expectICBMFullWallets(investorsSlice) {
    for (const investor of investorsSlice) {
      const eurBalance = await euroLockedAccount.balanceOf(investor);
      expect(eurBalance[0]).to.be.bignumber.eq(initialICBMEurBalance);
      expect(eurBalance[1]).to.be.bignumber.eq(initialICBMEurBalance.mul(initialICBMNeuRate));
      const ethBalance = await etherLockedAccount.balanceOf(investor);
      expect(ethBalance[0]).to.be.bignumber.eq(initialICBMEthBalance);
      expect(ethBalance[1]).to.be.bignumber.eq(initialICBMEthBalance.mul(initialICBMNeuRate));
    }
  }

  async function createLockedAccounts(investorsSlice) {
    async function makeDepositEth(from, to, amount) {
      await icbmEtherToken.deposit({ from, value: amount });
      if (from !== to) {
        await icbmEtherToken.approve(to, amount, { from });
      }
    }

    async function makeDepositEuro(from, to, amount) {
      await icbmEuroToken.deposit(from, amount, { from: admin });
      if (from !== to) {
        await icbmEuroToken.approve(to, amount, { from });
      }
    }

    async function migrateOne(icbmLockedAccount, controller, makeDeposit, ticket, investorAddress) {
      const neumarks = ticket.mul(initialICBMNeuRate);
      await makeDeposit(investorAddress, controller.address, ticket);
      await controller.investToken(neumarks, { from: investorAddress });
      await icbmLockedAccount.migrate({ from: investorAddress });
    }
    for (const investor of investorsSlice) {
      // each investor gets 5 000 000  eur and 500 ether
      await migrateOne(
        icbmEtherLockedAccount,
        icbmEtherController,
        makeDepositEth,
        initialICBMEthBalance,
        investor,
      );
      await migrateOne(
        icbmEuroLockedAccount,
        icbmEuroController,
        makeDepositEuro,
        initialICBMEurBalance,
        investor,
      );
      // simulate signing NEU agreement (todo: give real neu here)
      await neumark.approve(investor, 0, { from: investor });
    }
  }

  async function expectValidInvestorClaim(tx, investor, logIdx) {
    const ticket = await etoCommitment.investorTicket(investor);
    let ilogIdx = logIdx;
    if (ilogIdx === undefined) {
      // there's just single investor in tx
      expect(ticket[8]).to.be.true;
      ilogIdx = 0;
    } else {
      const wasSettled = ticket[8];
      if (!wasSettled) {
        return;
      }
    }
    expectLogTokensClaimed(tx, ilogIdx, investor, ticket[2], ticket[1]);
    expect(await neumark.balanceOf(investor)).to.be.bignumber.eq(ticket[1]);
    expect(await equityToken.balanceOf(investor)).to.be.bignumber.eq(ticket[2]);
    expect(await equityToken.agreementSignedAtBlock(investor)).to.be.bignumber.gt(0);
    expect(await neumark.agreementSignedAtBlock(investor)).to.be.bignumber.gt(0);
  }

  async function expectValidInvestorRefund(tx, investor, idx) {
    const ticket = await etoCommitment.investorTicket(investor);
    let logIdx = idx * 2;
    if (idx === undefined) {
      // there's just single investor in tx
      expect(ticket[8]).to.be.true;
      logIdx = 0;
    } else {
      const wasSettled = ticket[8];
      if (!wasSettled) {
        return;
      }
    }
    // refund ether
    expectLogFundsRefunded(tx, logIdx, investor, etherToken.address, ticket[6]);
    // refund euro
    expectLogFundsRefunded(tx, logIdx + 1, investor, euroToken.address, ticket[7]);

    expect(await neumark.balanceOf(investor)).to.be.bignumber.eq(0);
    expect(await equityToken.balanceOf(investor)).to.be.bignumber.eq(0);
    expect(await equityToken.agreementSignedAtBlock(investor)).to.be.bignumber.eq(0);
    // skip ICBM investors - they are signed to NEU previously
    if (!ticket[9]) {
      expect(await neumark.agreementSignedAtBlock(investor)).to.be.bignumber.eq(0);
      // for non icbm investors - additional check (we do corresponding chekck for ICBM investors in expectFullICBMWallets)
      expect(await etherToken.balanceOf(investor)).to.be.bignumber.eq(ticket[7]);
      expect(await euroToken.balanceOf(investor)).to.be.bignumber.eq(ticket[6]);
    }
  }

  async function deployETO(
    ovrArtifact,
    ovrETOTerms,
    ovrShareholderRights,
    ovrDurations,
    ovrTokenTerms,
  ) {
    // deploy ETO Terms: here deployment of single ETO contracts start
    [shareholderRights] = await deployShareholderRights(ShareholderRights, ovrShareholderRights);
    [durationTerms, durTermsDict] = await deployDurationTerms(ETODurationTerms, ovrDurations);
    [tokenTerms, tokenTermsDict] = await deployTokenTerms(ETOTokenTerms, ovrTokenTerms);
    [etoTerms, etoTermsDict] = await deployETOTerms(
      ETOTerms,
      durationTerms,
      tokenTerms,
      shareholderRights,
      ovrETOTerms,
    );
    // deploy equity token controller which is company management contract
    equityTokenController = await PlaceholderEquityTokenController.new(universe.address, company);
    // deploy equity token
    equityToken = await EquityToken.new(
      universe.address,
      equityTokenController.address,
      etoTerms.address,
      nominee,
      company,
    );
    // deploy ETOCommitment
    etoCommitment = await (ovrArtifact || ETOCommitment).new(
      universe.address,
      platformWallet,
      nominee,
      company,
      etoTerms.address,
      equityToken.address,
    );
    // add ETO contracts to collections in universe in one transaction -> must be atomic
    await universe.setCollectionsInterfaces(
      [
        knownInterfaces.commitmentInterface,
        knownInterfaces.equityTokenInterface,
        knownInterfaces.equityTokenControllerInterface,
      ],
      [etoCommitment.address, equityToken.address, equityTokenController.address],
      [true, true, true],
      { from: admin },
    );
    // nominee sets legal agreements
    await equityToken.amendAgreement("AGREEMENT#HASH", { from: nominee });
    await etoCommitment.amendAgreement("AGREEMENT#HASH", { from: nominee });
    // neu token manager allows ETOCommitment to issue NEU
    await createAccessPolicy(accessPolicy, [
      { role: roles.neumarkIssuer, object: neumark.address, subject: etoCommitment.address },
    ]);
    // nominee is verified
    await identityRegistry.setClaims(nominee, "0x0", toBytes32(web3.toHex(1)), {
      from: admin,
    });
    // company is verified
    await identityRegistry.setClaims(company, "0x0", toBytes32(web3.toHex(1)), {
      from: admin,
    });
  }

  async function expectProperETOSetup(etoCommitmentAddress) {
    const eto = await ETOCommitment.at(etoCommitmentAddress);
    const canIssueNEU = await accessPolicy.allowed.call(
      etoCommitmentAddress,
      roles.neumarkIssuer,
      neumark.address,
      "",
    );
    expect(canIssueNEU).to.be.true;
    expect(
      await universe.isInterfaceCollectionInstance(
        knownInterfaces.commitmentInterface,
        etoCommitmentAddress,
      ),
    ).to.be.true;
    expect(
      await universe.isInterfaceCollectionInstance(
        knownInterfaces.equityTokenInterface,
        await eto.equityToken(),
      ),
    ).to.be.true;
    expect(
      await universe.isInterfaceCollectionInstance(
        knownInterfaces.equityTokenControllerInterface,
        await eto.commitmentObserver(),
      ),
    ).to.be.true;
    expect(await universe.feeDisbursal()).not.eq(ZERO_ADDRESS);
    expect(await universe.platformPortfolio()).not.eq(ZERO_ADDRESS);
    const claims = await identityRegistry.getMultipleClaims([
      await eto.nominee(),
      await eto.companyLegalRep(),
      (await eto.singletons())[0], // platform operator wallet
    ]);
    for (const claim of claims) {
      // must be properly verified
      const deserializedClaims = deserializeClaims(claim);
      expect(Object.assign(...deserializedClaims).isVerified).to.be.true;
    }
    const ethRate = await rateOracle.getExchangeRate(etherToken.address, euroToken.address);
    const rateExpiration = await platformTerms.TOKEN_RATE_EXPIRES_AFTER();
    const now = await latestTimestamp();
    expect(ethRate[1], "eth rate too old for investment").to.be.bignumber.lt(
      rateExpiration.add(now),
    );
  }

  async function investAmount(investor, amount, currency, expectedPrice) {
    // ticket verification
    const oldTicket = await etoCommitment.investorTicket(investor);
    // verify investor
    const claims = new web3.BigNumber(await identityRegistry.getClaims(investor), 16);
    let token;
    let eurEquiv;
    if (!claims.mod(2).eq(1)) {
      await identityRegistry.setClaims(investor, claims, toBytes32(web3.toHex(claims.add(1))), {
        from: admin,
      });
    }
    if (currency === "ETH") {
      // get current eth price
      const ethRate = await rateOracle.getExchangeRate(etherToken.address, euroToken.address);
      eurEquiv = divRound(ethRate[0].mul(amount), Q18);
      await etherToken.deposit({ from: investor, value: amount });
      token = etherToken;
    } else if (currency === "EUR") {
      eurEquiv = amount;
      await euroToken.deposit(investor, amount, 0x0, { from: admin });
      token = euroToken;
    }
    const expectedNeu = investorShare(await neumark.incremental(eurEquiv));
    // use overloaded erc223 to transfer to contract with callback
    const tx = await token.transfer["address,uint256,bytes"](etoCommitment.address, amount, "", {
      from: investor,
    });
    // console.log(`investor ${investor} gasUsed ${tx.receipt.gasUsed}`);
    // validate investment
    const ticket = await etoCommitment.investorTicket(investor);
    // console.log(oldTicket);
    // console.log(ticket);
    expect(ticket[0]).to.be.bignumber.eq(eurEquiv.add(oldTicket[0]));
    expect(ticket[1]).to.be.bignumber.eq(expectedNeu.add(oldTicket[1]));
    // check only if expected token price was given
    let expectedEquity;
    if (expectedPrice) {
      expectedEquity = divRound(eurEquiv, expectedPrice);
    } else {
      expectedEquity = ticket[2].sub(oldTicket[2]);
    }
    expect(ticket[2].sub(oldTicket[2])).to.be.bignumber.eq(expectedEquity);
    if (currency === "ETH") {
      expect(ticket[6]).to.be.bignumber.eq(amount.add(oldTicket[6]));
    }
    if (currency === "EUR") {
      expect(ticket[7]).to.be.bignumber.eq(amount.add(oldTicket[7]));
    }
    // truffle will not decode events from other contract. we call payment token which calls eto commitment. so eto commitment events will not be decoded. do it explicitely
    const etoLogs = decodeLogs(tx, etoCommitment.address, etoCommitment.abi);
    tx.logs.push(...etoLogs);
    expectLogFundsCommitted(
      tx,
      investor,
      investor,
      token.address,
      amount,
      eurEquiv,
      expectedEquity,
      equityToken.address,
      expectedNeu,
    );
    return tx;
  }

  async function investICBMAmount(investor, amount, currency, expectedPrice) {
    // ticket verification
    const oldTicket = await etoCommitment.investorTicket(investor);
    // verify investor
    const claims = new web3.BigNumber(await identityRegistry.getClaims(investor), 16);
    let wallet;
    let eurEquiv;
    if (!claims.mod(2).eq(1)) {
      await identityRegistry.setClaims(investor, claims, toBytes32(web3.toHex(claims.add(1))), {
        from: admin,
      });
    }
    if (currency === "ETH") {
      // get current eth price
      const ethRate = await rateOracle.getExchangeRate(etherToken.address, euroToken.address);
      eurEquiv = divRound(ethRate[0].mul(amount), Q18);
      wallet = etherLockedAccount;
    } else if (currency === "EUR") {
      eurEquiv = amount;
      wallet = euroLockedAccount;
    }
    // icbm investor already got NEU
    const expectedNeu = new web3.BigNumber(0);
    // investor sends money via wallet
    const tx = await wallet.transfer(etoCommitment.address, amount, "", {
      from: investor,
    });
    // console.log(`investor ${investor} gasUsed ${tx.receipt.gasUsed}`);
    // validate investment
    const ticket = await etoCommitment.investorTicket(investor);
    // console.log(oldTicket);
    // console.log(ticket);
    expect(ticket[0]).to.be.bignumber.eq(eurEquiv.add(oldTicket[0]));
    expect(ticket[1]).to.be.bignumber.eq(expectedNeu.add(oldTicket[1]));
    // check only if expected token price was given
    let expectedEquity;
    if (expectedPrice) {
      expectedEquity = divRound(eurEquiv, expectedPrice);
    } else {
      expectedEquity = ticket[2].sub(oldTicket[2]);
    }
    expect(ticket[2].sub(oldTicket[2])).to.be.bignumber.eq(expectedEquity);
    if (currency === "ETH") {
      expect(ticket[6]).to.be.bignumber.eq(amount.add(oldTicket[6]));
    }
    if (currency === "EUR") {
      expect(ticket[7]).to.be.bignumber.eq(amount.add(oldTicket[7]));
    }
    // truffle will not decode events from other contract. we call payment token which calls eto commitment. so eto commitment events will not be decoded. do it explicitely
    tx.logs = decodeLogs(tx, etoCommitment.address, etoCommitment.abi);
    expectLogFundsCommitted(
      tx,
      investor,
      wallet.address,
      await wallet.paymentToken(),
      amount,
      eurEquiv,
      expectedEquity,
      equityToken.address,
      expectedNeu,
    );
    return tx;
  }

  async function expectValidSigningState(participatingInvestors) {
    const totalInvestment = await etoCommitment.totalInvestment();
    expect(totalInvestment[2]).to.be.bignumber.eq(5); // number of investors
    let expectedTokens = new web3.BigNumber(0);
    let expectedEurEquiv = new web3.BigNumber(0);
    let expectedInvestorNeu = new web3.BigNumber(0);
    let expectedAmountEth = new web3.BigNumber(0);
    let expectedAmountEur = new web3.BigNumber(0);
    let expectedShares = new web3.BigNumber(0);
    let expectedNewMoneyEurEquiv = new web3.BigNumber(0);
    for (const investor of participatingInvestors) {
      const ticket = await etoCommitment.investorTicket(investor);
      expectedTokens = expectedTokens.add(ticket[2]);
      expectedInvestorNeu = expectedInvestorNeu.add(ticket[1]);
      expectedEurEquiv = expectedEurEquiv.add(ticket[0]);
      expectedAmountEth = expectedAmountEth.add(ticket[6]);
      expectedAmountEur = expectedAmountEur.add(ticket[7]);
      expectedShares = expectedShares.add(ticket[5]);
      if (!ticket[9]) {
        expectedNewMoneyEurEquiv = expectedNewMoneyEurEquiv.add(ticket[0]);
      }
    }
    expect(expectedTokens).to.be.bignumber.eq(totalInvestment[1]);
    expect(expectedEurEquiv).to.be.bignumber.eq(totalInvestment[0]);
    // check NEU via taking expected amount directly from the curve
    // assumes that no one invested with icbm money and new money in single ticket
    const expectedComputedNeu = await neumark.incremental["uint256,uint256"](
      0,
      expectedNewMoneyEurEquiv,
    );
    expect(await neumark.balanceOf(etoCommitment.address)).to.be.bignumber.eq(expectedComputedNeu);
    // this simulates our rounding trick where less one wei is distributed to investor
    const investorShareNeu = expectedComputedNeu.sub(platformShare(expectedComputedNeu));
    expect(investorShareNeu).to.be.bignumber.gte(expectedInvestorNeu);
    // 8 below is number of investment transactions, each produces 1 wei decrease
    expect(investorShareNeu.sub(expectedInvestorNeu)).to.be.bignumber.lt(8);
    // check capital contributions going to investment agreement
    // equity token supply must contain 2% fee rounded to integer number of shares
    let expectedTokenSupply = expectedTokens.add(
      divRound(expectedTokens.mul(platformTermsDict.TOKEN_PARTICIPATION_FEE_FRACTION), Q18),
    );
    // to have equal number of shares add the remainder
    const tokenSharesRemainder = expectedTokenSupply.mod(platformTermsDict.EQUITY_TOKENS_PER_SHARE);
    if (!tokenSharesRemainder.eq(0)) {
      expectedTokenSupply = expectedTokenSupply.add(
        platformTermsDict.EQUITY_TOKENS_PER_SHARE.sub(tokenSharesRemainder),
      );
    }
    const expectedNewShares = expectedTokenSupply.div(platformTermsDict.EQUITY_TOKENS_PER_SHARE);
    expect(await equityToken.totalSupply()).to.be.bignumber.eq(expectedTokenSupply);
    const contribution = await etoCommitment.contributionSummary();
    expect(contribution[0]).to.be.bignumber.eq(expectedNewShares);
    expect(contribution[0]).to.be.bignumber.eq(expectedNewShares);
    // capital contribution is nominal value of the shares
    const nominalValueEur = expectedNewShares.mul(etoTermsDict.SHARE_NOMINAL_VALUE_EUR_ULPS);
    expect(contribution[1]).to.be.bignumber.eq(nominalValueEur);
    // same amount went to nominee
    expect(await euroToken.balanceOf(nominee)).to.be.bignumber.eq(nominalValueEur);
    // eth additional contribution is ethAmount on the token - 3% fee
    expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(expectedAmountEth);
    const ethFee = divRound(expectedAmountEth.mul(platformTermsDict.PLATFORM_FEE_FRACTION), Q18);
    expect(contribution[2]).to.be.bignumber.eq(expectedAmountEth.sub(ethFee));
    // euro tokens has always all euro
    let icbmEuroAmount = 0;
    if (euroLockedAccount) {
      icbmEuroAmount = await euroLockedAccount.totalLockedAmount();
    }
    expect((await euroToken.totalSupply()).sub(icbmEuroAmount)).to.be.bignumber.eq(
      expectedAmountEur,
    );
    const eurFee = divRound(expectedAmountEur.mul(platformTermsDict.PLATFORM_FEE_FRACTION), Q18);
    // eur additional contribution is eurAmount - fee - nominal value
    expect(contribution[3]).to.be.bignumber.eq(expectedAmountEur.sub(nominalValueEur).sub(eurFee));
    // token fee check
    expect(contribution[4]).to.be.bignumber.eq(expectedTokenSupply.sub(expectedTokens));
    // cash fees check
    expect(contribution[5]).to.be.bignumber.eq(ethFee);
    expect(contribution[6]).to.be.bignumber.eq(eurFee);
    // very important - effective share price to be used on investment agreement
    expect(contribution[7]).to.be.bignumber.eq(divRound(expectedEurEquiv, expectedNewShares));
    // push new money information into contribution
    contribution.push(expectedNewMoneyEurEquiv);

    return contribution;
  }

  async function expectValidClaimState(signedTx, contribution) {
    // verify on claim state, based on contribution that was already verified in signing
    // company got money
    expect(await etherToken.balanceOf(company)).to.be.bignumber.eq(contribution[2]);
    expectLogAdditionalContribution(signedTx, 0, company, etherToken.address, contribution[2]);
    expect(await euroToken.balanceOf(company)).to.be.bignumber.eq(contribution[3]);
    expectLogAdditionalContribution(signedTx, 1, company, euroToken.address, contribution[3]);
    // platform operator got their NEU (contribution[8] contains amount of new money created)
    const expectedComputedNeu = await neumark.incremental["uint256,uint256"](0, contribution[8]);
    expect(await neumark.balanceOf(platformWallet)).to.be.bignumber.eq(
      platformShare(expectedComputedNeu),
    );
    expectLogPlatformNeuReward(
      signedTx,
      platformWallet,
      await neumark.totalSupply(),
      platformShare(expectedComputedNeu),
    );
    // eto is successful
    expect(await etoCommitment.success()).to.be.true;
    expect(await etoCommitment.finalized()).to.be.true;
    expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Funded);
    const generalInformation = await equityTokenController.shareholderInformation();
    const newTotalShares = etoTermsDict.EXISTING_COMPANY_SHARES.add(contribution[0]);
    expect(generalInformation[0]).to.be.bignumber.eq(newTotalShares);
    expect(generalInformation[1]).to.be.bignumber.eq(
      newTotalShares.mul(tokenTermsDict.TOKEN_PRICE_EUR_ULPS),
    );
    expect(generalInformation[2]).to.eq(shareholderRights.address);
    const capTable = await equityTokenController.capTable();
    expect(capTable[0][0]).to.eq(equityToken.address);
    expect(capTable[1][0]).to.be.bignumber.eq(contribution[0]);
    expect(capTable[2][0]).to.eq(etoCommitment.address);
    expect(await equityToken.sharesTotalSupply()).to.be.bignumber.eq(contribution[0]);
    // all tokens still belong to eto smart contract
    expect(await equityToken.sharesBalanceOf(etoCommitment.address)).to.be.bignumber.eq(
      contribution[0],
    );
    // just fees left in the contract
    expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(contribution[5]);
    expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(contribution[6]);
  }

  function defaultDurationTable() {
    return [
      0,
      durTermsDict.WHITELIST_DURATION,
      durTermsDict.PUBLIC_DURATION,
      durTermsDict.SIGNING_DURATION,
      durTermsDict.CLAIM_DURATION,
      0,
      0,
    ];
  }

  async function expectValidRefundState(refundTx, participatingInvestors) {
    let expectedTokens = new web3.BigNumber(0);
    let expectedNewMoneyEurEquiv = new web3.BigNumber(0);
    for (const investor of participatingInvestors) {
      const ticket = await etoCommitment.investorTicket(investor);
      expectedTokens = expectedTokens.add(ticket[2]);
      if (!ticket[9]) {
        expectedNewMoneyEurEquiv = expectedNewMoneyEurEquiv.add(ticket[0]);
      }
    }
    // assumes that no one invested with icbm money and new money in single ticket
    const expectedComputedNeu = await neumark.incremental["uint256,uint256"](
      0,
      expectedNewMoneyEurEquiv,
    );
    expectLogRefundStarted(refundTx, equityToken.address, expectedTokens, expectedComputedNeu);
    // all NEU burned
    expect(await neumark.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
    // all equity token burned
    expect(await equityToken.totalSupply()).to.be.bignumber.eq(0);
    // equity token controller back in setup state
    expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Setup);
    // empty cap table
    await expectEmptyTokenController();
  }

  async function expectValidPayoutState(tx, contribution) {
    // contribution was validated previously and may be used as a reference
    const disbursal = await universe.feeDisbursal();
    const platformPortfolio = await universe.platformPortfolio();
    expectLogPlatformFeePayout(tx, 0, etherToken.address, disbursal, contribution[5]);
    expectLogPlatformFeePayout(tx, 1, euroToken.address, disbursal, contribution[6]);
    expectLogPlatformPortfolioPayout(tx, equityToken.address, platformPortfolio, contribution[4]);
    // fee disbursal must have fees
    expect(await etherToken.balanceOf(disbursal)).to.be.bignumber.eq(contribution[5]);
    expect(await euroToken.balanceOf(disbursal)).to.be.bignumber.eq(contribution[6]);
    // platform portfolio must have tokens
    expect(await equityToken.balanceOf(platformPortfolio)).to.be.bignumber.eq(contribution[4]);
    // eto commitment must have no funds
    expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
    expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
  }

  async function expectValidPayoutStateFullClaim() {
    // eto commitment must have no equity tokens
    expect(await equityToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
    // just remainder of NEU
    expect((await neumark.balanceOf(etoCommitment.address)).sub(8).abs()).to.be.bignumber.lt(10);
  }

  async function claimInvestor(investor) {
    const tx = await etoCommitment.claim({ from: investor });
    await expectValidInvestorClaim(tx, investor);
  }

  async function claimMultipleInvestors(investorsAddresses) {
    const tx = await etoCommitment.claimMany(investorsAddresses);
    let logIdx = 0;
    for (const investor of investorsAddresses) {
      await expectValidInvestorClaim(tx, investor, logIdx);
      logIdx += 1;
    }
  }

  async function refundInvestor(investor) {
    const tx = await etoCommitment.refund({ from: investor });
    await expectValidInvestorRefund(tx, investor, 0);
  }

  async function refundMultipleInvestors(investorsAddresses) {
    const tx = await etoCommitment.refundMany(investorsAddresses);
    let idx = 0;
    for (const investor of investorsAddresses) {
      await expectValidInvestorRefund(tx, investor, idx);
      idx += 1;
    }
  }

  async function expectEmptyTokenController() {
    const capTable = await equityTokenController.capTable();
    expect(capTable[0].length).to.eq(0);
    expect(capTable[1].length).to.eq(0);
    expect(capTable[2].length).to.eq(0);
    const generalInfo = await equityTokenController.shareholderInformation();
    expect(generalInfo[0]).to.be.bignumber.eq(0);
    expect(generalInfo[1]).to.be.bignumber.eq(0);
    expect(generalInfo[2]).to.eq(ZERO_ADDRESS);
  }

  async function expectStateStarts(pastStatesTable, durationTable) {
    const durTable = durationTable.slice();
    // add initial 0 to align with internal algorithm which looks to state - 1 to give start of current
    durTable.unshift(0);
    let expectedDate = new web3.BigNumber(0);
    for (const state of Object.keys(CommitmentState)) {
      // be more precise and reproduce internal timestamp algo by adding eto terms
      if (state in pastStatesTable) {
        expectedDate = pastStatesTable[state];
      } else {
        expectedDate = expectedDate.add(durTable[CommitmentState[state]]);
      }
      // console.log(`${state}:${expectedDate}:${new Date(expectedDate * 1000)}`);
      expect(await etoCommitment.startOf(CommitmentState[state])).to.be.bignumber.eq(expectedDate);
    }
  }

  function expectLogRefundStarted(tx, equityTokenAddress, burnedTokens, burnedNeu) {
    const event = eventValue(tx, "LogRefundStarted");
    expect(event).to.exist;
    expect(event.args.assetToken).to.eq(equityTokenAddress);
    expect(event.args.totalTokenAmountInt).to.be.bignumber.eq(burnedTokens);
    expect(event.args.totalRewardNmkUlps).to.be.bignumber.eq(burnedNeu);
  }

  function expectLogTermsSet(tx, companyAddr, etoTermsAddr, equityTokenAddr) {
    const event = eventValue(tx, "LogTermsSet");
    expect(event).to.exist;
    expect(event.args.companyLegalRep).to.eq(companyAddr);
    expect(event.args.etoTerms).to.eq(etoTermsAddr);
    expect(event.args.equityToken).to.eq(equityTokenAddr);
  }

  function expectLogETOStartDateSet(tx, companyAddr, startAt, startDate) {
    const event = eventValue(tx, "LogETOStartDateSet");
    expect(event).to.exist;
    expect(event.args.companyLegalRep).to.eq(companyAddr);
    expect(event.args.previousTimestamp).to.be.bignumber.eq(startAt);
    expect(event.args.newTimestamp).to.be.bignumber.eq(startDate);
  }

  async function skipTimeTo(timestamp) {
    await setTimeTo(timestamp);
    // always provide price feed after time shift
    await gasExchange.setExchangeRate(etherToken.address, euroToken.address, Q18.mul(defEthPrice), {
      from: admin,
    });
  }

  function discountedPrice(price, discount) {
    return divRound(price.mul(Q18.sub(discount)), Q18);
  }

  function expectLogStateTransition(tx, oldState, newState, ts) {
    const event = eventValue(tx, "LogStateTransition");
    expect(event).to.exist;
    expect(event.args.oldState).to.be.bignumber.eq(oldState);
    expect(event.args.newState).to.be.bignumber.eq(newState);
    expect(event.args.timestamp).to.be.bignumber.eq(ts);
  }

  function expectLogSigningStarted(tx, nomineeAddr, companyAddr, newShares, nominalValue) {
    const event = eventValue(tx, "LogSigningStarted");
    expect(event).to.exist;
    expect(event.args.nominee).to.eq(nomineeAddr);
    expect(event.args.companyLegalRep).to.eq(companyAddr);
    expect(event.args.newShares).to.be.bignumber.eq(newShares);
    expect(event.args.capitalIncreaseEurUlps).to.be.bignumber.eq(nominalValue);
  }

  function expectLogCompanySignedAgreement(tx, companyAddr, nomineeAddr, investmentAgreementUrl) {
    const event = eventValue(tx, "LogCompanySignedAgreement");
    expect(event).to.exist;
    expect(event.args.nominee).to.eq(nomineeAddr);
    expect(event.args.companyLegalRep).to.eq(companyAddr);
    expect(event.args.signedInvestmentAgreementUrl).to.eq(investmentAgreementUrl);
  }

  function expectLogNomineeConfirmedAgreement(
    tx,
    nomineeAddr,
    companyAddr,
    investmentAgreementUrl,
  ) {
    const event = eventValue(tx, "LogNomineeConfirmedAgreement");
    expect(event).to.exist;
    expect(event.args.nominee).to.eq(nomineeAddr);
    expect(event.args.companyLegalRep).to.eq(companyAddr);
    expect(event.args.signedInvestmentAgreementUrl).to.eq(investmentAgreementUrl);
  }

  function expectLogAdditionalContribution(
    tx,
    logIdx,
    companyAddress,
    paymentTokenAddress,
    amount,
  ) {
    const event = eventWithIdxValue(tx, logIdx, "LogAdditionalContribution");
    expect(event).to.exist;
    expect(event.args.companyLegalRep).to.eq(companyAddress);
    expect(event.args.paymentToken).to.eq(paymentTokenAddress);
    expect(event.args.amount).to.be.bignumber.eq(amount);
  }

  function expectLogPlatformNeuReward(tx, platformWalletAddress, totalReward, platformReward) {
    const event = eventValue(tx, "LogPlatformNeuReward");
    expect(event).to.exist;
    expect(event.args.platformWallet).to.eq(platformWalletAddress);
    expect(event.args.totalRewardNmkUlps).to.be.bignumber.eq(totalReward);
    expect(event.args.platformRewardNmkUlps).to.be.bignumber.eq(platformReward);
  }

  function expectLogTokensClaimed(tx, logIdx, investor, equityAmount, neuReward) {
    const event = eventWithIdxValue(tx, logIdx, "LogTokensClaimed");
    expect(event).to.exist;
    expect(event.args.investor).to.eq(investor);
    expect(event.args.assetToken).to.eq(equityToken.address);
    expect(event.args.amount).to.be.bignumber.eq(equityAmount);
    expect(event.args.nmkReward).to.be.bignumber.eq(neuReward);
  }

  function expectLogFundsRefunded(tx, logIdx, investor, tokenAddress, amount) {
    const event = eventWithIdxValue(tx, logIdx, "LogFundsRefunded");
    expect(event).to.exist;
    expect(event.args.investor).to.eq(investor);
    expect(event.args.paymentToken).to.eq(tokenAddress);
    expect(event.args.amount).to.be.bignumber.eq(amount);
  }

  function expectLogPlatformFeePayout(tx, logIdx, paymentTokenAddress, disbursal, feeAmount) {
    const event = eventWithIdxValue(tx, logIdx, "LogPlatformFeePayout");
    expect(event).to.exist;
    expect(event.args.disbursalPool).to.eq(disbursal);
    expect(event.args.paymentToken).to.eq(paymentTokenAddress);
    expect(event.args.amount).to.be.bignumber.eq(feeAmount);
  }

  function expectLogPlatformPortfolioPayout(tx, assetTokenAddress, platformPortfolio, feeAmount) {
    const event = eventValue(tx, "LogPlatformPortfolioPayout");
    expect(event).to.exist;
    expect(event.args.platformPortfolio).to.eq(platformPortfolio);
    expect(event.args.assetToken).to.eq(assetTokenAddress);
    expect(event.args.amount).to.be.bignumber.eq(feeAmount);
  }
});
