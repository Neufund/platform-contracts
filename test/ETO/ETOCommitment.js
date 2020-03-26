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
  deployFeeDisbursalUniverse,
  defaultPlatformTerms,
} from "../helpers/deployContracts";
import {
  deployShareholderRights,
  deployDurationTerms,
  deployETOTerms,
  deployTokenTerms,
  deployETOTermsConstraints,
  defTokenTerms,
} from "../helpers/deployTerms";
import { CommitmentState } from "../helpers/commitmentState";
import { GovState, getCommitmentResolutionId } from "../helpers/govState";
import { knownInterfaces } from "../helpers/knownInterfaces";
import { eventValue, decodeLogs, eventWithIdxValue, hasEvent } from "../helpers/events";
import increaseTime, { setTimeTo } from "../helpers/increaseTime";
import { latestTimestamp } from "../helpers/latestTime";
import roles from "../helpers/roles";
import createAccessPolicy from "../helpers/createAccessPolicy";
import { TriState } from "../helpers/triState";
import { deserializeClaims } from "../helpers/identityClaims";
import {
  ZERO_ADDRESS,
  decimalBase,
  Q18,
  dayInSeconds,
  toBytes32,
  contractId,
  monthInSeconds,
  web3,
  defEquityTokenPower,
  defEquityTokenDecimals,
} from "../helpers/constants";
import { expectLogFundsCommitted } from "../helpers/commitment";
import EvmError from "../helpers/EVMThrow";

const ETOTermsConstraints = artifacts.require("ETOTermsConstraints");
const EquityToken = artifacts.require("EquityToken");
const SingleEquityTokenController = artifacts.require("SingleEquityTokenController");
const ETOCommitment = artifacts.require("ETOCommitment");
const MockETOCommitment = artifacts.require("MockETOCommitment");
const ETOTerms = artifacts.require("ETOTerms");
const ETOTokenTerms = artifacts.require("MockUncheckedETOTokenTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ShareholderRights = artifacts.require("ShareholderRights");
const TestFeeDistributionPool = artifacts.require("TestFeeDistributionPool");

// in a few places we use linear approximations and we require high precision
// all other big numbers are integers
web3.BigNumber.config({ DECIMAL_PLACES: 100 });

const PLATFORM_SHARE = web3.toBigNumber("2");
const minDepositAmountEurUlps = Q18.mul(50);
const minWithdrawAmountEurUlps = Q18.mul(20);
const maxSimpleExchangeAllowanceEurUlps = Q18.mul(50);
const platformWallet = "0x00447f37bde6c89ad47c1d1e16025e707d3d363a";
const defEthPrice = web3.toBigNumber("657.39278932");
const UNKNOWN_STATE_START_TS = 10000000; // state startOf timeestamps invalid below this
const platformShare = nmk => nmk.div(PLATFORM_SHARE).round(0, 1); // round down
const investorShare = nmk => nmk.sub(platformShare(nmk));
const manyTokens = new web3.BigNumber(2)
  .pow(32)
  .mul(defEquityTokenPower)
  .sub(1);
const inverseTokenFeeDec = defaultPlatformTerms.TOKEN_PARTICIPATION_FEE_FRACTION.div(Q18).add("1");
const two = new web3.BigNumber(2);
const one = new web3.BigNumber(1);
const zero = new web3.BigNumber(0);

contract("ETOCommitment", ([, admin, company, nominee, ...investors]) => {
  // basic infrastructure
  let universe;
  let identityRegistry;
  let accessPolicy;
  let testDisbursal;
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
  let etoTermsConstraints;
  // let etoTermsConstraintsDict;
  let shareholderRights;
  // let shareholderTermsDict;
  let durationTerms;
  let durTermsDict;
  // eto contracts
  let equityTokenController;
  let equityToken;
  let etoCommitment;
  // locked account
  let euroLockedAccount;
  let etherLockedAccount;
  let icbmEuroLockedAccount;
  let icbmEtherLockedAccount;
  let icbmEuroToken;
  let icbmEtherToken;
  let icbmEuroController;
  let icbmEtherController;
  // running eto stub
  let startDate;
  let durTable;
  let publicStartDate;
  // save addess of tokenOfferingOperator
  let tokenOfferingOperator;

  beforeEach(async () => {
    // deploy access policy and universe contract, admin account has all permissions of the platform
    [universe, accessPolicy] = await deployUniverse(admin, admin);
    // note that all deploy... functions also set up permissions and set singletons in universe
    identityRegistry = await deployIdentityRegistry(universe, admin, admin);
    // deploy test fee disbursal
    testDisbursal = await TestFeeDistributionPool.new();
    await universe.setSingleton(knownInterfaces.feeDisbursal, testDisbursal.address, {
      from: admin,
    });
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
    // reset locked account
    euroLockedAccount = undefined;
    etherLockedAccount = undefined;
    icbmEuroLockedAccount = undefined;
    icbmEtherLockedAccount = undefined;
    icbmEuroToken = undefined;
    icbmEtherToken = undefined;
    icbmEuroController = undefined;
    icbmEtherController = undefined;
  });

  describe("setup tests", () => {
    beforeEach(async () => {
      await deployETO();
    });

    it("should deploy", async () => {
      await prettyPrintGasCost("ETOCommitment deploy", etoCommitment);
      await prettyPrintGasCost("SingleEquityTokenController deploy", equityTokenController);
      // check getters
      expect(await etoCommitment.etoTerms()).to.eq(etoTerms.address);
      expect(await etoCommitment.equityToken()).to.eq(ZERO_ADDRESS);
      expect(await etoCommitment.nominee()).to.eq(nominee);
      expect(await etoCommitment.companyLegalRep()).to.eq(company);
      const singletons = await etoCommitment.singletons();

      expect(singletons[0]).to.eq(tokenOfferingOperator);
      expect(singletons[1]).to.eq(universe.address);
      expect(singletons[2]).to.eq(platformTerms.address);

      // check state machine
      expect(await etoCommitment.state()).to.be.bignumber.eq(0);
      expect(await etoCommitment.commitmentObserver()).to.eq(ZERO_ADDRESS);
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

      const cid = await etoCommitment.contractId();
      expect(cid[0]).to.eq(contractId("ETOCommitment"));
      expect(cid[1]).to.be.bignumber.eq(4);
    });

    it("should set start date", async () => {
      // company confirms terms and sets start date
      startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
      startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
      const tx = await etoCommitment.setStartDate(
        etoTerms.address,
        equityToken.address,
        startDate,
        {
          from: company,
        },
      );
      // equity token and controller are now set
      expect(await etoCommitment.equityToken()).to.eq(equityToken.address);
      expect(await etoCommitment.commitmentObserver()).to.eq(equityTokenController.address);
      // events are generated
      expectLogTermsSet(tx, company, etoTerms.address, equityToken.address);
      expectLogETOStartDateSet(tx, company, 0, startDate);
      // timed state machine works now and we can read out expected starts of states
      await expectStateStarts({ Whitelist: startDate, Refund: 0 }, defaultDurationTable());
      // ready to go
      await expectProperETOSetup(etoCommitment.address);
    });

    it("should reset start date", async () => {
      // company confirms terms and sets start date
      startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
      startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
      await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
        from: company,
      });
      // timed state machine works now and we can read out expected starts of states
      await expectStateStarts({ Whitelist: startDate, Refund: 0 }, defaultDurationTable());

      let newStartDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds * 2);
      newStartDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
      await etoCommitment.setStartDate(etoTerms.address, equityToken.address, newStartDate, {
        from: company,
      });
      // timed state machine works now and we can read out expected starts of states
      await expectStateStarts({ Whitelist: newStartDate, Refund: 0 }, defaultDurationTable());
    });

    it("rejects setting initial start date closer than DATE_TO_WHITELIST_MIN_DURATION to now", async () => {
      // set exactly DATE_TO_WHITELIST_MIN_DURATION - 1 second
      startDate = new web3.BigNumber((await latestTimestamp()) - 1);
      startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
      await expect(
        etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: company,
        }),
      ).to.be.rejectedWith("NF_ETO_DATE_TOO_EARLY");
    });

    it("rejects re-setting start date if now is less than DATE_TO_WHITELIST_MIN_DURATION to previous start date", async () => {
      startDate = new web3.BigNumber(await latestTimestamp()).add(3);
      startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
      await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
        from: company,
      });
      await increaseTime(5);
      // now we are already too close to previously set date, dany change
      await expect(
        etoCommitment.setStartDate(
          etoTerms.address,
          equityToken.address,
          startDate.add(dayInSeconds),
          {
            from: company,
          },
        ),
      ).to.be.rejectedWith("NF_ETO_START_TOO_SOON");
    });

    it("rejects setting date not from company", async () => {
      // company confirms terms and sets start date
      startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
      startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
      await expect(
        etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: investors[0],
        }),
      ).to.revert;
    });

    it("rejects setting date before block.timestamp", async () => {
      startDate = new web3.BigNumber(await latestTimestamp()).add(3);
      startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION()).add(1);
      await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
        from: company,
      });
      // trying to wait for block >= startDate (to overflow) will induce state transition
      await setTimeTo(startDate);
      expect(await etoCommitment.timedState()).to.be.bignumber.eq(CommitmentState.Whitelist);
    });

    it("rejects setting agreement not from Nominee", async () => {
      await etoCommitment.amendAgreement("ABBA", { from: nominee });
      await expect(etoCommitment.amendAgreement("ABBA", { from: company })).to.be.rejectedWith(
        EvmError,
      );
    });

    it("rejects setting agreement by nominee when start date is set", async () => {
      await etoCommitment.amendAgreement("ABBA", { from: nominee });
      startDate = new web3.BigNumber(await latestTimestamp()).add(3);
      startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
      await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
        from: company,
      });
      await expect(etoCommitment.amendAgreement("ABBA", { from: nominee })).to.be.revert;
    });
  });

  describe("MockETOCommitment tests", () => {
    it("should mock time", async () => {
      await deployETO({ ovrArtifact: MockETOCommitment });
      await prettyPrintGasCost("MockETOCommitment deploy", etoCommitment);
      const timestamp = await latestTimestamp();
      durTable = defaultDurationTable();
      startDate = new web3.BigNumber(timestamp - 3 * dayInSeconds);
      const whitelistD = durTable[CommitmentState.Whitelist].add(1);
      // set start data to the past via mocker
      const startTx = await etoCommitment._mockStartDate(
        etoTerms.address,
        equityToken.address,
        startDate,
        startDate.add(whitelistD),
        { from: company },
      );
      expectLogETOStartDateSet(startTx, company, 0, startDate.add(whitelistD));
      const tx = await etoCommitment.handleStateTransitions();
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, startDate);
      // we should have correct state times
      const publicStartOf = startDate.add(durTable[CommitmentState.Whitelist]);
      await expectStateStarts({ Whitelist: startDate, Public: publicStartOf, Refund: 0 }, durTable);
      // mock public state directly
      const newPublicTs = publicStartOf.add(1000);
      await etoCommitment._mockPastTime(1, newPublicTs);
      await expectStateStarts({ Whitelist: startDate, Public: newPublicTs, Refund: 0 }, durTable);
      await etoCommitment._mockPastTime(1, publicStartOf);
      // rollback past so should transition to public
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

    it("should move time to right before state transition", async () => {
      await deployETO({ ovrArtifact: MockETOCommitment });
      const timestamp = await latestTimestamp();
      durTable = defaultDurationTable();
      startDate = new web3.BigNumber(timestamp + 2 * dayInSeconds);
      // set start data to 2 days from now via mocker
      let startTx = await etoCommitment._mockStartDate(
        etoTerms.address,
        equityToken.address,
        startDate,
        startDate,
        { from: company },
      );
      expectLogETOStartDateSet(startTx, company, 0, startDate);

      // move to right before startDate via mocker
      startTx = await etoCommitment._shiftToBeforeNextState(10, { from: company });
      expectLogETOStartDateSet(startTx, company, startDate, startDate.sub(10));

      await increaseTime(15);
      const tx = await etoCommitment.handleStateTransitions();
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore");

      // do so again for whitelist->public transition
      const nextTx = await etoCommitment._shiftToBeforeNextState(10);
      expect(hasEvent(nextTx, "LogETOStartDateSet")).to.be.false;
      await increaseTime(15);
      const tx2 = await etoCommitment.handleStateTransitions();
      expectLogStateTransition(tx2, CommitmentState.Whitelist, CommitmentState.Public, "ignore");
    });
  });

  describe("special investment cases", () => {
    const maxTicket = Q18.mul(25000000);

    async function deployEtoWithTicket(termsOverride) {
      // with large maximum ticket
      await deployETO(termsOverride);
      await prepareETOForPublic();
    }

    beforeEach(async () => {
      await deployEtoWithTicket({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: maxTicket } });
    });

    it("with changing ether price during ETO", async () => {
      await skipTimeTo(publicStartDate.add(1));
      // set some round ETH price to minimize rounding errors in the contract
      await gasExchange.setExchangeRate(etherToken.address, euroToken.address, Q18, {
        from: admin,
      });
      const tokenprice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
      const ticketEth = Q18.mul("1070.61721").add(1);
      await investAmount(investors[1], ticketEth, "ETH", tokenprice);
      // set double ETH price
      const newPrice = Q18.mul(2);
      await gasExchange.setExchangeRate(etherToken.address, euroToken.address, newPrice, {
        from: admin,
      });
      await investAmount(investors[2], ticketEth, "ETH", tokenprice);
      // verify that the amount of ETH tokens from ticket1 at doubled ETH-price buys almost
      // twice amount of equityToken (slightly less because of rounding)
      const i1ticket = await etoCommitment.investorTicket(investors[1]);
      const i2ticket = await etoCommitment.investorTicket(investors[2]);
      // but it does not mean that previous ticket amount is doubled due to rounding once, not twice
      expect(
        i1ticket[2]
          .mul(2)
          .sub(i2ticket[2])
          .abs(),
      ).to.be.bignumber.lt(2);
      // this works because we set 1 eth == 2 eur so ticketEth.mul(2) is in fact currency conversion to EUR
      // on which amount of token is calculated
      const tokensI2 = ticketEth
        .mul(2)
        .mul(getTokenPower())
        .divToInt(tokenprice);
      expect(i2ticket[2]).to.be.bignumber.eq(tokensI2);
    });

    it("reject if ETH price feed outdated", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const tokenprice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
      const ticket = Q18.mul(107.61721).add(1);
      await increaseTime(platformTermsDict.TOKEN_RATE_EXPIRES_AFTER);
      await expect(investAmount(investors[1], ticket, "ETH", tokenprice)).to.be.rejectedWith(
        "NF_ETO_INVALID_ETH_RATE",
      );
    });

    it("reject if investment from unknown payment token", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const TestSnapshotToken = artifacts.require("TestSnapshotToken");
      const testSnapshotToken = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
      await testSnapshotToken.deposit(Q18, { from: investors[1] });
      await expect(
        testSnapshotToken.transfer["address,uint256,bytes"](etoCommitment.address, Q18, "", {
          from: investors[1],
        }),
      ).to.be.rejectedWith("NF_ETO_UNK_TOKEN");
    });

    // specific cases
    it("unverified investor cannot invest", async () => {
      await skipTimeTo(publicStartDate.add(1));
      await etherToken.deposit({ from: investors[1], value: Q18 });
      await expect(
        etherToken.transfer["address,uint256,bytes"](etoCommitment.address, Q18, "", {
          from: investors[1],
        }),
      ).to.be.rejectedWith("NF_ETO_INV_NOT_ELIGIBLE");
      const ticket = Q18.mul(107.61721).add(1);
      await identityRegistry.setClaims(investors[1], toBytes32("0x0"), toBytes32("0x1"), {
        from: admin,
      });
      // to check euro token case we must use locked account, in direct case transfer is denied
      // by euro token
      await deployLockedAccounts();
      await createLockedAccounts(investors.slice(1, 2));
      await identityRegistry.setClaims(investors[1], toBytes32("0x1"), toBytes32("0x0"), {
        from: admin,
      });
      await expect(
        euroLockedAccount.transfer["address,uint256,bytes"](etoCommitment.address, ticket, "", {
          from: investors[1],
        }),
      ).to.be.rejectedWith("NF_ETO_INV_NOT_ELIGIBLE");
    });

    it("frozen investor cannot invest", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const tokenprice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
      const ticket = Q18.mul(107.61721).add(1);
      await investAmount(investors[1], ticket, "ETH", tokenprice);
      await identityRegistry.setClaims(investors[1], toBytes32("0x1"), toBytes32("0x9"), {
        from: admin,
      });
      await etherToken.deposit({ from: investors[1], value: Q18 });
      await expect(
        etherToken.transfer["address,uint256,bytes"](etoCommitment.address, Q18, "", {
          from: investors[1],
        }),
      ).to.be.rejectedWith("NF_ETO_INV_NOT_ELIGIBLE");
    });

    it("reg d investor cannot invest", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const tokenprice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
      const ticket = Q18.mul(107.61721).add(1);
      await investAmount(investors[1], ticket, "ETH", tokenprice);
      // 0x31 is regd with valid accreditation
      await identityRegistry.setClaims(investors[1], toBytes32("0x1"), toBytes32("0x31"), {
        from: admin,
      });
      await etherToken.deposit({ from: investors[1], value: Q18 });
      await expect(
        etherToken.transfer["address,uint256,bytes"](etoCommitment.address, Q18, "", {
          from: investors[1],
        }),
      ).to.be.rejectedWith("NF_ETO_INV_NOT_ELIGIBLE");
    });

    it("rejects on investment below min ticket", async () => {
      await skipTimeTo(publicStartDate.add(1));
      await expect(
        investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS.sub(1), "EUR"),
      ).to.be.rejectedWith("NF_ETO_MIN_TICKET");
    });

    it("should invest below min ticket if already invested min ticket", async () => {
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR");
      // at least one token can be bought
      await investAmount(investors[0], tokenTermsDict.TOKEN_PRICE_EUR_ULPS, "EUR");
      // cannot invest less than token price
      await expect(
        investAmount(investors[0], tokenTermsDict.TOKEN_PRICE_EUR_ULPS.sub(1), "EUR"),
      ).to.be.rejectedWith("NF_ETO_MIN_TICKET");
      await expect(investAmount(investors[0], zero, "ETH")).to.be.rejectedWith("NF_ETO_MIN_TICKET");
    });

    it("rejects investment above max ticket", async () => {
      await deployEtoWithTicket({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(100000) } });
      await skipTimeTo(publicStartDate.add(1));
      await expect(investAmount(investors[0], Q18.mul(100000).add(1), "EUR")).to.be.rejectedWith(
        "NF_ETO_MAX_TICKET",
      );
    });

    it("interprets MAX_TICKET_EUR_ULPS == 0 as unlimited", async () => {
      // larger than in default terms
      const ticket = Q18.mul(5000001);
      await deployEtoWithTicket({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(ticket) },
        ovrETOTermsConstraints: { MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0) },
      });
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[0], ticket, "EUR");
    });

    it("rejects investment above max ticket if already invested max ticket", async () => {
      await deployEtoWithTicket({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(100000) } });
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[0], Q18.mul(100000), "EUR");
      await expect(
        investAmount(investors[0], tokenTermsDict.TOKEN_PRICE_EUR_ULPS, "EUR"),
      ).to.be.rejectedWith("NF_ETO_MAX_TICKET");
    });

    it("rejects investment in whitelist when not whitelisted", async () => {
      await expect(investAmount(investors[0], Q18.mul(762.121).add(1), "ETH")).to.be.rejectedWith(
        "NF_ETO_NOT_ON_WL",
      );
    });

    it("cannot invest when ETO not in Universe", async () => {
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[0], Q18.mul(10000), "EUR");
      // drop working ETO from universe
      await universe.setCollectionsInterfaces(
        [knownInterfaces.commitmentInterface],
        [etoCommitment.address],
        [false],
        { from: admin },
      );
      await expect(investAmount(investors[0], Q18.mul(10000), "EUR")).to.revert;
    });

    it("cannot invest when ETO cannot issue NEU", async () => {
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[0], Q18.mul(10000), "EUR");
      // drop NEU permission from working ETO
      await createAccessPolicy(accessPolicy, [
        {
          role: roles.neumarkIssuer,
          object: neumark.address,
          subject: etoCommitment.address,
          state: TriState.Deny,
        },
      ]);
      await expect(investAmount(investors[0], Q18.mul(10000), "EUR")).to.revert;
    });

    it("not enough EUR to send nominal value to Nominee", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const totalInvestment = await etoCommitment.totalInvestment();
      await investAmount(investors[4], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR");
      // we must cross MIN CAP
      if (tokenTermsDict.MIN_NUMBER_OF_TOKENS.gt(totalInvestment[1])) {
        const missingTokens = tokenTermsDict.MIN_NUMBER_OF_TOKENS.sub(totalInvestment[1]);
        let missingAmount = tokensCostEur(missingTokens, tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
        if (missingAmount.lt(etoTermsDict.MIN_TICKET_EUR_ULPS)) {
          missingAmount = etoTermsDict.MIN_TICKET_EUR_ULPS;
        }
        // console.log(`min cap investment: ${missingTokens} ${missingAmount.div(Q18).toNumber()} EUR`);
        await investAmount(investors[4], missingAmount.div(defEthPrice).round(), "ETH");
      }
      // go to signing
      const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
      await skipTimeTo(signingStartOf.add(1));
      const investmentAgreementUrl = "ipfs:3290890ABINVESTMENT";
      await etoCommitment.companySignsInvestmentAgreement(investmentAgreementUrl, {
        from: company,
      });
      const contribution = await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
      // nominee signs
      const nomineeSignTx = await etoCommitment.nomineeConfirmsInvestmentAgreement(
        investmentAgreementUrl,
        { from: nominee },
      );
      // this is also state transition into claim
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Claim);
      await expectValidClaimState(nomineeSignTx, contribution);
    });

    it("go from public to signing by reaching max cap exactly (max tokens)", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      await investAmount(investors[4], missingAmount, "EUR");
      // we should be signing NOW
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      // exactly max number of tokens sold
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      const contribution = await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
      const nomineeSignTx = await signInvestmentAgreement();
      await expectValidClaimState(nomineeSignTx, contribution);
    });

    it("go from public to signing by reaching max cap exactly (max investment amount)", async () => {
      const maxInvestAmount = Q18.mul(5000000);
      await deployEtoWithTicket({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: maxInvestAmount },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS: maxInvestAmount }, // max invest is 5mio
        ovrTokenTerms: { MAX_NUMBER_OF_TOKENS: manyTokens }, // we allow many tokens, so there is no max cap triggered there
      });
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[4], maxInvestAmount, "EUR");
      // we should be signing NOW
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
    });

    it("go from public to signing by reaching max cap within minimum ticket (max tokens)", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      // MIN_TICKET is not exactly divisible by price (typically), there is a remainder which produces gap as below
      const gap = minTicketTokenGapAmount();
      // this gap makes us crossing max cap, see below test
      await investAmount(investors[4], missingAmount.sub(gap), "EUR");
      // we should be signing NOW
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
    });

    it("go from public to signing by reaching max cap within minimum ticket (max investment amount)", async () => {
      const minTicket = Q18.mul(200);
      const maxInvestAmount = Q18.mul(5000000);
      await deployEtoWithTicket({
        ovrETOTerms: { MIN_TICKET_EUR_ULPS: minTicket, MAX_TICKET_EUR_ULPS: maxInvestAmount },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS: maxInvestAmount }, // max invest is 5mio
        ovrTokenTerms: { MAX_NUMBER_OF_TOKENS: manyTokens }, // we allow many tokens, so there is no max cap triggered there
      });
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[4], maxInvestAmount.sub(minTicket).add(1), "EUR");
      // we should be signing NOW
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
    });

    it("stay in public by not reaching max cap because less than gap (max tokens)", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      const gap = minTicketTokenGapAmount();
      // see above test for gap explanation
      await investAmount(
        investors[4],
        missingAmount.sub(gap).sub(tokenTermsDict.TOKEN_PRICE_EUR_ULPS),
        "EUR",
      );
      // still in public
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
    });

    it("stay in public by not reaching max cap because less than gap (max investment amount)", async () => {
      const minTicket = Q18.mul(200);
      const maxInvestAmount = Q18.mul(5000000);
      await deployEtoWithTicket({
        ovrETOTerms: { MIN_TICKET_EUR_ULPS: minTicket, MAX_TICKET_EUR_ULPS: maxInvestAmount },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS: maxInvestAmount }, // max invest is 5mio
        ovrTokenTerms: { MAX_NUMBER_OF_TOKENS: manyTokens }, // we allow many tokens, so there is no max cap triggered there
      });
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[4], maxInvestAmount.sub(minTicket), "EUR");
      // we should be public NOW
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
    });

    it("reverts on crossing max cap (max tokens)", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      await expect(
        investAmount(investors[4], missingAmount.add(tokenTermsDict.TOKEN_PRICE_EUR_ULPS), "EUR"),
      ).to.be.rejectedWith("NF_ETO_MAX_TOK_CAP");
    });

    it("reverts on crossing max cap (max investment amount)", async () => {
      const maxInvestAmount = Q18.mul(5000000);
      await deployEtoWithTicket({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: maxInvestAmount.mul(2) },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS: maxInvestAmount }, // max invest is 5mio
        ovrTokenTerms: { MAX_NUMBER_OF_TOKENS: manyTokens }, // we allow many tokens, so there is no max cap triggered there
      });
      await skipTimeTo(publicStartDate.add(1));
      await expect(investAmount(investors[4], maxInvestAmount.add(1), "EUR")).to.be.rejectedWith(
        "NF_ETO_MAX_TOK_CAP",
      );
    });

    it("interprets MAX_INVESTMENT_AMOUNT_EUR_ULPS == 0 as unlimited", async () => {
      const investmentAmount = Q18.mul(5000001);
      await deployEtoWithTicket({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: investmentAmount },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0) }, // max invest is unlimited
        ovrTokenTerms: { MAX_NUMBER_OF_TOKENS: manyTokens }, // we allow many tokens, so there is no max cap triggered there
      });
      await skipTimeTo(publicStartDate.add(1));
      await investAmount(investors[4], investmentAmount, "EUR");
    });

    it("go from whitelist to signing by reaching max cap", async () => {
      // allow to cross max cap from whitelist (fixed-slot)
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(15000000)], [Q18.mul(1)], {
        from: admin,
      });
      const missingAmount = allTokensCostEur();
      const tx = await investAmount(investors[0], missingAmount, "EUR");
      // we need to ignore timestamp due to ganache bug (https://github.com/trufflesuite/ganache-core/issues/111)
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore", 0);
      expectLogStateTransition(tx, CommitmentState.Whitelist, CommitmentState.Public, "ignore", 1);
      expectLogStateTransition(tx, CommitmentState.Public, CommitmentState.Signing, "ignore", 2);
      // we should be signing NOW
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
    });

    it("should reach max cap in whitelist and stay there until public", async () => {
      // allow to cross max cap from whitelist (fixed-slot)
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(0)], [Q18.mul(1)], {
        from: admin,
      });
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const missingAmount = tokensCostEur(tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST, dp);
      let tx = await investAmount(investors[0], missingAmount, "EUR", dp);
      // we need to ignore timestamp due to ganache bug (https://github.com/trufflesuite/ganache-core/issues/111)
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore", 0);
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
      // investing min ticket reverts
      await expect(
        investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR", dp),
      ).to.be.rejectedWith("NF_ETO_MAX_TOK_CAP");
      // wait for public phase
      await skipTimeTo(publicStartDate);
      tx = await etoCommitment.handleStateTransitions();
      // we are in public phase now
      expectLogStateTransition(tx, CommitmentState.Whitelist, CommitmentState.Public, "ignore", 0);
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
    });

    it("should reach max cap in whitelist within min ticket gap and stay there until public", async () => {
      // allow to cross max cap from whitelist (fixed-slot)
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(0)], [Q18.mul(1)], {
        from: admin,
      });
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const missingAmount = tokensCostEur(tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST, dp);
      const gap = minTicketTokenGapAmount(dp);
      await investAmount(investors[0], missingAmount.sub(gap), "EUR", dp);
      // buy one more token
      await investAmount(investors[0], dp, "EUR", dp);
      // this will cross whitelist max cap
      // we should pass "dp" below but we pass full ticket price because contract always use full price to calculate crossing max cap
      await expect(
        investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR", dp),
      ).to.be.rejectedWith("NF_ETO_MAX_TOK_CAP");
    });

    it("stay in whitelist if amount below maximum cap because of gap and no fixed slots", async () => {
      // allow to cross max cap from whitelist (fixed-slot)
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(0)], [Q18.mul(1)], {
        from: admin,
      });
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const missingAmount = tokensCostEur(tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST, dp);
      const gap = minTicketTokenGapAmount(dp);
      // console.log(`GAP ${gap} DP ${dp}`);
      // this gap makes us crossing whitelist max
      await investAmount(investors[0], missingAmount.sub(gap).sub(dp), "EUR", dp);
      await investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR", dp);
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
    });

    it("fixed slots may exceed whitelist maximum cap but will not induce state transition", async () => {
      await etoTerms.addWhitelisted(
        [investors[0], investors[1]],
        [Q18.mul(15000000), Q18.mul(0)],
        [Q18.mul(1), Q18.mul(1)],
        {
          from: admin,
        },
      );
      const missingAmount = tokensCostEur(
        tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST,
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
      );
      await investAmount(investors[0], missingAmount, "EUR", tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const discountedMissingAmount = tokensCostEur(
        tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST,
        dp,
      );
      await investAmount(
        investors[1],
        discountedMissingAmount.sub(etoTermsDict.MIN_TICKET_EUR_ULPS),
        "EUR",
        dp,
      );
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
      await investAmount(investors[1], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR", dp);
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
      // normal whitelist investor cannot invest
      await expect(
        investAmount(investors[1], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR", dp),
      ).to.be.rejectedWith("NF_ETO_MAX_TOK_CAP");
      // fixed slot still can invest
      await investAmount(
        investors[0],
        etoTermsDict.MIN_TICKET_EUR_ULPS,
        "EUR",
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
      );
    });

    it("revert on going above whitelist cap", async () => {
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(0)], [Q18.mul(1)], {
        from: admin,
      });
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const missingAmount = tokensCostEur(tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST, dp);
      await expect(investAmount(investors[0], missingAmount.add(dp), "EUR", dp)).to.be.rejectedWith(
        "NF_ETO_MAX_TOK_CAP",
      );
    });

    it("should have effective price between fix slot and discount", async () => {
      const slotPriceFraction = Q18.mul(0.8);
      // 500000 on slot discount, 100000 on WHITELIST_DISCOUNT_FRAC
      const slotDp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        Q18.sub(slotPriceFraction),
      );
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      // use multiples of price. if not multiplies there's chance of rounding errors as token price
      // is not inifinitely divisible
      const slotTranche = slotDp.mul(3873651);
      const wlTranche = dp.mul(1982761);
      await etoTerms.addWhitelisted([investors[0]], [slotTranche], [slotPriceFraction], {
        from: admin,
      });
      const tranche = slotTranche.add(wlTranche);

      const expectedPrice = calculateMixedTranchePrice(tranche, slotTranche, slotDp, dp);
      await investAmount(investors[0], tranche, "EUR", expectedPrice);
      const totals = await etoCommitment.totalInvestment();
      expect(totals[1]).to.be.bignumber.eq(getTokenPower().mul(3873651 + 1982761));
    });

    it("revert on going above whitelist cap starting as fix slot and ending in whitelist", async () => {
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const tranche1 = tokensCostEur(
        tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST,
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
      );
      await etoTerms.addWhitelisted([investors[0]], [tranche1], [Q18.mul(1)], {
        from: admin,
      });
      // invest in fix slot that does not count into whitelist cap then cross the cap with whitelist
      await investAmount(investors[0], tranche1, "EUR", tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
      const missingAmount = tokensCostEur(tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST, dp);
      await investAmount(
        investors[0],
        missingAmount.sub(etoTermsDict.MIN_TICKET_EUR_ULPS.mul(2)),
        "EUR",
        dp,
      );
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
      await expect(
        investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS.mul(3), "EUR", dp),
      ).to.be.rejectedWith("NF_ETO_MAX_TOK_CAP");
    });

    it("should refund if company signs too late", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      await investAmount(investors[4], missingAmount, "EUR");
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
      await increaseTime(durTermsDict.SIGNING_DURATION.toNumber());
      const investmentAgreementUrl = "ipfs:3290890ABINVESTMENT";
      await expect(
        etoCommitment.companySignsInvestmentAgreement(investmentAgreementUrl, { from: company }),
      ).to.be.revert;
      await etoCommitment.handleStateTransitions();
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Refund);
    });

    it("should refund if nominee signs too late", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      await investAmount(investors[4], missingAmount, "EUR");
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
      const investmentAgreementUrl = "ipfs:3290890ABINVESTMENT";
      await etoCommitment.companySignsInvestmentAgreement(investmentAgreementUrl, {
        from: company,
      });

      await increaseTime(durTermsDict.SIGNING_DURATION.toNumber());
      await expect(
        etoCommitment.nomineeConfirmsInvestmentAgreement(investmentAgreementUrl, { from: nominee }),
      ).to.be.revert;
      await etoCommitment.handleStateTransitions();
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Refund);
    });

    it("refund nominee returns nominal value", async () => {
      await deployEtoWithTicket({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: maxTicket.mul(10000) } });
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      await investAmount(investors[4], missingAmount, "EUR");
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      const contribution = await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
      await increaseTime(durTermsDict.SIGNING_DURATION.toNumber());
      const refundTx = await etoCommitment.handleStateTransitions();
      await expectValidRefundState(refundTx, investors.slice(4, 5));
      // nominee must return euro for refund to be successful, transfer without fallback must be used
      const refundValueEurUlps = contribution[0].mul(tokenTermsDict.SHARE_NOMINAL_VALUE_EUR_ULPS);
      await euroToken.transfer(etoCommitment.address, refundValueEurUlps, { from: nominee });
      expect(await euroToken.balanceOf(nominee)).to.be.bignumber.eq(0);
      await refundInvestor(investors[4]);
      await expectFullyRefundedState();
    });

    it("should allow to fundraise again on the same token", async () => {
      // no voting rights are given so secondary offering can be started by the company
      await deployETO({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: maxTicket },
        ovrShareholderRights: { GENERAL_VOTING_RULE: zero }, // no voting rights
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      await investAmount(investors[4], missingAmount, "EUR");
      const contribution = await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      const claimTx = await signInvestmentAgreement();
      await expectValidClaimState(claimTx, contribution);
      // deploy new ETO using old token
      const newTokenPrice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS.mul("1.35").floor();
      await deployETO({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(125000000) },
        ovrTokenTerms: { TOKEN_PRICE_EUR_ULPS: newTokenPrice },
        ovrEquityToken: equityToken,
      });
      // now invest
      const oldEquitySupply = await equityToken.totalSupply();
      const oldNeuEurEquiv = await neumark.totalEuroUlps();
      const oldNomineeBalance = await euroToken.balanceOf(nominee);
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate.add(1));
      const missingTokens = getMaxAvailableTokens(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      const newMissingAmount = tokensCostEur(missingTokens, newTokenPrice);
      await investAmount(investors[1], newMissingAmount, "EUR", newTokenPrice);
      const ticket = await etoCommitment.investorTicket(investors[1]);
      // we must compute effective amount of tokens as ETOCommitment does that
      // rounding problem is as follows: exact `missingTokens` cannot be bought with any nEUR amount
      // newMissingAmount buys `effectiveTokens` < missingTokens
      // newMissingAmount + 1 buys > missingTokens
      const effectiveTokens = newMissingAmount.mul(getTokenPower()).divToInt(newTokenPrice);
      const beyondEffectiveTokens = newMissingAmount
        .add(1)
        .mul(getTokenPower())
        .divToInt(newTokenPrice);
      // console.log(`${missingTokens} ${newMissingAmount} ${effectiveTokens} ${beyondEffectiveTokens}`);
      expect(ticket[2]).to.be.bignumber.eq(effectiveTokens);
      expect(ticket[2]).to.be.bignumber.lte(beyondEffectiveTokens);
      expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectValidSigningState(investors, {
        expectedInvestorsCount: 1,
        initalNeuEur: oldNeuEurEquiv,
        initialEquityTokens: oldEquitySupply,
        initialNomineeBalance: oldNomineeBalance,
      });
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      // do not go to claim state: no tokens yet issued
      expect(await equityToken.totalSupply()).to.be.bignumber.eq(oldEquitySupply);
      // go to claims
      await signInvestmentAgreement();
      // full amount now: old supply + new investment
      const totals = await etoCommitment.totalInvestment();
      const fees = await etoCommitment.contributionSummary();
      expect(await equityToken.totalSupply()).to.be.bignumber.eq(
        oldEquitySupply.add(fees[4]).add(totals[1]),
      );
    });

    it("ether deposit and send", async () => {
      await skipTimeTo(publicStartDate.add(1));
      const investor = investors[0];
      await identityRegistry.setClaims(investor, toBytes32("0x0"), toBytes32("0x1"), {
        from: admin,
      });
      // deposit 50 ether into ether token
      await etherToken.deposit({ from: investor, value: Q18.mul(50) });
      // invest 100 ether
      await etherToken.depositAndTransfer["address,uint256,bytes"](
        etoCommitment.address,
        Q18.mul(100),
        "",
        {
          from: investor,
          value: Q18.mul(50), // provide remainder in ether
        },
      );
      // all token should be spent
      expect(await etherToken.balanceOf(investor)).to.be.bignumber.eq(0);
      const ticket = await etoCommitment.investorTicket(investor);
      expect(ticket[6]).to.be.bignumber.eq(Q18.mul(100));
      // should have NEU
      expect(ticket[1]).to.be.bignumber.gt(0);
    });

    it("should allow invest over min and over max tickets for fixed slots", async () => {
      await deployEtoWithTicket({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(150000) } });
      const slotPriceFraction = Q18.mul(0.8);
      const slotDp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        Q18.sub(slotPriceFraction),
      );
      const slot1Amount = etoTermsDict.MIN_TICKET_EUR_ULPS.sub(slotDp);
      const slot2Amount = etoTermsDict.MAX_TICKET_EUR_ULPS.add(slotDp);
      await etoTerms.addWhitelisted(
        [investors[0], investors[1]],
        [slot1Amount, slot2Amount],
        [slotPriceFraction, slotPriceFraction],
        {
          from: admin,
        },
      );

      await investAmount(investors[0], slot1Amount, "EUR", slotDp);
      await investAmount(investors[1], slot2Amount, "EUR", slotDp);
      expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
        slot1Amount.add(slot2Amount),
      );
    });

    it("should ignore non erc223 funds transfers", async () => {
      // prepare two investors that have eth and nEUR
      await etherToken.deposit({ from: investors[2], value: Q18.mul(100) });
      // set verified to issue neur
      await identityRegistry.setClaims(investors[3], toBytes32("0x0"), toBytes32("0x1"), {
        from: admin,
      });
      await euroToken.deposit(investors[3], Q18.mul(100), 0x0, { from: admin });
      // is able to transfer funds without KYC
      await etherToken.transfer(etoCommitment.address, Q18, { from: investors[2] });
      await euroToken.transfer(etoCommitment.address, Q18, { from: investors[3] });
      // non erc223 transfers will deposit funds that will be lost in the contract
      await skipTimeTo(publicStartDate.add(1));
      const missingAmount = allTokensCostEur();
      // other investors invest, two above send regular transfers
      await investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR");
      await investAmount(investors[1], Q18, "ETH");

      // transfer again
      await etherToken.transfer(etoCommitment.address, Q18, { from: investors[2] });
      await euroToken.transfer(etoCommitment.address, Q18, { from: investors[3] });

      const totalEurEquiv = (await etoCommitment.totalInvestment())[0];
      await investAmount(investors[4], missingAmount.sub(totalEurEquiv), "EUR");
      // pass surplus from non erc223 transfers for bookkeeping to match
      const contribution = await expectValidSigningState(investors, {
        expectedInvestorsCount: 3,
        etherTokenSurplus: Q18.mul(2),
        euroTokenSurplus: Q18.mul(2),
      });
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);

      await etherToken.transfer(etoCommitment.address, Q18, { from: investors[2] });
      await euroToken.transfer(etoCommitment.address, Q18, { from: investors[3] });

      const claimTx = await signInvestmentAgreement();

      await etherToken.transfer(etoCommitment.address, Q18, { from: investors[2] });
      await euroToken.transfer(etoCommitment.address, Q18, { from: investors[3] });

      await expectValidClaimState(claimTx, contribution, {
        etherTokenSurplus: Q18.mul(4),
        euroTokenSurplus: Q18.mul(4),
      });
      // now investors claim all
      await claimMultipleInvestors(investors.slice(0, 5));
      // only surplus is left (forver) at commitment contract
      await expectFullClaimInPayout(contribution, {
        etherTokenSurplus: Q18.mul(4),
        euroTokenSurplus: Q18.mul(4),
      });
      // no - recycling will not release those funds
      await attachFeeDisbursal();
      await increaseTime(dayInSeconds);
      await etoCommitment.recycle([euroToken.address, etherToken.address]);
      expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(Q18.mul(4));
      expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(Q18.mul(4));
    });

    it("should ignore NEU transfers to ETO commitment if success", async () => {
      // the only side effect is that platform operator gets half of the surplus NEU, rest is lost to the contract
    });

    it("should ignore NEU transfers to ETO commitment if refund", async () => {
      // all is burned on refund, including surplus
    });

    // simulates abandoned ETO
    it("go from Setup with start date to Refund with one large increase time");
    it(
      "should allow company to call companySignsInvestmentAgreement many times until nominee confirms",
    );
  });

  describe("special ETO configurations", () => {
    it.skip("reverts overflow on internal equity token 128 bit", async () => {
      // totals of equity tokens are stored in 128 bits number
      // overflowing that is practically impossible, we'll need 2^32 investments with 2^96 ticket amount (which is max)
      await deployETO({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: two.pow(96), MIN_TICKET_EUR_ULPS: one },
        ovrTokenTerms: {
          EQUITY_TOKEN_DECIMALS: one.sub(one),
          TOKEN_PRICE_EUR_ULPS: one,
          MAX_NUMBER_OF_TOKENS: two.pow(128),
          EQUITY_TOKENS_PER_SHARE: two.pow(16),
        },
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      await etoCommitment.handleStateTransitions();
      // will generate exactly 2^56 - 2 tokens
      await investAmount(investors[0], two.pow(56).sub(two), "EUR");
      // will generate 1 token
      await investAmount(investors[0], one, "EUR");
      await expect(investAmount(investors[0], one, "EUR")).to.be.revert;
    });

    it("reverts on euro token overflow > 2**96", async () => {
      // investor ticket stores eurt equivalend in 96bit, this attempts to overflow it (without overflowing equity tokens)
      await deployETO({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: two.pow(128), MIN_TICKET_EUR_ULPS: two.pow(90) },
        ovrTokenTerms: { TOKEN_PRICE_EUR_ULPS: two.pow(90), MAX_NUMBER_OF_TOKENS: two.pow(128) },
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      await etoCommitment.handleStateTransitions();
      // will generate 62 tokens
      await investAmount(investors[0], two.pow(96).sub(two.pow(90).mul(2)), "EUR");
      // will generate 1 token
      await investAmount(investors[0], two.pow(90), "EUR");
      const totals = await etoCommitment.totalInvestment();
      expect(totals[1]).to.be.bignumber.eq(getTokenPower().mul(63));
      await expect(investAmount(investors[0], two.pow(90), "EUR")).to.be.rejectedWith("");
    });

    it("should skip whitelist in ETO with 0 whitelist period", async () => {
      await deployETO({ ovrDurations: { WHITELIST_DURATION: zero } });
      await prepareETOForPublic();
      // we moved to start date but we should be in public as wl is 0
      expect(await etoCommitment.timedState()).to.be.bignumber.eq(CommitmentState.Public);
      const tx = await investAmount(
        investors[0],
        Q18.mul(2),
        "ETH",
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
      );
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore", 0);
      expectLogStateTransition(tx, CommitmentState.Whitelist, CommitmentState.Public, "ignore", 1);
    });

    it("should skip public in ETO with 0 public period", async () => {
      // whitelist max cap is max cap
      const maxTokens = defTokenTerms.EQUITY_TOKENS_PER_SHARE.mul(4000);
      // we will not be able to sell 1000 * 10000 tokens as wl cap < max cap and public duration==0
      // but this is ok for this test - forces timed transition, not due to logic
      const maxTokensWhitelist = defTokenTerms.EQUITY_TOKENS_PER_SHARE.mul(3000);
      await deployETO({
        ovrDurations: { PUBLIC_DURATION: zero },
        ovrTokenTerms: {
          MAX_NUMBER_OF_TOKENS: maxTokens,
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: maxTokensWhitelist,
        },
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(10000000) },
      });
      await etoTerms.addWhitelisted([investors[0], investors[1]], [0, 0], [Q18, Q18], {
        from: admin,
      });
      await prepareETOForPublic();

      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      expect(await etoCommitment.timedState()).to.be.bignumber.eq(CommitmentState.Whitelist);
      await investAmount(investors[0], Q18.mul(2), "ETH", dp);
      const missingAmount = tokensCostEur(tokenTermsDict.MIN_NUMBER_OF_TOKENS, dp);
      await investAmount(investors[1], missingAmount, "EUR");
      // skiping to public should skip directly to signing
      await skipTimeTo(publicStartDate);
      const tx = await etoCommitment.handleStateTransitions();
      expectLogStateTransition(tx, CommitmentState.Whitelist, CommitmentState.Public, "ignore", 0);
      expectLogStateTransition(tx, CommitmentState.Public, CommitmentState.Signing, "ignore", 1);
      await expectValidSigningState(investors, { expectedInvestorsCount: 2 });
    });

    it("should wait on whitelist for ETO with 0 max cap whitelist but with period > 0", async () => {
      await deployETO({
        ovrTokenTerms: { MAX_NUMBER_OF_TOKENS_IN_WHITELIST: zero },
      });
      await etoTerms.addWhitelisted([investors[0]], [0], [Q18], {
        from: admin,
      });
      await prepareETOForPublic();
      // investing over max cap even with minimum ticket
      await expect(
        investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR"),
      ).to.be.rejectedWith("NF_ETO_MAX_TOK_CAP");
      await skipTimeTo(publicStartDate);
      // OK to invest in public
      await investAmount(investors[0], etoTermsDict.MIN_TICKET_EUR_ULPS, "EUR");
    });

    it("should skip public for ETO with max cap whitelist == max cap but with public period > 0", async () => {
      // whitelist max cap is max cap
      const maxTokens = defTokenTerms.MAX_NUMBER_OF_TOKENS;
      // this settings will force skipping public due to logic transition - max cap reached
      await deployETO({
        ovrTokenTerms: {
          MAX_NUMBER_OF_TOKENS: maxTokens,
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: maxTokens,
        },
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(10000000) },
      });
      await etoTerms.addWhitelisted([investors[1]], [0], [Q18], {
        from: admin,
      });
      await prepareETOForPublic();

      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const missingAmount = tokensCostEur(getMaxAvailableTokens(maxTokens), dp);
      // we immediately should go to signing, skipping public due to max cap
      const tx = await investAmount(investors[1], missingAmount, "EUR", dp);
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore", 0);
      expectLogStateTransition(tx, CommitmentState.Whitelist, CommitmentState.Public, "ignore", 1);
      expectLogStateTransition(tx, CommitmentState.Public, CommitmentState.Signing, "ignore", 2);
      await expectValidSigningState(investors, { expectedInvestorsCount: 1 });
    });

    it("should allow single share commitment", async () => {
      const oneShare = defTokenTerms.EQUITY_TOKENS_PER_SHARE;
      const tokenPrice = Q18;
      await deployETO({
        ovrTokenTerms: {
          MAX_NUMBER_OF_TOKENS: oneShare.mul(2),
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: zero,
          MIN_NUMBER_OF_TOKENS: oneShare,
          TOKEN_PRICE_EUR_ULPS: tokenPrice,
        },
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      // minimum investment is one share, that should also shift eto to signing, because this is also max investment
      const minimumAmount = tokensCostEur(oneShare, tokenPrice);
      let tx = await investAmount(investors[1], minimumAmount, "EUR", tokenPrice);
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore", 0);
      expectLogStateTransition(tx, CommitmentState.Whitelist, CommitmentState.Public, "ignore", 1);
      const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
      await skipTimeTo(signingStartOf.add(1));
      tx = await etoCommitment.handleStateTransitions();
      expectLogStateTransition(tx, CommitmentState.Public, CommitmentState.Signing, "ignore");
      const contribution = await expectValidSigningState([investors[1]]);
      await moveETOToClaim(1, zero);
      // expect one share sold
      const totalInvestment = await etoCommitment.totalInvestment();
      expect(totalInvestment[1]).to.be.bignumber.eq(oneShare);
      // expect two shares generated
      expect(totalInvestment[1].add(contribution[4])).to.be.bignumber.eq(oneShare.mul(2));
    });

    it("should allow min cap == max available tokens commitment", async () => {
      // min investment is max investment
      const oneShare = defTokenTerms.EQUITY_TOKENS_PER_SHARE;
      const maxTokens = oneShare.mul(2);
      // make min tokens == AVAILABLE TOKENS
      const minTokens = getMaxAvailableTokens(maxTokens);
      const tokenPrice = Q18;
      await deployETO({
        ovrTokenTerms: {
          MAX_NUMBER_OF_TOKENS: maxTokens,
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: zero,
          MIN_NUMBER_OF_TOKENS: minTokens,
          TOKEN_PRICE_EUR_ULPS: tokenPrice,
        },
        ovrETOTerms: {
          MAX_TICKET_EUR_ULPS: maxTokens.mul(tokenPrice),
        },
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      // minimum investment is one share, that should also shift eto to signing, because this is also max investment
      const minimumAmount = tokensCostEur(minTokens, tokenPrice);
      const tx = await investAmount(investors[1], minimumAmount, "EUR", tokenPrice);
      expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore", 0);
      expectLogStateTransition(tx, CommitmentState.Whitelist, CommitmentState.Public, "ignore", 1);
      expectLogStateTransition(tx, CommitmentState.Public, CommitmentState.Signing, "ignore", 2);
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
    });

    async function deployLargeTokensAmountOvr(tokenPrice, wholeTokens) {
      const maxTokens = new web3.BigNumber(wholeTokens);
      const availableTokens = getMaxAvailableTokens(maxTokens);
      await deployETO({
        ovrTokenTerms: {
          MAX_NUMBER_OF_TOKENS: maxTokens,
          MIN_NUMBER_OF_TOKENS: defEquityTokenPower,
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: zero,
          TOKEN_PRICE_EUR_ULPS: tokenPrice,
          EQUITY_TOKENS_PER_SHARE: defEquityTokenPower,
        },
        ovrETOTerms: {
          MIN_TICKET_EUR_ULPS: tokenPrice,
          MAX_TICKET_EUR_ULPS: maxTokens.mul(tokenPrice),
        },
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);

      return availableTokens;
    }

    function getOverflowPrice() {
      // scale price so it will generate enough tokens to overlow 2**96
      return Q18.div(Q18.div(defEquityTokenPower).mul(10000));
    }

    it("rejects on 2**96 tokens in ticket", async () => {
      const tokenPrice = getOverflowPrice();
      if (tokenPrice.decimalPlaces() > 0) {
        // eslint-disable-next-line no-console
        console.log("...skipping test due to precise overflow tok price not existing");
      } else {
        const availableTokens = await deployLargeTokensAmountOvr(
          tokenPrice,
          Q18.mul("99843987623"),
        );
        const maximumAmount = tokensCostEur(availableTokens, tokenPrice);
        await expect(investAmount(investors[1], maximumAmount, "EUR")).to.be.rejectedWith(
          "NF_TICKET_EXCEEDS_MAX_TOK",
        );
      }
    });

    it("rejects on 2**96 tokens in two tickets", async () => {
      const tokenPrice = getOverflowPrice();
      if (tokenPrice.decimalPlaces() > 0) {
        // eslint-disable-next-line no-console
        console.log("...skipping test due to precise overflow tok price not existing");
      } else {
        await deployLargeTokensAmountOvr(tokenPrice, Q18.mul("99843987623"));
        await investAmount(investors[1], tokensCostEur(two.pow(96).sub(1), tokenPrice), "EUR");
        await expect(investAmount(investors[1], tokenPrice, "EUR")).to.be.rejectedWith(
          "NF_TICKET_EXCEEDS_MAX_TOK",
        );
      }
    });

    it("rejects on 2**96 nEUR in ticket", async () => {
      // investor ticket stores eurt equivalend in 96bit, this attempts to overflow it (without overflowing equity tokens)
      const tokenPrice = Q18;
      const availableTokens = await deployLargeTokensAmountOvr(tokenPrice, Q18.mul("99843987623"));
      const maximumAmount = tokensCostEur(availableTokens, tokenPrice);
      await expect(investAmount(investors[1], maximumAmount, "EUR")).to.be.rejectedWith(
        "NF_TICKET_EXCEEDS_MAX_EUR",
      );
    });

    it("rejects on 2**96 nEUR in two tickets", async () => {
      const tokenPrice = Q18;
      await deployLargeTokensAmountOvr(tokenPrice, Q18.mul("99843987623"));
      await investAmount(investors[1], two.pow("96").sub(tokenPrice), "EUR");
      await expect(investAmount(investors[1], tokenPrice, "EUR")).to.be.rejectedWith(
        "NF_TICKET_EXCEEDS_MAX_EUR",
      );
    });

    it("should use available tokens with rounding discrepancy", async () => {
      if (defEquityTokenDecimals.eq(0)) {
        // this is magic number of tokens that generate rounding discrepancy, disregard token scale
        const maxTokens = new web3.BigNumber("99843987622");
        const availableTokens = getMaxAvailableTokens(maxTokens);
        const fee = await platformTerms.calculatePlatformTokenFee(availableTokens);
        // so after reverse operation: adding available tokens to fee, we would exceed max cap in eto commitment
        expect(availableTokens.add(fee).sub(1)).to.be.bignumber.eq(maxTokens);

        const tokenPrice = getOverflowPrice()
          .mul(10000)
          .floor();
        await deployLargeTokensAmountOvr(tokenPrice, maxTokens);
        // minimum investment is one share, that should also shift eto to signing, because this is also max investment
        const maximumAmount = tokensCostEur(availableTokens, tokenPrice);
        // availableTokens may not be reached by any investment amount
        // see comments should allow to fundraise again on the same token
        const tx = await investAmount(investors[1], maximumAmount, "EUR", tokenPrice);
        expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, "ignore", 0);
        expectLogStateTransition(
          tx,
          CommitmentState.Whitelist,
          CommitmentState.Public,
          "ignore",
          1,
        );
        expectLogStateTransition(tx, CommitmentState.Public, CommitmentState.Signing, "ignore", 2);
        await expectExactlyMaxCap(defEquityTokenPower.mul(maxTokens));
      } else {
        // eslint-disable-next-line no-console
        console.log("...tests only for decimals 0 - magic number of tokens used");
      }
    });

    it("should enable transfer on equity token on success", async () => {
      await deployETO({
        ovrETOTerms: {
          MIN_TICKET_EUR_ULPS: Q18.mul(100),
          MAX_TICKET_EUR_ULPS: Q18.mul(15000000),
          ENABLE_TRANSFERS_ON_SUCCESS: true,
        },
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      const missingAmount = allTokensCostEur();
      await investAmount(investors[1], missingAmount, "EUR");
      await moveETOToClaim(1, zero);
      await claimInvestor(investors[1]);
      // expect transfers are enabled
      await equityToken.transfer(investors[0], 1, { from: investors[1] });
    });

    it("should disable transfer on equity token on success", async () => {
      await deployETO({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(15000000), ENABLE_TRANSFERS_ON_SUCCESS: false },
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      const missingAmount = allTokensCostEur();
      await investAmount(investors[1], missingAmount, "EUR");
      await moveETOToClaim(1, zero);
      await claimInvestor(investors[1]);
      // expect transfers are enabled
      await expect(equityToken.transfer(investors[0], 1, { from: investors[1] })).to.be.revert;
    });

    it("sign to claim with feeDisbursal as simple address", async () => {
      // set simple address as fee disbursal
      const simpleAccountDisbursal = investors[3];
      await universe.setSingleton(knownInterfaces.feeDisbursal, simpleAccountDisbursal, {
        from: admin,
      });
      // allow to receive eurt
      await euroTokenController.setAllowedTransferTo(simpleAccountDisbursal, true, { from: admin });
      await deployETO({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(15000000) } });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      const missingAmount = allTokensCostEur();
      await investAmount(investors[1], missingAmount, "EUR");
      await moveETOToClaim(1, zero);
      await claimInvestor(investors[1]);
      const currDate = new web3.BigNumber(await latestTimestamp());
      const payoutDate = currDate.add(durTable[CommitmentState.Claim]);
      await skipTimeTo(payoutDate);
      await etoCommitment.payout();
      // check if disbursal happened
      expect(await euroToken.balanceOf(simpleAccountDisbursal)).to.be.bignumber.eq(
        missingAmount.mul("0.03").round(0, 4),
      );
    });

    it("sign to claim with real FeeDisbursal contract", async () => {
      await deployETO({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(15000000) } });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      const missingAmount = tokensCostEur(
        tokenTermsDict.MIN_NUMBER_OF_TOKENS,
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
      );
      const ethAmount = Q18.mul(232).add(1);
      await investAmount(investors[1], ethAmount, "ETH");
      await investAmount(investors[1], missingAmount, "EUR");
      let currDate = new web3.BigNumber(await latestTimestamp());
      const signDate = currDate.add(durTable[CommitmentState.Public]);
      await skipTimeTo(signDate);
      await moveETOToClaim(1, zero);
      await claimInvestor(investors[1]);
      currDate = new web3.BigNumber(await latestTimestamp());
      const payoutDate = currDate.add(durTable[CommitmentState.Claim]);
      await skipTimeTo(payoutDate);

      // change to new FeeDisbursal
      const [feeDisbursal] = await deployFeeDisbursalUniverse(universe, admin);
      // also let it process nEUR
      await euroTokenController.applySettings(0, 0, Q18, { from: admin });
      // this will pay out
      await etoCommitment.payout();
      // check if disbursal happened
      expect(await euroToken.balanceOf(feeDisbursal.address)).to.be.bignumber.eq(
        missingAmount.mul(0.03).round(0, 4),
      );
      expect(await etherToken.balanceOf(feeDisbursal.address)).to.be.bignumber.eq(
        ethAmount.mul(0.03).round(0, 4),
      );
    });

    it("should invest in ETO with public discount and have full valuation", async () => {
      const publicDiscount = Q18.mul("0.2");
      await deployETO({
        ovrETOTerms: {
          MAX_TICKET_EUR_ULPS: Q18.mul(15000000),
          ENABLE_TRANSFERS_ON_SUCCESS: false,
          PUBLIC_DISCOUNT_FRAC: publicDiscount,
        },
        ovrETOTermsConstraints: {
          CAN_SET_TRANSFERABILITY: false,
        },
      });
      // check that whitelist investment is not affected by public discount
      await etoTerms.addWhitelisted(
        [investors[0], investors[1], investors[2]],
        [0, 0, Q18.mul(10000)],
        [Q18, Q18, Q18.mul("0.3")],
        {
          from: admin,
        },
      );
      await prepareETOForPublic();
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      await investAmount(investors[0], Q18.mul(76172.12882), "EUR", dp);
      await investAmount(investors[1], Q18.mul(281.12882), "ETH", dp);
      const slotPrice = discountedPrice(tokenTermsDict.TOKEN_PRICE_EUR_ULPS, Q18.mul(0.7));
      await investAmount(investors[2], Q18.mul(10000), "EUR", slotPrice);
      await investAmount(investors[2], Q18.mul(54).add(1), "ETH", dp);
      await skipTimeTo(publicStartDate);

      const publicPrice = discountedPrice(tokenTermsDict.TOKEN_PRICE_EUR_ULPS, publicDiscount);
      await investAmount(investors[1], Q18.mul(827.12).sub(1), "ETH", publicPrice);
      await investAmount(investors[3], Q18.mul(121.12), "ETH", publicPrice);

      const tokensSold = (await etoCommitment.totalInvestment())[1];
      const missingTokens = getMaxAvailableTokens(tokenTermsDict.MAX_NUMBER_OF_TOKENS).sub(
        tokensSold,
      );
      const missingAmount = tokensCostEur(missingTokens, publicPrice);
      await investAmount(investors[1], missingAmount, "EUR", publicPrice);
      const contribution = await moveETOToClaim(4, zero);
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      await claimInvestor(investors[1]);
      await claimInvestor(investors[0]);
      await claimInvestor(investors[2]);
      await claimInvestor(investors[3]);
      const currDate = new web3.BigNumber(await latestTimestamp());
      const payoutDate = currDate.add(durTable[CommitmentState.Claim]);
      await skipTimeTo(payoutDate);
      const transitionTx = await etoCommitment.payout();
      await expectValidPayoutState(transitionTx, contribution);
      await expectValidPayoutStateFullClaim();
      // check valuation of company in token controller
      const increasedShareCapitalUlps = contribution[1].add(etoTermsDict.EXISTING_SHARE_CAPITAL);
      const sharePriceEurUlps = await tokenTerms.SHARE_PRICE_EUR_ULPS();
      const expectedValuation = divRound(
        increasedShareCapitalUlps.mul(sharePriceEurUlps),
        tokenTermsDict.SHARE_NOMINAL_VALUE_ULPS,
      );
      const shareholderInfo = await equityTokenController.shareholderInformation();
      expect(shareholderInfo[0]).to.be.bignumber.eq(increasedShareCapitalUlps);
      expect(shareholderInfo[1]).to.be.bignumber.eq(expectedValuation);
    });

    it("should allow simple price and valuation formulas for simple shareholding struct", async () => {
      // we can use various simplified formula for ETOs where all shares are identical and have 1 EUR value
      // so number of shares = share capital
      const tokensPerShare = new web3.BigNumber("10000").mul(defEquityTokenPower);
      await deployETO({
        ovrTokenTerms: {
          SHARE_NOMINAL_VALUE_ULPS: Q18,
          SHARE_NOMINAL_VALUE_EUR_ULPS: Q18,
          EQUITY_TOKENS_PER_SHARE: tokensPerShare,
          TOKEN_PRICE_EUR_ULPS: Q18.mul("0.02"),
          MIN_NUMBER_OF_TOKENS: tokensPerShare.mul(5),
          MAX_NUMBER_OF_TOKENS: tokensPerShare.mul(10000),
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: tokensPerShare.mul(5),
        },
        ovrETOTerms: {
          MAX_TICKET_EUR_ULPS: Q18.mul("5000000"),
          SHARE_CAPITAL_CURRENCY_CODE: "EUR",
          EXISTING_SHARE_CAPITAL: Q18.mul("25000"),
        },
      });
      // make full cap in one go
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      // make full cap by investing all possible shares by share price of 200 EUR (0.02 * 10000) / 1.02 - token fee
      const maxInvestmentAmount = Q18.mul("1960784.313725490196078431");
      const invTx = await investAmount(investors[0], maxInvestmentAmount, "EUR", Q18.mul("0.02"));
      await expectValidSigningState([investors[0]]);
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      // inv txt should contain signing event where nominee capital is equal to number of generated shares
      // we do not generate any shares above the max number of token, fee is taken within this limit
      const totalNewShares = new web3.BigNumber("10000");
      expectLogSigningStarted(invTx, nominee, company, totalNewShares, Q18.mul(totalNewShares));
      // this will also check claims state
      const contribution = await moveETOToClaim(1, zero);
      expect(contribution[0]).to.be.bignumber.eq(totalNewShares);
      expect(contribution[1]).to.be.bignumber.eq(Q18.mul(totalNewShares));
      // this is effective price that will generate issued number of shares for collected funds
      // full share price * ratio of tokens sold to all tokens
      // 200*(10000*10000/(102/100))/(10000*10000) == 10000/51
      const effectiveSharePrice = Q18.mul("10000")
        .div(51)
        .round(0, 4);
      expect(contribution[7]).to.be.bignumber.eq(effectiveSharePrice);
      // check if nominee balance == share capital increase
      expect(await euroToken.balanceOf(nominee)).to.be.bignumber.eq(Q18.mul(totalNewShares));
      const shareholderInfo = await equityTokenController.shareholderInformation();
      // which is number of shares but in Q18 units
      const totalSharesCapitalPost = Q18.mul("25000").add(totalNewShares.mul(Q18));
      expect(shareholderInfo[0]).to.be.bignumber.eq(totalSharesCapitalPost);
      // check new company valuation in token controller
      // now we count in all the shares created by price of last share sold but 2% of shares is not removed
      // and this needs to be discussed
      expect(shareholderInfo[1]).to.be.bignumber.eq(totalSharesCapitalPost.mul("200"));
    });

    async function deployLargeSharePriceOvr(decimals) {
      const ovrTokenTerms = {
        EQUITY_TOKEN_DECIMALS: decimals || defEquityTokenDecimals,
      };
      const tokenPower = getTokenPower(ovrTokenTerms);
      const tokensPerShare = new web3.BigNumber("10000").mul(tokenPower);
      const sharePrice = Q18.mul("161870.503597122");
      const tokenPrice = sharePrice.mul(tokenPower).divToInt(tokensPerShare);
      const shareNominalValue = Q18.mul(100);
      await deployETO({
        ovrTokenTerms: Object.assign(ovrTokenTerms, {
          SHARE_NOMINAL_VALUE_ULPS: shareNominalValue,
          SHARE_NOMINAL_VALUE_EUR_ULPS: Q18.mul("13.5"),
          EQUITY_TOKENS_PER_SHARE: tokensPerShare,
          TOKEN_PRICE_EUR_ULPS: tokenPrice,
          MIN_NUMBER_OF_TOKENS: tokensPerShare.mul(6),
          MAX_NUMBER_OF_TOKENS: tokensPerShare.mul(30),
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: tokensPerShare.mul(30),
        }),
        ovrETOTerms: {
          MAX_TICKET_EUR_ULPS: Q18.mul("5000000"),
          MIN_TICKET_EUR_ULPS: Q18.mul("20"),
          SHARE_CAPITAL_CURRENCY_CODE: "PLN",
          EXISTING_SHARE_CAPITAL: Q18.mul("27800"),
        },
      });
      return [sharePrice, shareNominalValue];
    }

    it("should lose significant amount when buying non round number of tokens", async () => {
      // we buy for 160 EUR which is almost 10 tokens, but almost makes a big difference
      // we use low equity token scale to inflate rounding
      await deployLargeSharePriceOvr(zero);
      // make full cap in one go
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      await investAmount(investors[0], Q18.mul("160"), "EUR", Q18.mul("16.1870503597122"));
      const ticket = await etoCommitment.investorTicket(investors[0]);
      expect(ticket[2]).to.be.bignumber.eq(9);
    });

    it("should have correct valuation for very high share price", async () => {
      // we'll create additional share to cover for 2% token fee
      const [sharePrice, shareNominalValue] = await deployLargeSharePriceOvr();
      // make full cap in one go
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      // make full cap by investing all possible shares by share price * 30 / 1.02
      // AccountingForm[161870.503597122*30/(102/100), {76, 25}]
      // FYI: mathematica will solve this symbolically and then convert to N
      // this avoids many roundings and the value here is really: 4760897.164621235
      // no time to investigate though, using regular calculator I get same values as in contract
      const maxInvestmentAmount = Q18.mul("4760897.164621235294117647");
      const invTx = await investAmount(
        investors[0],
        maxInvestmentAmount,
        "EUR",
        Q18.mul("16.1870503597122"),
      );
      expect(await etoCommitment.timedState.call()).to.be.bignumber.eq(CommitmentState.Signing);
      await expectValidSigningState([investors[0]]);
      await expectExactlyMaxCap(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      // inv txt should contain signing event where nominee capital is equal to number of generated shares
      // which is a max cap as fee is taken from max tokens
      const totalNewShares = new web3.BigNumber("30");
      expect(totalNewShares).to.be.bignumber.eq(30);
      expectLogSigningStarted(
        invTx,
        nominee,
        company,
        totalNewShares,
        shareNominalValue.mul(totalNewShares),
      );
      // this will also check claims state
      const contribution = await moveETOToClaim(1, zero);
      expect(contribution[0]).to.be.bignumber.eq(totalNewShares);
      expect(contribution[1]).to.be.bignumber.eq(shareNominalValue.mul(totalNewShares));
      // this is effective price that will generate issued number of shares for collected funds
      // AccountingForm[161870.503597122*(30*10000/(102/100))/(30*10000), {76,19}]
      // also here Mathematica produces nice "rounder" number, value below was obtained using calculator
      const effectiveSharePrice = Q18.mul("158696.572154041176470588").round(0, 4);
      expect(contribution[7]).to.be.bignumber.eq(effectiveSharePrice);
      const totalSharesCapitalPost = Q18.mul("27800").add(totalNewShares.mul(shareNominalValue));
      const shareholderInfo = await equityTokenController.shareholderInformation();
      expect(shareholderInfo[0]).to.be.bignumber.eq(totalSharesCapitalPost);
      // now company valuation takes into account this new share
      expect(shareholderInfo[1]).to.be.bignumber.eq(
        totalSharesCapitalPost.mul(sharePrice).div(shareNominalValue),
      );
    });
  });

  describe("all claim cases", () => {
    let contribution;
    beforeEach(async () => {
      await deployLockedAccounts();
      await createLockedAccounts(investors.slice(0, 2));
      await deployETO({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(15000000) } });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      const missingAmount = tokensCostEur(
        tokenTermsDict.MIN_NUMBER_OF_TOKENS,
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
      );
      await investICBMAmount(investors[0], Q18.mul(762.192).add(1), "EUR");
      await investICBMAmount(investors[1], Q18.mul(12.761).add(1), "ETH");
      const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
      await investAmount(investors[1], missingAmount, "EUR");
      await investAmount(investors[0], Q18.mul(762.192).add(1), "ETH");
      const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
      await skipTimeTo(signingStartOf.add(1));
      contribution = await moveETOToClaim(2, icbmEurEquiv);
    });

    async function transitionToPayout() {
      const currDate = new web3.BigNumber(await latestTimestamp());
      const payoutDate = currDate.add(durTable[CommitmentState.Claim]);
      await skipTimeTo(payoutDate);
      const transitionTx = await etoCommitment.payout();
      await expectValidPayoutState(transitionTx, contribution, {
        expectsEther: false,
        expectsEuro: false,
      });
    }

    it("should claim in claim", async () => {
      await claimInvestor(investors[0]);
      await claimInvestor(investors[1]);
      await expectFullClaimInPayout(contribution);
      await expectNoICBMPendingCommitments(investors.slice(0, 1));
    });

    it("should claim in payout", async () => {
      const currDate = new web3.BigNumber(await latestTimestamp());
      const payoutDate = currDate.add(durTable[CommitmentState.Claim]);
      await skipTimeTo(payoutDate);
      const transitionTx = await etoCommitment.payout();
      await expectValidPayoutState(transitionTx, contribution);
      await claimInvestor(investors[0]);
      await claimInvestor(investors[1]);
      await expectValidPayoutStateFullClaim();
      await expectNoICBMPendingCommitments(investors.slice(0, 1));
    });

    it("should claim twice without effect", async () => {
      await claimInvestor(investors[0]);
      await claimInvestor(investors[1]);
      const claim1Tx = await etoCommitment.claim({ from: investors[0] });
      expect(hasEvent(claim1Tx, "LogTokensClaimed")).to.be.false;
      const claim2Tx = await etoCommitment.claim({ from: investors[1] });
      expect(hasEvent(claim2Tx, "LogTokensClaimed")).to.be.false;
      await expectFullClaimInPayout(contribution);
      await expectNoICBMPendingCommitments(investors.slice(0, 1));
    });

    it("should claim without ticket without effect", async () => {
      const claim1Tx = await etoCommitment.claim({ from: investors[2] });
      expect(hasEvent(claim1Tx, "LogTokensClaimed")).to.be.false;
    });

    it("should claim many in claim", async () => {
      await claimMultipleInvestors([investors[0], investors[1]]);
      await expectFullClaimInPayout(contribution);
      await expectNoICBMPendingCommitments(investors.slice(0, 1));
    });

    it("should claim partially and recycle NEU proceeds", async () => {
      // claim part of NEU from contract
      await etoCommitment.claim({ from: investors[1] });
      const feeDisbursal = await attachFeeDisbursal();
      // let contract keep NEU and fire payout event
      await transitionToPayout();
      // skip one day
      await increaseTime(dayInSeconds);
      // commitment contract has reward due
      const paymentTokens = [etherToken.address, euroToken.address];
      const claimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        etoCommitment.address,
      );
      // has pending payout
      expect(claimables[0][0]).to.be.bignumber.gt(0);
      expect(claimables[1][0]).to.be.bignumber.gt(0);
      // investor claimables
      const preRecycleClaimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[1],
      );
      // recycle
      await etoCommitment.recycle(paymentTokens);
      // skip one day
      await increaseTime(dayInSeconds);
      // payout amount for investor increased
      const postRecycleClaimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[1],
      );
      expect(postRecycleClaimables[0][0]).to.be.bignumber.gt(preRecycleClaimables[0][0]);
      expect(postRecycleClaimables[1][0]).to.be.bignumber.gt(preRecycleClaimables[1][0]);
    });

    it("should claim all and recycle NEU proceeds", async () => {
      // claim part of NEU from contract
      await claimMultipleInvestors([investors[0], investors[1]]);
      const feeDisbursal = await attachFeeDisbursal();
      // no NEU in contract - all claimed
      await transitionToPayout();
      // skip one day
      await increaseTime(dayInSeconds);
      const paymentTokens = [etherToken.address, euroToken.address];
      const claimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        etoCommitment.address,
      );
      // has pending payout
      expect(claimables[0][0]).to.be.bignumber.eq(0);
      expect(claimables[1][0]).to.be.bignumber.eq(0);
      // investor claimables
      const preRecycleClaimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[0],
      );
      // recycle
      await etoCommitment.recycle(paymentTokens);
      // skip one day
      await increaseTime(dayInSeconds);
      // payout amount still the same
      const postRecycleClaimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[0],
      );
      expect(postRecycleClaimables[0][0]).to.be.bignumber.eq(preRecycleClaimables[0][0]);
      expect(postRecycleClaimables[1][0]).to.be.bignumber.eq(preRecycleClaimables[1][0]);
    });

    it("should recycle NEU proceeds selectively", async () => {
      // claim part of NEU from contract
      await etoCommitment.claim({ from: investors[1] });
      const feeDisbursal = await attachFeeDisbursal();
      // let contract keep NEU and fire payout event
      await transitionToPayout();
      // skip one day
      await increaseTime(dayInSeconds);
      // investor claimables
      const paymentTokens = [etherToken.address, euroToken.address];
      const preRecycleClaimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[1],
      );
      // recycle ether
      await etoCommitment.recycle([etherToken.address]);
      // skip one day
      await increaseTime(dayInSeconds);
      // payout amount for investor in ETH increased
      const postRecycleClaimables = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[1],
      );
      expect(postRecycleClaimables[0][0]).to.be.bignumber.gt(preRecycleClaimables[0][0]);
      expect(postRecycleClaimables[1][0]).to.be.bignumber.eq(preRecycleClaimables[1][0]);
      // second investor claims
      await etoCommitment.claim({ from: investors[0] });

      const preRecycleClaimablesInv2 = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[0],
      );
      // late to the claiming party - no payouts
      expect(preRecycleClaimablesInv2[0][0]).to.be.bignumber.eq(0);
      expect(preRecycleClaimablesInv2[1][0]).to.be.bignumber.eq(0);
      // recycle euro
      await etoCommitment.recycle([euroToken.address]);
      // skip one day
      await increaseTime(dayInSeconds);
      // second investors gets some euro payout, eth 0
      const postRecycleClaimablesInv2 = await feeDisbursal.claimableMutipleByToken(
        paymentTokens,
        neumark.address,
        investors[0],
      );
      expect(postRecycleClaimablesInv2[0][0]).to.be.bignumber.eq(0);
      // there's payout in euro token after ETO recycle
      expect(postRecycleClaimablesInv2[1][0]).to.be.bignumber.gt(0);
      // investor 2 claims some recovered eth (this is why we have recycle in commitment)
      await feeDisbursal.accept(euroToken.address, neumark.address, 1, { from: investors[0] });
    });

    it("rejects recycle in claim state", async () => {
      // someone wants to release before payout
      await expect(etoCommitment.recycle([euroToken.address])).to.be.rejectedWith(EvmError);
    });

    it("should not touch NEU and ET held in commitment via recycle", async () => {
      await attachFeeDisbursal();
      // let contract keep NEU and fire payout event
      await transitionToPayout();
      // skip one day
      await increaseTime(dayInSeconds);
      // commitment contract has reward due
      const assetTokens = [neumark.address, equityToken.address];
      const neuBalance = await neumark.balanceOf(etoCommitment.address);
      const etBalance = await equityToken.balanceOf(etoCommitment.address);
      // recycle asset tokens (yes that's possible)
      await etoCommitment.recycle(assetTokens);
      // skip one day
      await increaseTime(dayInSeconds);
      // assets not touched
      expect(await neumark.balanceOf(etoCommitment.address)).to.be.bignumber.eq(neuBalance);
      expect(await equityToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(etBalance);
    });

    it("should claim many in payout", async () => {
      await transitionToPayout();
      await claimMultipleInvestors([investors[0], investors[1]]);
      await expectValidPayoutStateFullClaim();
      await expectNoICBMPendingCommitments(investors.slice(0, 1));
    });
  });

  describe("all refund cases", () => {
    beforeEach(async () => {
      await deployLockedAccounts();
      await createLockedAccounts(investors.slice(0, 2));
      await deployETO({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(15000000) } });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate);
      await investICBMAmount(investors[0], Q18.mul("762.192").add(1), "EUR");
      await investICBMAmount(investors[1], Q18.mul("12.761").add(1), "ETH");
      const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
      await investAmount(investors[0], Q18.mul("762.192").add(1), "ETH");
      await investAmount(investors[1], Q18.mul("258272.121"), "EUR");
      const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
      await skipTimeTo(signingStartOf.add(1));
      const refundTx = await etoCommitment.handleStateTransitions();
      await expectValidRefundState(refundTx, investors.slice(0, 2), icbmEurEquiv);
    });

    it("should refund", async () => {
      await refundInvestor(investors[0]);
      await refundInvestor(investors[1]);
      await expectFullyRefundedState();
    });

    it("should refund twice without effect", async () => {
      await refundInvestor(investors[0]);
      await refundInvestor(investors[1]);
      const refund1Tx = await etoCommitment.refund({ from: investors[0] });
      expect(hasEvent(refund1Tx, "LogFundsRefunded")).to.be.false;
      const refund2Tx = await etoCommitment.refund({ from: investors[1] });
      expect(hasEvent(refund2Tx, "LogFundsRefunded")).to.be.false;
      await expectFullyRefundedState();
    });

    it("should refund without ticket without effect", async () => {
      const claim1Tx = await etoCommitment.refund({ from: investors[2] });
      expect(hasEvent(claim1Tx, "LogFundsRefunded")).to.be.false;
    });

    it("should refund many", async () => {
      await refundMultipleInvestors([investors[0], investors[1]]);
      await expectFullyRefundedState();
    });
  });

  describe("calculateContribution", () => {
    const MAX_TICKET_EUR_ULPS = Q18.mul(15000000);
    const MAX_INVESTMENT_AMOUNT_EUR_ULPS = MAX_TICKET_EUR_ULPS.mul(2).sub(1); // two full tickets cannot be invested, one eur less though yes

    beforeEach(async () => {
      await deployETO({
        ovrETOTerms: { MAX_TICKET_EUR_ULPS },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS },
      });
      await identityRegistry.setClaims(investors[0], "0x0", toBytes32("0x1"), { from: admin });
      await prepareETOForPublic();
    });

    it("should set max cap when exceeded max investment amount in public phase", async () => {
      await deployETO({
        ovrETOTerms: { MIN_TICKET_EUR_ULPS: Q18, MAX_TICKET_EUR_ULPS },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS }, // max invest is 5mio
        ovrTokenTerms: { MAX_NUMBER_OF_TOKENS: manyTokens }, // we allow many tokens, so there is no max cap triggered there
      });
      await prepareETOForPublic();
      await skipTimeTo(publicStartDate.add(1));

      // invest one full ticket
      await investAmount(investors[0], MAX_TICKET_EUR_ULPS, "EUR");

      // this is exactly MAX_INVESTMENT_AMOUNT_EUR_ULPS now
      const contrib1 = await etoCommitment.calculateContribution(
        investors[1],
        false,
        MAX_TICKET_EUR_ULPS.sub(1),
      );
      expect(contrib1[6]).to.be.false;

      // this is one more than MAX_INVESTMENT_AMOUNT_EUR_ULPS
      const contrib2 = await etoCommitment.calculateContribution(
        investors[1],
        false,
        MAX_TICKET_EUR_ULPS,
      );
      expect(contrib2[6]).to.be.true;
    });

    it("should set max cap when exceeded max investment amount in whitelist phase", async () => {
      await deployETO({
        ovrETOTerms: { MIN_TICKET_EUR_ULPS: Q18, MAX_TICKET_EUR_ULPS },
        ovrETOTermsConstraints: { MAX_INVESTMENT_AMOUNT_EUR_ULPS }, // max invest is 5mio
        ovrTokenTerms: {
          MAX_NUMBER_OF_TOKENS: manyTokens,
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: manyTokens,
        }, // we allow many tokens, so there is no max cap triggered there
      });
      await prepareETOForPublic();
      await etoTerms.addWhitelisted(
        [investors[0], investors[1]],
        [Q18.mul(0), Q18.mul(0)],
        [Q18.mul(1), Q18.mul(1)],
        {
          from: admin,
        },
      );

      // invest one full ticket
      await investAmount(investors[0], MAX_TICKET_EUR_ULPS, "EUR");

      // this is exactly MAX_INVESTMENT_AMOUNT_EUR_ULPS now
      const contrib1 = await etoCommitment.calculateContribution(
        investors[1],
        false,
        MAX_TICKET_EUR_ULPS.sub(1),
      );
      expect(contrib1[6]).to.be.false;

      // this is one more than MAX_INVESTMENT_AMOUNT_EUR_ULPS
      const contrib2 = await etoCommitment.calculateContribution(
        investors[1],
        false,
        MAX_TICKET_EUR_ULPS,
      );
      expect(contrib2[6]).to.be.true;
    });

    it("should calculate contribution", async () => {
      // add fixed slots for more tests cases
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(15000000)], [Q18.mul(1)], {
        from: admin,
      });
      // go to public
      await skipTimeTo(publicStartDate.add(1));
      const amount = Q18.mul("87219.291").add(1);
      const contrib = await etoCommitment.calculateContribution(investors[0], false, amount);
      // is whitelisted
      expect(contrib[0]).to.be.true;
      // investor is eligible
      expect(contrib[1]).to.be.true;
      expect(contrib[2]).to.be.bignumber.eq(etoTermsDict.MIN_TICKET_EUR_ULPS);
      // returns public max ticket
      expect(contrib[3]).to.be.bignumber.eq(etoTermsDict.MAX_TICKET_EUR_ULPS);
      // always round down in equity token calc
      const equityAmount = amount
        .mul(getTokenPower())
        .divToInt(tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
      expect(contrib[4]).to.be.bignumber.eq(equityAmount);
      const neuAmount = investorShare(await neumark.incremental(amount));
      expect(contrib[5]).to.be.bignumber.eq(neuAmount);
      expect(contrib[6]).to.be.false;
      // invest
      await investAmount(investors[0], amount, "EUR");
      // next contrib
      const contrib2 = await etoCommitment.calculateContribution(investors[0], false, amount);
      expect(contrib2[4]).to.be.bignumber.eq(contrib[4]);
      // NEU reward drops
      expect(contrib2[5]).to.be.bignumber.lt(contrib[5]);
      // icbm contrib
      const contrib3 = await etoCommitment.calculateContribution(investors[0], true, amount);
      expect(contrib3[4]).to.be.bignumber.eq(contrib[4]);
      expect(contrib3[5]).to.be.bignumber.eq(0);
    });

    it("should calculate contribution in whitelist with discounts", async () => {
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(0)], [Q18.mul(1)], {
        from: admin,
      });
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const amount = Q18.mul("87219.291");
      const contrib = await etoCommitment.calculateContribution(investors[0], false, amount);
      expect(contrib[0]).to.be.true;
      expect(contrib[1]).to.be.true;
      expect(contrib[2]).to.be.bignumber.eq(etoTermsDict.MIN_TICKET_EUR_ULPS);
      // returns public max ticket
      expect(contrib[3]).to.be.bignumber.eq(etoTermsDict.MAX_TICKET_EUR_ULPS);
      // always round down in equity token calc
      const equityAmount = amount.mul(getTokenPower()).divToInt(dp);
      expect(contrib[4]).to.be.bignumber.eq(equityAmount);
      const neuAmount = investorShare(await neumark.incremental(amount));
      expect(contrib[5]).to.be.bignumber.eq(neuAmount);
      expect(contrib[6]).to.be.false;
      // not on the whitelist
      const contrib2 = await etoCommitment.calculateContribution(investors[1], false, amount);
      expect(contrib2[0]).to.be.false;
      // icbm
      const contrib3 = await etoCommitment.calculateContribution(investors[1], true, amount);
      expect(contrib3[0]).to.be.true;
      expect(contrib3[4]).to.be.bignumber.eq(equityAmount);
    });

    it("calculate contribution in whitelist when fixed slots", async () => {
      const discount = Q18.mul("0.428337298");
      const fixedAmount = Q18.mul(20000);
      const overMaxTicket = etoTermsDict.MAX_TICKET_EUR_ULPS.add(10000);
      await etoTerms.addWhitelisted(
        [investors[0], investors[1]],
        [fixedAmount, overMaxTicket],
        [Q18.sub(discount), Q18],
        {
          from: admin,
        },
      );

      const tokenPower = getTokenPower();
      const slotPrice = discountedPrice(tokenTermsDict.TOKEN_PRICE_EUR_ULPS, discount);
      const contrib = await etoCommitment.calculateContribution(investors[0], false, fixedAmount);
      expect(contrib[0]).to.be.true;
      expect(contrib[1]).to.be.true;
      expect(contrib[2]).to.be.bignumber.eq(etoTermsDict.MIN_TICKET_EUR_ULPS);
      // returns public max ticket
      expect(contrib[3]).to.be.bignumber.eq(etoTermsDict.MAX_TICKET_EUR_ULPS);
      // always round down in equity token calc
      const equityAmount = fixedAmount.mul(tokenPower).divToInt(slotPrice);
      expect(contrib[4]).to.be.bignumber.eq(equityAmount);
      const neuAmount = investorShare(await neumark.incremental(fixedAmount));
      expect(contrib[5]).to.be.bignumber.eq(neuAmount);
      expect(contrib[6]).to.be.false;
      const contrib2 = await etoCommitment.calculateContribution(investors[1], false, fixedAmount);
      // has a special deal for max ticket
      expect(contrib2[3]).to.be.bignumber.eq(overMaxTicket);
      // invests partially from slot partially from wl
      const contrib3 = await etoCommitment.calculateContribution(
        investors[0],
        false,
        fixedAmount.mul(2),
      );
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const mixedPrice = calculateMixedTranchePrice(fixedAmount.mul(2), fixedAmount, slotPrice, dp);
      // use HALF_UP as this is approximate high precision price
      const mixedEquityAmount = fixedAmount
        .mul(2)
        .mul(tokenPower)
        .div(mixedPrice)
        .round(0, 4);
      expect(contrib3[4]).to.be.bignumber.eq(mixedEquityAmount);
    });

    it("should set max cap flag exceeded in whitelist and public", async () => {
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(0)], [Q18.mul(1)], {
        from: admin,
      });
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const wlMaxCap = tokensCostEur(tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST, dp);
      const wlContrib = await etoCommitment.calculateContribution(investors[0], false, wlMaxCap);
      expect(wlContrib[6]).to.be.false;
      const wlContrib2 = await etoCommitment.calculateContribution(
        investors[0],
        false,
        wlMaxCap.add(dp),
      );
      expect(wlContrib2[6]).to.be.true;
      const discountedTokens = tokenTermsDict.EQUITY_TOKENS_PER_SHARE;
      await investAmount(investors[0], tokensCostEur(discountedTokens, dp), "EUR");
      await skipTimeTo(publicStartDate.add(1));
      const maxTokens = getMaxAvailableTokens(tokenTermsDict.MAX_NUMBER_OF_TOKENS).sub(
        discountedTokens,
      );
      const maxCap = tokensCostEur(maxTokens, tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
      const contrib = await etoCommitment.calculateContribution(investors[0], false, maxCap);
      expect(contrib[6]).to.be.false;
      const contrib2 = await etoCommitment.calculateContribution(
        investors[0],
        false,
        maxCap.add(tokenTermsDict.TOKEN_PRICE_EUR_ULPS),
      );
      expect(contrib2[6]).to.be.true;
    });

    it("should set max cap flag exceeded in whitelist max cap over max available tokens", async () => {
      // set WL max cap slightly more than available tokens
      const maxAvailableTokens = getMaxAvailableTokens(tokenTermsDict.MAX_NUMBER_OF_TOKENS);
      const feeTokens = tokenTermsDict.MAX_NUMBER_OF_TOKENS.sub(maxAvailableTokens);
      await deployETO({
        ovrTokenTerms: {
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: maxAvailableTokens.add(feeTokens.divToInt(2)),
        },
      });
      await prepareETOForPublic();
      await etoTerms.addWhitelisted([investors[0]], [Q18.mul(0)], [Q18.mul(1)], {
        from: admin,
      });
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const wlMaxCap = tokensCostEur(maxAvailableTokens, dp);
      const wlContrib = await etoCommitment.calculateContribution(investors[0], false, wlMaxCap);
      expect(wlContrib[6]).to.be.false;
      const wlContrib2 = await etoCommitment.calculateContribution(
        investors[0],
        false,
        wlMaxCap.add(dp),
      );
      expect(wlContrib2[6]).to.be.true;
    });

    it("max cap flag exceeded should be not be set if within fixed slot", async () => {
      await etoTerms.addWhitelisted(
        [investors[0], investors[1]],
        [Q18.mul(15000000), 0],
        [Q18.mul(1), Q18.mul(1)],
        {
          from: admin,
        },
      );
      // in whitelist
      const dp = discountedPrice(
        tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
        etoTermsDict.WHITELIST_DISCOUNT_FRAC,
      );
      const wlMaxCap = tokensCostEur(tokenTermsDict.MAX_NUMBER_OF_TOKENS_IN_WHITELIST, dp);
      // investor 0 must be able to invest over whitelist max cap because he has slot > this cap
      const wlContrib2 = await etoCommitment.calculateContribution(
        investors[0],
        false,
        wlMaxCap.add(dp),
      );
      expect(wlContrib2[6]).to.be.false;
      // whitelist investor without fixed slots is not allowed to do that
      const wlContrib = await etoCommitment.calculateContribution(
        investors[1],
        false,
        wlMaxCap.add(dp),
      );
      expect(wlContrib[6]).to.be.true;
      // same for icbm investor
      const wlContrib3 = await etoCommitment.calculateContribution(
        investors[2],
        true,
        wlMaxCap.add(dp),
      );
      expect(wlContrib3[6]).to.be.true;
      // now fixed slot investor invests but this does not count into wl cap
      await investAmount(investors[0], wlMaxCap.add(dp), "EUR");
      const wlContrib4 = await etoCommitment.calculateContribution(investors[1], false, wlMaxCap);
      expect(wlContrib4[6]).to.be.false;
      // but when regular wl invests the cap is expired
      await investAmount(investors[1], wlMaxCap, "EUR");
      const wlContrib5 = await etoCommitment.calculateContribution(
        investors[1],
        false,
        etoTermsDict.MIN_TICKET_EUR_ULPS,
      );
      expect(wlContrib5[6]).to.be.true;
      // but not for fixed slot
      const wlContrib6 = await etoCommitment.calculateContribution(
        investors[0],
        false,
        etoTermsDict.MIN_TICKET_EUR_ULPS,
      );
      expect(wlContrib6[6]).to.be.false;
    });

    it("should overwrite max ticket for fixed slots", async () => {
      const fixedAmount = Q18.mul(20000);
      const overMaxTicket = etoTermsDict.MAX_TICKET_EUR_ULPS.add(10000);
      await etoTerms.addWhitelisted([investors[1]], [overMaxTicket], [Q18], {
        from: admin,
      });
      const contrib = await etoCommitment.calculateContribution(investors[1], false, fixedAmount);
      expect(contrib[3]).to.be.bignumber.eq(overMaxTicket);
    });

    it("should overwrite min ticket for fixed slots", async () => {
      const fixedAmount = Q18.mul(20000);
      const underMinTicket = etoTermsDict.MIN_TICKET_EUR_ULPS.sub(10000);
      await etoTerms.addWhitelisted([investors[1]], [underMinTicket], [Q18], {
        from: admin,
      });
      const contrib = await etoCommitment.calculateContribution(investors[1], false, fixedAmount);
      expect(contrib[2]).to.be.bignumber.eq(underMinTicket);
      await identityRegistry.setClaims(investors[1], "0x0", toBytes32("0x1"), { from: admin });
    });

    it("should return non eligible on non-kyc, frozen, reg-d investor", async () => {
      let contrib = await etoCommitment.calculateContribution(investors[1], false, Q18);
      expect(contrib[1]).to.be.false;

      // verify account
      await identityRegistry.setClaims(investors[1], "0x0", toBytes32("0x1"), { from: admin });
      contrib = await etoCommitment.calculateContribution(investors[1], false, Q18);
      expect(contrib[1]).to.be.true;

      // freeze account
      await identityRegistry.setClaims(investors[1], toBytes32("0x1"), toBytes32("0x9"), {
        from: admin,
      });
      contrib = await etoCommitment.calculateContribution(investors[1], false, Q18);
      expect(contrib[1]).to.be.false;

      // next account
      contrib = await etoCommitment.calculateContribution(investors[2], false, Q18);
      expect(contrib[1]).to.be.false;

      // verify account
      await identityRegistry.setClaims(investors[2], "0x0", toBytes32("0x1"), { from: admin });
      contrib = await etoCommitment.calculateContribution(investors[2], false, Q18);
      expect(contrib[1]).to.be.true;

      // add under reg-d
      await identityRegistry.setClaims(investors[2], toBytes32("0x1"), toBytes32("0x11"), {
        from: admin,
      });
      contrib = await etoCommitment.calculateContribution(investors[2], false, Q18);
      expect(contrib[1]).to.be.false;

      // add valid certificate
      await identityRegistry.setClaims(investors[2], toBytes32("0x11"), toBytes32("0x31"), {
        from: admin,
      });
      contrib = await etoCommitment.calculateContribution(investors[2], false, Q18);
      expect(contrib[1]).to.be.false;
    });

    it("should calculate as public in Setup, Signing and later states");
  });

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
            from: admin,
          },
        );
        startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
        startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
        await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
          from: company,
        });
        // skip time to after start date to test state machine
        await skipTimeTo(startDate.add(10));
        expect(await etoCommitment.timedState.call()).to.be.bignumber.eq(CommitmentState.Whitelist);
        let tx = await etoCommitment.handleStateTransitions();
        // actual block time and startDate may differ slightly
        expectLogStateTransition(tx, CommitmentState.Setup, CommitmentState.Whitelist, startDate);
        const whitelistTs = new web3.BigNumber(await latestTimestamp());
        // we should be in whitelist state now
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Whitelist);
        // we should have correct state times
        durTable = defaultDurationTable();
        const publicStartOf = startDate.add(durTable[CommitmentState.Whitelist]);
        await expectStateStarts(
          { Whitelist: startDate, Public: publicStartOf, Refund: 0 },
          durTable,
        );
        // whitelist timestamp should come at least 10 seconds after startDate
        expect(whitelistTs.sub(startDate)).to.be.bignumber.gte(10);
        // token controller should be in offering state and have empty cap table and shareholder information
        expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Offering);
        const tokens = await equityTokenController.tokens();
        expect(tokens[0].length).to.eq(0);
        expect(tokens[1].length).to.eq(0);

        expect(await equityTokenController.tokenOfferings()).to.deep.eq([[], []]);

        const generalInfo = await equityTokenController.shareholderInformation();
        expect(generalInfo[0]).to.be.bignumber.eq(0);
        expect(generalInfo[1]).to.be.bignumber.eq(0);
        expect(generalInfo[2]).to.eq(ZERO_ADDRESS);
        expect(generalInfo[1]).to.be.bignumber.eq(0);
        // apply whitelist general discount, fixed slots not tested here
        const dp = discountedPrice(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          etoTermsDict.WHITELIST_DISCOUNT_FRAC,
        );
        // invest some
        await investAmount(investors[0], Q18.add(1), "ETH", dp);
        await investAmount(investors[0], Q18.mul("1.1289791").sub(1), "ETH", dp);
        await investAmount(investors[1], Q18.mul("0.9528763"), "ETH", dp);
        await investAmount(investors[0], Q18.mul("30876.18912"), "EUR", dp);
        publicStartDate = startDate.add(durTermsDict.WHITELIST_DURATION);
        // console.log(new Date(publicStartDate * 1000));
        await skipTimeTo(publicStartDate.add(1));
        expect(await etoCommitment.timedState.call()).to.be.bignumber.eq(CommitmentState.Public);
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
        await investAmount(investors[1], Q18.mul("130876.61721"), "EUR", tokenprice);
        // out of whitelist
        await investAmount(investors[2], Q18.mul("1500.1721"), "ETH", tokenprice);
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
          let missingAmount = tokensCostEur(missingTokens, tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
          if (missingAmount.lt(etoTermsDict.MIN_TICKET_EUR_ULPS)) {
            missingAmount = etoTermsDict.MIN_TICKET_EUR_ULPS;
          }
          // console.log(`min cap investment: ${missingTokens} ${missingAmount} EUR`);
          await investAmount(investors[4], missingAmount.add(1), "EUR", tokenprice);
        }
        // go to signing
        await skipTimeTo(signingStartOf.add(1));
        expect(await etoCommitment.timedState.call()).to.be.bignumber.eq(CommitmentState.Signing);
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
        const contribution = await expectValidSigningState(investors, {
          expectedInvestorsCount: 5,
        });
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

        // token offerings available
        expect(await equityTokenController.tokenOfferings()).to.deep.eq([
          [etoCommitment.address],
          [equityToken.address],
        ]);

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
        expect(await etoCommitment.timedState.call()).to.be.bignumber.eq(CommitmentState.Payout);
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
      it("mixed currency with fixed slots and successful");
      it("mixed currency and refunded");
      it("mixed currency with fixed slots and refunded");
      it("ether only and successful");
      it("euro only and successful");
      it("with min cap empty commitment");
    });

    describe("with LockedAccount", () => {
      beforeEach(async () => {
        await deployLockedAccounts();
        await deployETO();
      });

      it("mixed currency and successful", async () => {
        await createLockedAccounts(investors.slice(0, 5));
        await prepareETOForPublic();
        await etoCommitment.handleStateTransitions();
        // apply whitelist general discount, fixed slots not tested here
        const dp = discountedPrice(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          etoTermsDict.WHITELIST_DISCOUNT_FRAC,
        );
        // invest from ICBM contract
        await investICBMAmount(investors[0], Q18.add(1), "ETH", dp);
        await investICBMAmount(investors[0], Q18.mul("7.87261621").sub(1), "ETH", dp);
        await investICBMAmount(investors[1], Q18.mul("34.098171"), "ETH", dp);
        await investICBMAmount(investors[0], Q18.mul("73692.76198871").add(1), "EUR", dp);
        await skipTimeTo(publicStartDate.add(1));
        await etoCommitment.handleStateTransitions();
        // we have constant price in this use case - no discounts
        const tokenprice = tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
        // invest so we have min cap
        await investICBMAmount(investors[1], Q18.mul("611527.8172891"), "EUR", tokenprice);
        // out of whitelist
        await investICBMAmount(investors[2], Q18.mul("417.817278172"), "ETH", tokenprice);
        await investICBMAmount(
          investors[3],
          etoTermsDict.MAX_TICKET_EUR_ULPS.div(2),
          "EUR",
          tokenprice,
        );
        await investICBMAmount(investors[4], Q18.mul(1000).sub(1), "EUR", tokenprice);
        // must still be public
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
        const totalInvestment = await etoCommitment.totalInvestment();
        // we must cross MIN CAP
        if (tokenTermsDict.MIN_NUMBER_OF_TOKENS.gt(totalInvestment[1])) {
          const missingTokens = tokenTermsDict.MIN_NUMBER_OF_TOKENS.sub(totalInvestment[1]);
          let missingAmount = tokensCostEur(missingTokens, tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
          if (missingAmount.lt(etoTermsDict.MIN_TICKET_EUR_ULPS)) {
            missingAmount = etoTermsDict.MIN_TICKET_EUR_ULPS;
          }
          // console.log(`min cap investment: ${missingTokens} ${missingAmount} EUR`);
          await investICBMAmount(investors[4], missingAmount.add(1), "EUR", tokenprice);
        }
        const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
        // go to signing
        const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
        await skipTimeTo(signingStartOf.add(1));
        await etoCommitment.handleStateTransitions();
        // check various total before signing
        const contribution = await expectValidSigningState(investors, {
          expectedInvestorsCount: 5,
          icbmEurEquiv,
        });
        const nomineeSignTx = await signInvestmentAgreement();
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
        await prepareETOForPublic();
        await etoCommitment.handleStateTransitions();
        // apply whitelist general discount, fixed slots not tested here
        const dp = discountedPrice(
          tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          etoTermsDict.WHITELIST_DISCOUNT_FRAC,
        );
        // invest from ICBM contract
        await investICBMAmount(investors[0], Q18, "ETH", dp);
        await investICBMAmount(investors[1], Q18.mul(73692.76198871), "EUR", dp);
        await investICBMAmount(investors[2], Q18.mul(367.7162812), "ETH", dp);
        const refundStartDate = startDate
          .add(durTermsDict.WHITELIST_DURATION)
          .add(durTermsDict.PUBLIC_DURATION);
        await skipTimeTo(refundStartDate.add(1));
        // timed state shows what the state should be
        expect(await etoCommitment.timedState.call()).to.be.bignumber.eq(CommitmentState.Refund);
        // state shows state as in storage
        expect(await etoCommitment.state.call()).to.be.bignumber.eq(CommitmentState.Whitelist);
        // now move the state
        const refundTx = await etoCommitment.handleStateTransitions();
        // all funds from icbm didnt generate NEU -> pass this information so NEU check below will work
        const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
        await expectValidRefundState(refundTx, participatingInvestors, icbmEurEquiv);
        await refundInvestor(investors[0]);
        await refundMultipleInvestors(participatingInvestors.slice(1));
        await expectNoICBMPendingCommitments(participatingInvestors);
        await expectICBMFullWallets(participatingInvestors);
      });

      it("ether only and successful");
      it("euro only and successful");
    });

    describe("with LockedAccount and new money", () => {
      beforeEach(async () => {
        await deployLockedAccounts();
        await deployETO({ ovrETOTerms: { MAX_TICKET_EUR_ULPS: Q18.mul(15000000) } });
        await prepareETOForPublic();
      });

      async function refundCase(investmentFunc) {
        const participatingInvestors = investors.slice(0, 4);
        const icbmInvestors = investors.slice(0, 2);
        const regularInvestors = investors.slice(2, 4);
        // 3rd investor does not participate in icbm
        await createLockedAccounts(icbmInvestors);
        const icbmEurEquiv = await investmentFunc(regularInvestors, icbmInvestors);
        // refund
        await increaseTime(durTermsDict.PUBLIC_DURATION.toNumber());
        const refundTx = await etoCommitment.handleStateTransitions();
        await expectValidRefundState(refundTx, participatingInvestors, icbmEurEquiv);
        await refundInvestor(participatingInvestors[0]);
        await refundMultipleInvestors(participatingInvestors.slice(1));
        await expectNoICBMPendingCommitments(icbmInvestors);
        await expectICBMFullWallets(icbmInvestors);
      }

      async function claimCase(investmentFunc) {
        const participatingInvestors = investors.slice(0, 4);
        const icbmInvestors = investors.slice(0, 2);
        const regularInvestors = investors.slice(2, 4);
        // 3rd investor does not participate in icbm
        await createLockedAccounts(icbmInvestors);
        const icbmEurEquiv = await investmentFunc(regularInvestors, icbmInvestors);
        // switch to signing
        expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Public);
        const totalInvestment = await etoCommitment.totalInvestment();
        // we must cross MIN CAP
        const wasEurUsed = (await euroToken.balanceOf(etoCommitment.address)).gt(0);
        const wasEthUsed = (await etherToken.balanceOf(etoCommitment.address)).gt(0);
        if (tokenTermsDict.MIN_NUMBER_OF_TOKENS.gt(totalInvestment[1])) {
          const missingTokens = tokenTermsDict.MIN_NUMBER_OF_TOKENS.sub(totalInvestment[1]);
          let missingAmount = tokensCostEur(missingTokens, tokenTermsDict.TOKEN_PRICE_EUR_ULPS);
          if (missingAmount.lt(etoTermsDict.MIN_TICKET_EUR_ULPS)) {
            missingAmount = etoTermsDict.MIN_TICKET_EUR_ULPS;
          }
          // console.log(`min cap investment: ${missingTokens} ${missingAmount} EUR`);
          // check if finalize with ETH or EUR
          if (wasEurUsed) {
            await investAmount(regularInvestors[0], missingAmount.add(1), "EUR");
          } else {
            await investAmount(regularInvestors[0], eurToEth(missingAmount.add(1)), "ETH");
          }
        }
        // go to signing
        const signingStartOf = publicStartDate.add(durTable[CommitmentState.Public]);
        await skipTimeTo(signingStartOf.add(1));
        await etoCommitment.handleStateTransitions();
        // check various total before signing, all participatingInvestors must really participated in investmentFunc
        const contribution = await expectValidSigningState(participatingInvestors, {
          icbmEurEquiv,
        });
        const nomineeSignTx = await signInvestmentAgreement();
        const claimTs = new web3.BigNumber(await latestTimestamp());
        const payoutStartOf = claimTs.add(durTable[CommitmentState.Claim]);
        await expectValidClaimState(nomineeSignTx, contribution);
        await claimInvestor(participatingInvestors[0]);
        await claimMultipleInvestors(participatingInvestors.slice(1));
        await expectNoICBMPendingCommitments(icbmInvestors);
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
        await expectValidPayoutState(tx, contribution, {
          expectsEther: wasEthUsed,
          expectsEuro: wasEurUsed,
        });
        await expectValidPayoutStateFullClaim(tx);
      }

      it("should mix icbm and new money and refund", async () => {
        async function investment(regularInvestors, icbmInvestors) {
          const dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            etoTermsDict.WHITELIST_DISCOUNT_FRAC,
          );
          await investICBMAmount(icbmInvestors[0], Q18.mul(100), "ETH", dp);
          await investICBMAmount(icbmInvestors[0], Q18.mul(500), "EUR", dp);
          await investICBMAmount(icbmInvestors[1], Q18.mul(78197.121).add(1), "EUR", dp);
          const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
          await skipTimeTo(publicStartDate.add(1));
          // same amounts in public
          await investAmount(
            icbmInvestors[0],
            Q18.mul(100),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            icbmInvestors[0],
            Q18.mul(500),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            regularInvestors[0],
            Q18.mul(621).sub(1),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );

          return icbmEurEquiv;
        }
        await refundCase(investment);
        // investor must have funds back in the tokens
        expect(await euroToken.balanceOf(investors[0])).to.be.bignumber.eq(Q18.mul(500));
        expect(await etherToken.balanceOf(investors[0])).to.be.bignumber.eq(Q18.mul(100));
        // withdraw ether
        await etherToken.withdraw(Q18.mul(100), { from: investors[0] });
      });

      it("should mix icbm, slots and new money and refund", async () => {
        async function investment(regularInvestors, icbmInvestors) {
          // allow to cross max cap from whitelist (fixed-slot)
          await etoTerms.addWhitelisted(
            [icbmInvestors[0], icbmInvestors[1], regularInvestors[0]],
            [Q18.mul(10000), Q18.mul(0), Q18.mul(16000)],
            [Q18.mul(0.4), Q18.mul(1), Q18.mul(0.3)],
            {
              from: admin,
            },
          );
          const dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            etoTermsDict.WHITELIST_DISCOUNT_FRAC,
          );
          const icbmInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul(0.4)),
          );
          // first icbm so we can measure euro
          await investICBMAmount(icbmInvestors[0], Q18.mul(10), "ETH", icbmInvestor0Dp);
          await investICBMAmount(icbmInvestors[1], Q18.mul(172).add(1), "ETH", dp);
          const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
          // 10000 from slot, 2000 from wl, then icbm
          const inv02Balance = (await etoCommitment.investorTicket(icbmInvestors[0]))[0];
          await investAmount(
            icbmInvestors[0],
            Q18.mul(10000).sub(inv02Balance),
            "EUR",
            icbmInvestor0Dp,
          );
          await investAmount(icbmInvestors[0], Q18.mul(2000), "EUR", dp);
          // whitelist and icbm
          const regularInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul(0.3)),
          );
          const expectedPrice = calculateMixedTranchePrice(
            Q18.mul(78197.121).add(1),
            Q18.mul(16000),
            regularInvestor0Dp,
            dp,
          );
          await investAmount(regularInvestors[0], Q18.mul(78197.121).add(1), "EUR", expectedPrice);
          //
          await skipTimeTo(publicStartDate.add(1));
          // same amounts in public
          await investAmount(
            regularInvestors[0],
            Q18.mul(100),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            icbmInvestors[0],
            Q18.mul(500),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            regularInvestors[1],
            Q18.mul(621).sub(1),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );

          return icbmEurEquiv;
        }
        await refundCase(investment);
      });

      it("should mix icbm and new money and claim", async () => {
        async function investment(regularInvestors, icbmInvestors) {
          const dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            etoTermsDict.WHITELIST_DISCOUNT_FRAC,
          );
          await investICBMAmount(icbmInvestors[0], Q18.mul(76.1271), "ETH", dp);
          await investICBMAmount(icbmInvestors[0], Q18.mul(501).sub(1), "EUR", dp);
          await investICBMAmount(icbmInvestors[1], Q18.mul(78197.121162).add(1), "EUR", dp);
          const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
          await skipTimeTo(publicStartDate.add(1));
          // same amounts in public
          await investAmount(
            icbmInvestors[0],
            Q18.mul(330.1),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            icbmInvestors[0],
            Q18.mul(500),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            regularInvestors[0],
            Q18.mul(621).sub(1),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            regularInvestors[1],
            Q18.mul(728).add(1),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );

          return icbmEurEquiv;
        }
        await claimCase(investment);
      });

      it("should mix icbm, slots and new money and refund", async () => {
        async function investment(regularInvestors, icbmInvestors) {
          // allow to cross max cap from whitelist (fixed-slot)
          await etoTerms.addWhitelisted(
            [icbmInvestors[0], icbmInvestors[1], regularInvestors[0]],
            [Q18.mul(10000), Q18.mul(0), Q18.mul(16000)],
            [Q18.mul(0.4), Q18.mul(1), Q18.mul(0.3)],
            {
              from: admin,
            },
          );
          const dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            etoTermsDict.WHITELIST_DISCOUNT_FRAC,
          );
          const icbmInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul(0.4)),
          );
          // first icbm so we can measure euro
          await investICBMAmount(icbmInvestors[0], Q18.mul(10), "ETH", icbmInvestor0Dp);
          await investICBMAmount(icbmInvestors[1], Q18.mul(172).add(1), "ETH", dp);
          const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
          // 10000 from slot, 2000 from wl, then icbm
          const inv02Balance = (await etoCommitment.investorTicket(icbmInvestors[0]))[0];
          await investAmount(
            icbmInvestors[0],
            Q18.mul(10000).sub(inv02Balance),
            "EUR",
            icbmInvestor0Dp,
          );
          await investAmount(icbmInvestors[0], Q18.mul(2000), "EUR", dp);
          // whitelist and icbm
          const regularInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul(0.3)),
          );
          const expectedPrice = calculateMixedTranchePrice(
            Q18.mul(78197.121).add(1),
            Q18.mul(16000),
            regularInvestor0Dp,
            dp,
          );
          await investAmount(regularInvestors[0], Q18.mul(78197.121).add(1), "EUR", expectedPrice);
          //
          await skipTimeTo(publicStartDate.add(1));
          // same amounts in public
          await investAmount(
            regularInvestors[0],
            Q18.mul(100),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            icbmInvestors[0],
            Q18.mul(500),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            regularInvestors[1],
            Q18.mul(621).sub(1),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );

          return icbmEurEquiv;
        }
        await claimCase(investment);
      });

      it("ether only and successful", async () => {
        async function investment(regularInvestors, icbmInvestors) {
          // allow to cross max cap from whitelist (fixed-slot)
          const inv0FixedSlot = Q18.mul(10000);
          const ethPrice = "100";
          await etoTerms.addWhitelisted(
            [icbmInvestors[0], icbmInvestors[1], regularInvestors[0]],
            [inv0FixedSlot, Q18.mul(0), Q18.mul(16000)],
            [Q18.mul("0.4"), Q18.mul(1), Q18.mul("0.3")],
            {
              from: admin,
            },
          );
          const dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            etoTermsDict.WHITELIST_DISCOUNT_FRAC,
          );
          const icbmInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul(0.4)),
          );
          // set round exchange rate to minimize rounding errors
          // set some round ETH price to minimize rounding errors in the contract
          await gasExchange.setExchangeRate(
            etherToken.address,
            euroToken.address,
            Q18.mul(ethPrice),
            {
              from: admin,
            },
          );
          // first icbm so we can measure euro
          await investICBMAmount(icbmInvestors[0], Q18.mul(10), "ETH", icbmInvestor0Dp);
          await investICBMAmount(icbmInvestors[1], Q18.mul(172).add(1), "ETH", dp);
          const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
          // invest remaining slot
          const inv0Balance = (await etoCommitment.investorTicket(icbmInvestors[0]))[0];
          await investAmount(
            icbmInvestors[0],
            eurToEth(inv0FixedSlot.sub(inv0Balance), ethPrice),
            "ETH",
            icbmInvestor0Dp,
          );
          // fixed slot must be exactly filled, otherwise next test will not pass
          expect((await etoCommitment.investorTicket(icbmInvestors[0]))[0]).to.be.bignumber.eq(
            inv0FixedSlot,
          );
          // 10000 from slot, 2000 from wl, then icbm
          await investAmount(icbmInvestors[0], eurToEth(Q18.mul(2000), ethPrice), "ETH", dp);
          // whitelist and icbm
          const regularInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul("0.3")),
          );
          // we used Q18.mul("78197.121").add(1) but that caused rounding error due to
          // eth 1/100 eur rate rounding conversion that was losing that 1 wei
          // this two tranche price must exactly overlap with smart contract to a single wei
          const expectedPrice = calculateMixedTranchePrice(
            Q18.mul("78197.121"),
            Q18.mul(16000),
            regularInvestor0Dp,
            dp,
          );
          await investAmount(
            regularInvestors[0],
            eurToEth(Q18.mul("78197.121"), ethPrice),
            "ETH",
            expectedPrice,
          );
          // this will reset eth price to default
          await skipTimeTo(publicStartDate.add(1));
          // same amounts in public
          await investAmount(
            regularInvestors[0],
            Q18.mul("872.182").add(1),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            icbmInvestors[0],
            Q18.mul("212.21982"),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            regularInvestors[1],
            Q18.mul("1210").sub(1),
            "ETH",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );

          expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);

          return icbmEurEquiv;
        }
        await claimCase(investment);
      });

      it("euro only and successful", async () => {
        async function investment(regularInvestors, icbmInvestors) {
          // allow to cross max cap from whitelist (fixed-slot)
          await etoTerms.addWhitelisted(
            [icbmInvestors[0], regularInvestors[0]],
            [Q18.mul("10000"), Q18.mul("16000")],
            [Q18.mul("0.4"), Q18.mul("0.3")],
            {
              from: admin,
            },
          );
          const dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            etoTermsDict.WHITELIST_DISCOUNT_FRAC,
          );
          const icbmInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul("0.4")),
          );
          // first icbm so we can measure euro
          await investICBMAmount(icbmInvestors[0], Q18.mul("7611").add(1), "EUR", icbmInvestor0Dp);
          const icbmEurEquiv = (await etoCommitment.totalInvestment())[0];
          const inv02Balance = (await etoCommitment.investorTicket(icbmInvestors[0]))[0];
          await investAmount(
            icbmInvestors[0],
            Q18.mul(10000).sub(inv02Balance),
            "EUR",
            icbmInvestor0Dp,
          );
          await investAmount(icbmInvestors[0], Q18.mul(2000), "EUR", dp);
          // whitelist and icbm
          const regularInvestor0Dp = discountedPrice(
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
            Q18.sub(Q18.mul("0.3")),
          );
          const expectedPrice = calculateMixedTranchePrice(
            Q18.mul("58200.121").add(1),
            Q18.mul("16000"),
            regularInvestor0Dp,
            dp,
          );
          await investAmount(
            regularInvestors[0],
            Q18.mul("58200.121").add(1),
            "EUR",
            expectedPrice,
          );
          //
          await skipTimeTo(publicStartDate.add(1));
          // same amounts in public
          await investAmount(
            regularInvestors[0],
            Q18.mul("872.182").add(1),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            icbmInvestors[1],
            Q18.mul("1212.21982"),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );
          await investAmount(
            regularInvestors[1],
            Q18.mul("1211").sub(1),
            "EUR",
            tokenTermsDict.TOKEN_PRICE_EUR_ULPS,
          );

          return icbmEurEquiv;
        }
        await claimCase(investment);
      });
    });
  });

  function eurToEth(amount, price) {
    // compute inverse rate
    const invRateQ18 = Q18.div(price || defEthPrice).round(0, 4);
    // use inv rate to convert eur to eth, when feed to smart contract which uses
    // eth to eur conversion and normal rate, rounding should match
    return divRound(amount.mul(invRateQ18), Q18);
  }

  // helper functions here
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

  async function expectValidInvestorClaim(tx, investor) {
    const ticket = await etoCommitment.investorTicket(investor);
    expect(ticket[8]).to.be.true;
    expectLogTokensClaimed(tx, 0, investor, ticket[2], ticket[1]);
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
      expect(await etherToken.balanceOf(investor)).to.be.bignumber.eq(ticket[6]);
      expect(await euroToken.balanceOf(investor)).to.be.bignumber.eq(ticket[7]);
    }
  }

  async function deployETOTermsConstraintsUniverse(args = {}) {
    const [constraints] = await deployETOTermsConstraints(ETOTermsConstraints, args);

    // add the constraints to the universe
    await universe.setCollectionsInterfaces(
      [knownInterfaces.etoTermsConstraints],
      [constraints.address],
      [true],
      { from: admin },
    );

    return constraints;
  }

  async function deployETO(options) {
    const opts = Object.assign({ ovrArtifact: ETOCommitment }, options);
    // deploy ETO Terms: here deployment of single ETO contracts start
    [shareholderRights] = await deployShareholderRights(
      ShareholderRights,
      opts.ovrShareholderRights,
    );
    [durationTerms, durTermsDict] = await deployDurationTerms(ETODurationTerms, opts.ovrDurations);
    [tokenTerms, tokenTermsDict] = await deployTokenTerms(ETOTokenTerms, opts.ovrTokenTerms);
    etoTermsConstraints = await deployETOTermsConstraintsUniverse(opts.ovrETOTermsConstraints);
    // save and verfiy tokenofferingoperator
    tokenOfferingOperator = await etoTermsConstraints.TOKEN_OFFERING_OPERATOR();
    const oldClaims = await identityRegistry.getClaims(tokenOfferingOperator);
    await identityRegistry.setClaims(tokenOfferingOperator, oldClaims, toBytes32(web3.toHex(1)), {
      from: admin,
    });

    [etoTerms, etoTermsDict] = await deployETOTerms(
      universe,
      ETOTerms,
      durationTerms,
      tokenTerms,
      shareholderRights,
      etoTermsConstraints,
      opts.ovrETOTerms,
    );
    // deploy ETOCommitment
    etoCommitment = await opts.ovrArtifact.new(
      universe.address,
      nominee,
      company,
      etoTerms.address,
    );
    // deploy equity token
    if (opts.ovrEquityToken) {
      // if keeping old equity token, keep old token controller
      equityToken = opts.ovrEquityToken;
      // prepare token controller for follow on ETO
      const resolutionId = getCommitmentResolutionId(etoCommitment.address);
      await equityTokenController.startNewOffering(resolutionId, etoCommitment.address, {
        from: company,
      });
    } else {
      equityTokenController = await SingleEquityTokenController.new(
        universe.address,
        company,
        etoCommitment.address,
      );
      equityToken = await EquityToken.new(
        universe.address,
        equityTokenController.address,
        tokenTerms.address,
        nominee,
        company,
      );
    }

    // add ETO contracts to collections in universe in one transaction -> must be atomic
    await universe.setCollectionsInterfaces(
      [
        knownInterfaces.commitmentInterface,
        knownInterfaces.termsInterface,
        knownInterfaces.equityTokenInterface,
        knownInterfaces.equityTokenControllerInterface,
      ],
      [etoCommitment.address, etoTerms.address, equityToken.address, equityTokenController.address],
      [true, true, true, true],
      { from: admin },
    );

    // nominee sets legal agreements
    await equityToken.amendAgreement("AGREEMENT#HASH", { from: nominee });
    await etoCommitment.amendAgreement("AGREEMENT#HASH", { from: nominee });
    // neu token manager allows ETOCommitment to issue NEU, admin gets whitelist rights
    await createAccessPolicy(accessPolicy, [
      { role: roles.neumarkIssuer, object: neumark.address, subject: etoCommitment.address },
      { role: roles.whitelistAdmin, object: etoTerms.address, subject: admin },
    ]);
    // nominee is verified
    const oldNomineeClaims = await identityRegistry.getClaims(nominee);
    await identityRegistry.setClaims(nominee, oldNomineeClaims, toBytes32(web3.toHex(1)), {
      from: admin,
    });
    // company is verified
    const oldCompanyClaims = await identityRegistry.getClaims(company);
    await identityRegistry.setClaims(company, oldCompanyClaims, toBytes32(web3.toHex(1)), {
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
      tokenOfferingOperator,
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

  async function prepareETOForPublic() {
    startDate = new web3.BigNumber((await latestTimestamp()) + dayInSeconds);
    startDate = startDate.add(await etoTermsConstraints.DATE_TO_WHITELIST_MIN_DURATION());
    await etoCommitment.setStartDate(etoTerms.address, equityToken.address, startDate, {
      from: company,
    });
    durTable = defaultDurationTable();
    // skip time to after start date to test state machine
    await skipTimeTo(startDate.add(10));
    publicStartDate = startDate.add(durTermsDict.WHITELIST_DURATION);
  }

  async function moveETOToClaim(expectedInvestorsCount, icbmEurEquiv) {
    const investmentAgreementUrl = "ipfs:3290890ABINVESTMENT";
    await etoCommitment.companySignsInvestmentAgreement(investmentAgreementUrl, {
      from: company,
    });
    const contribution = await expectValidSigningState(investors, {
      expectedInvestorsCount,
      icbmEurEquiv,
    });
    // nominee signs
    const nomineeSignTx = await etoCommitment.nomineeConfirmsInvestmentAgreement(
      investmentAgreementUrl,
      { from: nominee },
    );
    // this is also state transition into claim
    expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Claim);
    await expectValidClaimState(nomineeSignTx, contribution);
    return contribution;
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
      await euroToken.deposit(
        investor,
        amount.lt(minDepositAmountEurUlps) ? minDepositAmountEurUlps : amount,
        0x0,
        { from: admin },
      );
      token = euroToken;
    }
    // we take one wei of NEU so we do not have to deal with rounding errors
    let expectedNeu = investorShare(await neumark.incremental(eurEquiv));
    if (expectedNeu.gt(0)) {
      expectedNeu = expectedNeu.sub(1);
    }
    // use overloaded erc223 to transfer to contract with callback
    // console.log(
    //   `investor ${investor} INVESTING ${amount.toString("10")} ${currency} ${eurEquiv.toString(
    //     "10",
    //   )}`,
    // );
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
    const tokenPower = getTokenPower();
    if (expectedPrice) {
      // for integer prices use smart contract rounding
      if (expectedPrice.decimalPlaces() === 0) {
        // we always round down when computing equity tokens
        expectedEquity = eurEquiv.mul(tokenPower).divToInt(expectedPrice);
      } else {
        // this is effective price that is used to approximate smart contract rounding
        // give as much precision as possible
        expectedEquity = divRound(eurEquiv.mul(tokenPower), expectedPrice);
      }
      // compare expected price only on first tranche of investment - later those depend on previous
      // tranches
      if (oldTicket[0].eq(0)) {
        // the actual price will be slightly higher (or equal) than the expected price
        // due to tokens being indivisible - and we always floor the number of tokens bought
        // example: token cost is 1 eur, you pay 1.9 eur, you get 1 token, your price is 1.9 eur
        // expect(ticket[4]).to.be.bignumber.eq(divRound(eurEquiv.mul(tokenPower), expectedEquity));
      }
    } else {
      expectedEquity = ticket[2].sub(oldTicket[2]);
    }
    expect(ticket[2].sub(oldTicket[2])).to.be.bignumber.eq(expectedEquity);
    // fraction of shares (would be cool to compute just difference but we accumulate roundings!)
    expect(ticket[3]).to.be.bignumber.eq(
      divRound(expectedEquity.add(oldTicket[2]).mul(Q18), tokenTermsDict.EQUITY_TOKENS_PER_SHARE),
    );
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

  function getTokenPower(terms) {
    return decimalBase.pow((terms || tokenTermsDict).EQUITY_TOKEN_DECIMALS);
  }

  function tokensCostEur(tokens, price) {
    return tokens.mul(price).divToInt(getTokenPower());
  }

  function allTokensCostEur(price) {
    const p = price || tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
    return getMaxAvailableTokens(tokenTermsDict.MAX_NUMBER_OF_TOKENS)
      .mul(p)
      .divToInt(getTokenPower());
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
    const expectedNeu = zero;
    // investor sends money via wallet
    // console.log(
    //   `ICBM investor ${investor} INVESTING ${amount.toString("10")} ${currency} ${eurEquiv.toString(
    //     "10",
    //   )}`,
    // );
    const tx = await wallet.transfer(etoCommitment.address, amount, "", {
      from: investor,
    });
    // console.log(`ICBM investor ${investor} gasUsed ${tx.receipt.gasUsed}`);
    // validate investment
    const ticket = await etoCommitment.investorTicket(investor);
    // console.log(oldTicket);
    // console.log(ticket);
    expect(ticket[0]).to.be.bignumber.eq(eurEquiv.add(oldTicket[0]));
    expect(ticket[1]).to.be.bignumber.eq(expectedNeu.add(oldTicket[1]));
    // check only if expected token price was given
    let expectedEquity;
    const tokenPower = getTokenPower();
    if (expectedPrice) {
      // for integer prices use smart contract rounding
      if (expectedPrice.decimalPlaces() === 0) {
        // we always round down when computing equity tokens
        expectedEquity = eurEquiv.mul(tokenPower).divToInt(expectedPrice);
      } else {
        // this is effective price that is used to approximate smart contract rounding
        // give as much precision as possible
        expectedEquity = divRound(eurEquiv.mul(tokenPower), expectedPrice);
      }
      // compare expected price only on first tranche of investment - later those depend on previous
      // tranches
      if (oldTicket[0].eq(0)) {
        // the actual price will be slightly higher (or equal) than the expected price
        // due to tokens being indivisible - and we always floor the number of tokens bought
        // example: token cost is 1 eur, you pay 1.9 eur, you get 1 token, your price is 1.9 eur
        expect(ticket[4]).to.be.bignumber.eq(divRound(eurEquiv.mul(tokenPower), expectedEquity));
      }
    } else {
      expectedEquity = ticket[2].sub(oldTicket[2]);
    }
    expect(ticket[2].sub(oldTicket[2])).to.be.bignumber.eq(expectedEquity);
    // fraction of shares (would be cool to compute just difference but we accumulate roundings!)
    expect(ticket[3]).to.be.bignumber.eq(
      divRound(expectedEquity.add(oldTicket[2]).mul(Q18), tokenTermsDict.EQUITY_TOKENS_PER_SHARE),
    );
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

  async function signInvestmentAgreement() {
    const investmentAgreementUrl = "ipfs:3290890ABINVESTMENT";
    await etoCommitment.companySignsInvestmentAgreement(investmentAgreementUrl, {
      from: company,
    });
    const tx = etoCommitment.nomineeConfirmsInvestmentAgreement(investmentAgreementUrl, {
      from: nominee,
    });
    expect(await etoCommitment.state()).to.be.bignumber.eq(CommitmentState.Claim);
    return tx;
  }

  async function expectValidSigningState(participatingInvestors, o) {
    const options = Object.assign(
      {
        expectedInvestorsCount: participatingInvestors.length,
        initalNeuEur: zero,
        initialEquityTokens: zero,
        initialNomineeBalance: zero,
        icbmEurEquiv: zero,
        etherTokenSurplus: zero,
        euroTokenSurplus: zero,
      },
      o,
    );
    const totalInvestment = await etoCommitment.totalInvestment();
    expect(totalInvestment[2]).to.be.bignumber.eq(options.expectedInvestorsCount); // number of investors
    let expectedTokens = zero;
    let expectedEurEquiv = zero;
    let expectedInvestorNeu = zero;
    let expectedAmountEth = zero;
    let expectedAmountEur = zero;
    let expectedShares = zero;
    let expectedNewMoneyEurEquiv = zero;
    for (const investor of participatingInvestors) {
      const ticket = await etoCommitment.investorTicket(investor);
      expectedTokens = expectedTokens.add(ticket[2]);
      expectedInvestorNeu = expectedInvestorNeu.add(ticket[1]);
      expectedEurEquiv = expectedEurEquiv.add(ticket[0]);
      expectedAmountEth = expectedAmountEth.add(ticket[6]);
      expectedAmountEur = expectedAmountEur.add(ticket[7]);
      expectedShares = expectedShares.add(ticket[5]);
      expectedNewMoneyEurEquiv = expectedNewMoneyEurEquiv.add(ticket[0]);
    }
    expect(expectedTokens).to.be.bignumber.eq(totalInvestment[1]);
    expect(expectedEurEquiv).to.be.bignumber.eq(totalInvestment[0]);
    expectedNewMoneyEurEquiv = expectedNewMoneyEurEquiv.sub(options.icbmEurEquiv);
    // check NEU via taking expected amount directly from the curve
    // assumes that no one invested with icbm money and new money in single ticket
    const expectedComputedNeu = await neumark.incremental["uint256,uint256"](
      options.initalNeuEur,
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
    const tokenSharesRemainder = expectedTokenSupply.mod(tokenTermsDict.EQUITY_TOKENS_PER_SHARE);
    if (!tokenSharesRemainder.eq(0)) {
      expectedTokenSupply = expectedTokenSupply.add(
        tokenTermsDict.EQUITY_TOKENS_PER_SHARE.sub(tokenSharesRemainder),
      );
    }
    // still the equity tokens are not yet issued, this happens in claim transition
    // add initial balance of equity token to test secondary offerings
    expect(await equityToken.totalSupply()).to.be.bignumber.eq(
      zero.add(options.initialEquityTokens),
    );
    const expectedNewShares = expectedTokenSupply.div(tokenTermsDict.EQUITY_TOKENS_PER_SHARE);
    const contribution = await etoCommitment.contributionSummary();
    expect(contribution[0]).to.be.bignumber.eq(expectedNewShares);
    // capital increase is nominal value of the shares (ISHA currency) multipled by new shares generated
    const expectedCapitalIncreaseUlps = contribution[0].mul(
      tokenTermsDict.SHARE_NOMINAL_VALUE_ULPS,
    );
    expect(contribution[1]).to.be.bignumber.eq(expectedCapitalIncreaseUlps);
    // euro equivalent went to nominee
    const nominalValueEur = expectedNewShares.mul(tokenTermsDict.SHARE_NOMINAL_VALUE_EUR_ULPS);
    const eurFee = divRound(expectedAmountEur.mul(platformTermsDict.PLATFORM_FEE_FRACTION), Q18);
    // nomine should get nominal amount but if there is not enough EUR he will get all EUR - fee
    const expectedNomineBalance = expectedAmountEur.sub(eurFee).lt(nominalValueEur)
      ? expectedAmountEur.sub(eurFee)
      : nominalValueEur;
    expect(await euroToken.balanceOf(nominee)).to.be.bignumber.eq(
      expectedNomineBalance.add(options.initialNomineeBalance),
    );
    // eth additional contribution is ethAmount on the token - 3% fee
    expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
      expectedAmountEth.add(options.etherTokenSurplus),
    );
    const ethFee = divRound(expectedAmountEth.mul(platformTermsDict.PLATFORM_FEE_FRACTION), Q18);
    expect(contribution[2]).to.be.bignumber.eq(expectedAmountEth.sub(ethFee));
    expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
      expectedAmountEur.sub(expectedNomineBalance).add(options.euroTokenSurplus),
    );
    if (expectedAmountEur.sub(eurFee).gte(nominalValueEur)) {
      // eur additional contribution is eurAmount - fee - nominal value
      expect(contribution[3]).to.be.bignumber.eq(
        expectedAmountEur.sub(nominalValueEur).sub(eurFee),
      );
    } else {
      // we sent all EUR-T to nominee to cover at least part of nominal value
      expect(contribution[3]).to.be.bignumber.eq(0);
    }
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

  async function expectValidClaimState(signedTx, contribution, o) {
    const options = Object.assign(
      {
        etherTokenSurplus: zero,
        euroTokenSurplus: zero,
      },
      o,
    );
    // verify on claim state, based on contribution that was already verified in signing
    // company got money
    expect(await etherToken.balanceOf(company)).to.be.bignumber.eq(contribution[2]);
    expectLogAdditionalContribution(signedTx, 0, company, etherToken.address, contribution[2]);
    expect(await euroToken.balanceOf(company)).to.be.bignumber.eq(contribution[3]);
    expectLogAdditionalContribution(signedTx, 1, company, euroToken.address, contribution[3]);
    // platform operator got their NEU (contribution[8] contains amount of new money created)
    const expectedComputedNeu = await neumark.incremental["uint256,uint256"](0, contribution[8]);
    expect(await neumark.balanceOf(tokenOfferingOperator)).to.be.bignumber.eq(
      platformShare(expectedComputedNeu),
    );
    expectLogPlatformNeuReward(
      signedTx,
      tokenOfferingOperator,
      await neumark.totalSupply(),
      platformShare(expectedComputedNeu),
    );
    // equity token balance is increased by a fee (new_shares * tok per share)
    expect(await equityToken.totalSupply()).to.be.bignumber.eq(
      contribution[0].mul(tokenTermsDict.EQUITY_TOKENS_PER_SHARE),
    );
    // eto is successful
    expect(await etoCommitment.success()).to.be.true;
    expect(await etoCommitment.finalized()).to.be.true;
    expect(await equityTokenController.state()).to.be.bignumber.eq(GovState.Funded);
    const generalInformation = await equityTokenController.shareholderInformation();
    const increasedShareCapitalUlps = etoTermsDict.EXISTING_SHARE_CAPITAL.add(contribution[1]);
    expect(generalInformation[0]).to.be.bignumber.eq(increasedShareCapitalUlps);
    // compute expected capital increase as (new share capital loc curr * share_price_eur)/(new share nom value)
    expect(generalInformation[1]).to.be.bignumber.eq(
      divRound(
        increasedShareCapitalUlps
          .mul(tokenTermsDict.TOKEN_PRICE_EUR_ULPS)
          .mul(tokenTermsDict.EQUITY_TOKENS_PER_SHARE),
        tokenTermsDict.SHARE_NOMINAL_VALUE_ULPS.mul(getTokenPower()),
      ),
    );
    expect(generalInformation[2]).to.eq(shareholderRights.address);
    expect(generalInformation[3]).to.be.bignumber.eq(etoTermsDict.AUTHORIZED_CAPITAL);
    const tokens = await equityTokenController.tokens();
    expect(tokens[0][0]).to.eq(equityToken.address);
    // we return shares as fractions so partial shares can be represented
    expect(tokens[1][0]).to.be.bignumber.eq(contribution[0].mul(Q18));
    expect(await equityTokenController.tokenOfferings()).to.deep.eq([
      [etoCommitment.address],
      [equityToken.address],
    ]);
    expect(await equityToken.sharesTotalSupply()).to.be.bignumber.eq(contribution[0]);
    // all tokens still belong to eto smart contract
    expect(await equityToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
      contribution[0].mul(tokenTermsDict.EQUITY_TOKENS_PER_SHARE),
    );
    // just fees left in the contract
    expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
      contribution[5].add(options.etherTokenSurplus),
    );
    expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
      contribution[6].add(options.euroTokenSurplus),
    );
    // check token transferability
    const transferability = etoTermsDict.ENABLE_TRANSFERS_ON_SUCCESS;
    expect(
      await equityTokenController.onTransfer(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, 0),
    ).to.eq(transferability);
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

  async function expectValidRefundState(refundTx, participatingInvestors, icbmEurEquiv) {
    let expectedTokens = zero;
    let expectedNewMoneyEurEquiv = zero;
    for (const investor of participatingInvestors) {
      const ticket = await etoCommitment.investorTicket(investor);
      expectedTokens = expectedTokens.add(ticket[2]);
      expectedNewMoneyEurEquiv = expectedNewMoneyEurEquiv.add(ticket[0]);
      // console.log(`refund for ${investor} ${ticket[2]}`);
    }
    // icbmEurEquiv is amount invested from icbm wallets, it does not count NEU issued
    const expectedComputedNeu = await neumark.incremental["uint256,uint256"](
      0,
      expectedNewMoneyEurEquiv.sub(icbmEurEquiv || 0),
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

  async function expectValidPayoutState(tx, contribution, o) {
    const options = Object.assign(
      {
        expectsEther: true,
        expectsEuro: true,
        etherTokenSurplus: zero,
        euroTokenSurplus: zero,
      },
      o,
    );
    // contribution was validated previously and may be used as a reference
    const disbursal = await universe.feeDisbursal();
    const platformPortfolio = await universe.platformPortfolio();
    expectLogPlatformFeePayout(tx, 0, etherToken.address, disbursal, contribution[5]);
    expectLogPlatformFeePayout(tx, 1, euroToken.address, disbursal, contribution[6]);
    expectLogPlatformPortfolioPayout(tx, equityToken.address, platformPortfolio, contribution[4]);
    // fee disbursal must have valid snapshot token address which is sent as additional bytes parameter
    const logs = decodeLogs(tx, testDisbursal.address, testDisbursal.abi);
    tx.logs.push(...logs);
    let disbursalRcvIdx = 0;
    if (options.expectsEther) {
      expectLogTestReceiveTransfer(
        tx,
        disbursalRcvIdx,
        etherToken.address,
        neumark.address,
        etoCommitment.address,
        contribution[5],
      );
      disbursalRcvIdx += 1;
    }
    if (options.expectsEuro) {
      expectLogTestReceiveTransfer(
        tx,
        disbursalRcvIdx,
        euroToken.address,
        neumark.address,
        etoCommitment.address,
        contribution[6],
      );
    }
    // fee disbursal must have fees
    expect(await etherToken.balanceOf(disbursal)).to.be.bignumber.eq(contribution[5]);
    expect(await euroToken.balanceOf(disbursal)).to.be.bignumber.eq(contribution[6]);
    // platform portfolio must have tokens
    expect(await equityToken.balanceOf(platformPortfolio)).to.be.bignumber.eq(contribution[4]);
    // eto commitment must have no funds
    expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
      options.etherTokenSurplus,
    );
    expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(
      options.euroTokenSurplus,
    );
  }

  async function expectValidPayoutStateFullClaim() {
    // eto commitment must have no equity tokens
    expect(await equityToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
    // just remainder of NEU
    expect((await neumark.balanceOf(etoCommitment.address)).sub(8).abs()).to.be.bignumber.lt(10);
  }

  async function expectFullyRefundedState() {
    // no funds of any kind on eto commitment account
    expect(await euroToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
    expect(await etherToken.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
    // all neu burned
    expect(await neumark.balanceOf(etoCommitment.address)).to.be.bignumber.eq(0);
  }

  async function claimInvestor(investor) {
    const ticket = await etoCommitment.investorTicket(investor);
    const tx = await etoCommitment.claim({ from: investor });
    // check only if actual claim happened
    if (ticket[2].gt(0)) {
      await expectValidInvestorClaim(tx, investor);
    }
  }

  async function claimMultipleInvestors(investorsAddresses) {
    for (const investor of investorsAddresses) {
      await claimInvestor(investor);
    }
  }

  async function refundInvestor(investor) {
    const tx = await etoCommitment.refund({ from: investor });
    await expectValidInvestorRefund(tx, investor, 0);
  }

  async function refundMultipleInvestors(investorsAddresses) {
    for (const investor of investorsAddresses) {
      await refundInvestor(investor);
    }
  }

  async function expectEmptyTokenController() {
    const tokens = await equityTokenController.tokens();
    expect(tokens[0].length).to.eq(0);
    expect(tokens[1].length).to.eq(0);
    expect(await equityTokenController.tokenOfferings()).to.deep.eq([[], []]);
    const generalInfo = await equityTokenController.shareholderInformation();
    expect(generalInfo[0]).to.be.bignumber.eq(0);
    expect(generalInfo[1]).to.be.bignumber.eq(0);
    expect(generalInfo[2]).to.eq(ZERO_ADDRESS);
    expect(generalInfo[3]).to.be.bignumber.eq(0);
  }

  async function expectStateStarts(pastStatesTable, durationTable) {
    const durTableCopy = durationTable.slice();
    // add initial 0 to align with internal algorithm which looks to state - 1 to give start of current
    durTableCopy.unshift(0);
    let expectedDate = zero;
    for (const state of Object.keys(CommitmentState)) {
      // be more precise and reproduce internal timestamp algo by adding eto terms
      if (state in pastStatesTable) {
        expectedDate = pastStatesTable[state];
      } else {
        expectedDate = expectedDate.add(durTableCopy[CommitmentState[state]]);
      }
      // console.log(`${state}:${expectedDate}:${new Date(expectedDate * 1000)}`);
      expect(await etoCommitment.startOf(CommitmentState[state])).to.be.bignumber.eq(expectedDate);
    }
  }

  // maxCap, tokenPrice
  function minTicketTokenGapAmount(price) {
    const optprice = price || tokenTermsDict.TOKEN_PRICE_EUR_ULPS;
    // const minTicketRound = maxCap.div(etoTermsDict.MIN_TICKET_EUR_ULPS).floor().mul(etoTermsDict.MIN_TICKET_EUR_ULPS);
    // const minPriceRound = minTicketRound.div(tokenPrice).floor().mul(tokenPrice);
    // return maxCap.sub(minPriceRound);
    // MIN_TICKET is not exactly divisible by price (typically), there is a remainder which produces gap as below
    return etoTermsDict.MIN_TICKET_EUR_ULPS.div(optprice)
      .floor()
      .mul(optprice);
  }

  async function attachFeeDisbursal() {
    // change to new FeeDisbursal
    const [feeDisbursal] = await deployFeeDisbursalUniverse(universe, admin);
    // also let it process nEUR
    await euroTokenController.applySettings(0, 0, Q18, { from: admin });
    return feeDisbursal;
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

  function calculateMixedTranchePriceLinear(
    totalAmount,
    tranche1Amount,
    tranche1Price,
    tranche2Price,
  ) {
    const tranche2Amount = totalAmount.sub(tranche1Amount);
    // to approximate real mixed price we must also take into account that tokens are quantized so
    // we lose some funds on the edge between two tranches as in each tranche tokens are acquired
    // independently and some funds are lost due to rounding
    const tokenPower = getTokenPower();
    const tranche1QuantizedAmount = tranche1Amount
      .mul(tokenPower)
      .divToInt(tranche1Price)
      .mul(tranche1Price)
      .divToInt(tokenPower);
    // smart contract tries to recover as much from the first tranche as possible
    // const recoveredAmount = tranche1Amount.sub(tranche1QuantizedAmount);
    const tranche2QuantizedAmount = tranche2Amount
      // .add(recoveredAmount)
      .mul(tokenPower)
      .divToInt(tranche2Price)
      .mul(tranche2Price)
      .divToInt(tokenPower);
    // still total amount was spent so effective price was higher for a tranche
    // return non-integer value for precise calculations
    return totalAmount
      .mul(tranche1Price)
      .mul(tranche2Price)
      .div(
        tranche1Price.mul(tranche2QuantizedAmount).add(tranche2Price.mul(tranche1QuantizedAmount)),
      );
  }

  function calculateMixedTranchePrice(totalAmount, tranche1Amount, tranche1Price, tranche2Price) {
    // this reproduces how smart contract calculates tokens exactly
    const tranche2Amount = totalAmount.sub(tranche1Amount);
    const tokenPower = getTokenPower();
    const tranche1Tokens = tranche1Amount.mul(tokenPower).divToInt(tranche1Price);
    const tranche2Tokens = tranche2Amount.mul(tokenPower).divToInt(tranche2Price);

    // console.log(tranche1Tokens.add(tranche2Tokens).toString("10"));
    const effectivePrice = totalAmount.mul(tokenPower).div(tranche1Tokens.add(tranche2Tokens));
    // compare to our old linear approx of the same thing
    expect(
      calculateMixedTranchePriceLinear(totalAmount, tranche1Amount, tranche1Price, tranche2Price)
        .sub(effectivePrice)
        .abs(),
    ).to.be.bignumber.lt(tokenPower.mul(2));
    // note that it returns precision 100+ digits decimal, not integer!
    return effectivePrice;
  }

  function getMaxAvailableTokens(maxNumberOfTokens) {
    return maxNumberOfTokens.div(inverseTokenFeeDec).round(0, 4);
    // return divRound(maxNumberOfTokens.mul("50"), new web3.BigNumber("51"));
  }

  async function expectExactlyMaxCap(maxNumberOfTokens) {
    const totalInvestment = await etoCommitment.totalInvestment();
    const contribution = await etoCommitment.contributionSummary();
    // we stop ETO exactly when sold tokens + token fee == max tokens
    expect(totalInvestment[1].add(contribution[4])).to.be.bignumber.eq(maxNumberOfTokens);
  }

  async function expectFullClaimInPayout(contribution, options) {
    const currDate = new web3.BigNumber(await latestTimestamp());
    const payoutDate = currDate.add(durTable[CommitmentState.Claim]);
    await skipTimeTo(payoutDate);
    const transitionTx = await etoCommitment.payout();
    await expectValidPayoutState(transitionTx, contribution, options);
    await expectValidPayoutStateFullClaim();
  }

  function expectLogTestReceiveTransfer(
    tx,
    logIdx,
    tokenAddress,
    snapshotTokenAddress,
    from,
    amount,
  ) {
    const event = eventWithIdxValue(tx, logIdx, "LogTestReceiveTransfer");
    expect(event).to.exist;
    expect(event.args.paymentToken).to.be.equal(tokenAddress);
    expect(event.args.snapshotToken).to.be.equal(snapshotTokenAddress);
    expect(event.args.amount).to.be.bignumber.equal(amount);
    expect(event.args.from).to.be.equal(from);
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

  function expectLogETOStartDateSet(tx, companyAddr, startAt, newStartDate) {
    const event = eventValue(tx, "LogETOStartDateSet");
    expect(event).to.exist;
    expect(event.args.companyLegalRep).to.eq(companyAddr);
    expect(event.args.previousTimestamp).to.be.bignumber.eq(startAt);
    expect(event.args.newTimestamp).to.be.bignumber.eq(newStartDate);
  }

  function expectLogStateTransition(tx, oldState, newState, ts, logIdx = 0) {
    const event = eventWithIdxValue(tx, logIdx, "LogStateTransition");
    expect(event).to.exist;
    expect(event.args.oldState).to.be.bignumber.eq(oldState);
    expect(event.args.newState).to.be.bignumber.eq(newState);
    if (ts !== "ignore") {
      expect(event.args.timestamp).to.be.bignumber.eq(ts);
    }
  }

  function expectLogSigningStarted(tx, nomineeAddr, companyAddr, newShares, capitalIncreaseUlps) {
    const event = eventValue(tx, "LogSigningStarted");
    expect(event).to.exist;
    expect(event.args.nominee).to.eq(nomineeAddr);
    expect(event.args.companyLegalRep).to.eq(companyAddr);
    expect(event.args.newShares).to.be.bignumber.eq(newShares);
    expect(event.args.capitalIncreaseUlps).to.be.bignumber.eq(capitalIncreaseUlps);
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

  function expectLogPlatformNeuReward(
    tx,
    tokenOfferingOperatorAddress,
    totalReward,
    platformReward,
  ) {
    const event = eventValue(tx, "LogPlatformNeuReward");
    expect(event).to.exist;
    expect(event.args.tokenOfferingOperator).to.eq(tokenOfferingOperatorAddress);
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
