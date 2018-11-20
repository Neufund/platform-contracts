import { expect } from "chai";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { divRound } from "../helpers/unitConverter";
import EvmError from "../helpers/EVMThrow";
import {
  deployUniverse,
  deployPlatformTerms,
  deployIdentityRegistry,
} from "../helpers/deployContracts";
import {
  deployShareholderRights,
  deployDurationTerms,
  deployTokenTerms,
  deployETOTerms,
  constTokenTerms,
  constETOTerms,
} from "../helpers/deployTerms";
import { Q18, contractId, web3 } from "../helpers/constants";

const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const ShareholderRights = artifacts.require("ShareholderRights");

contract("ETOTerms", ([deployer, admin, investorDiscount, investorNoDiscount, ...investors]) => {
  let universe;
  let platformTerms;
  let etoTerms;
  let terms, termsKeys;
  let shareholderRights;
  let shareholderTerms, shareholderTermsKeys;
  let durationTerms;
  let durTerms, durationTermsKeys;
  let etoTokenTerms, tokenTerms, tokenTermsKeys;

  beforeEach(async () => {
    [universe] = await deployUniverse(admin, admin);
    await deployIdentityRegistry(universe, admin, admin);
    [platformTerms] = await deployPlatformTerms(universe, admin);
    [shareholderRights, shareholderTerms, shareholderTermsKeys] = await deployShareholderRights(
      ShareholderRights,
    );
    [durationTerms, durTerms, durationTermsKeys] = await deployDurationTerms(ETODurationTerms);
    [etoTokenTerms, tokenTerms, tokenTermsKeys] = await deployTokenTerms(ETOTokenTerms);
    [etoTerms, terms, termsKeys] = await redeployTerms();
  });

  it("should deploy", async () => {
    await prettyPrintGasCost("ShareholderRights deploy", shareholderRights);
    await prettyPrintGasCost("ETODurationTerms deploy", durationTerms);
    await prettyPrintGasCost("ETOTerms deploy", etoTerms);
    await prettyPrintGasCost("ETOTokenTerms deploy", etoTokenTerms);
    expect((await shareholderRights.contractId())[0]).to.eq(contractId("ShareholderRights"));
    expect((await durationTerms.contractId())[0]).to.eq(contractId("ETODurationTerms"));
    expect((await etoTerms.contractId())[0]).to.eq(contractId("ETOTerms"));
    expect((await etoTokenTerms.contractId())[0]).to.eq(contractId("ETOTokenTerms"));
    for (const k of Object.keys(constTokenTerms)) {
      expect(await etoTokenTerms[k]()).to.be.bignumber.eq(constTokenTerms[k]);
    }
    for (const k of Object.keys(constETOTerms)) {
      expect(await etoTerms[k]()).to.be.bignumber.eq(constETOTerms[k]);
    }
  });

  async function redeployTerms(etoTermsOverride) {
    return deployETOTerms(
      universe,
      ETOTerms,
      durationTerms,
      etoTokenTerms,
      shareholderRights,
      etoTermsOverride,
    );
  }

  async function verifyTerms(c, keys, dict) {
    for (const f of keys) {
      const rv = await c[f]();
      if (rv instanceof Object) {
        expect(rv, f).to.be.bignumber.eq(dict[f]);
      } else {
        expect(rv, f).to.eq(dict[f]);
      }
    }
  }

  it("should verify terms in ETOTerms", async () => {
    await verifyTerms(etoTerms, termsKeys, terms);
  });

  it("ETOTerms: also verify constant parameters that are not set but part of interface");

  it("should verify terms in ETODurationTerms", async () => {
    await verifyTerms(durationTerms, durationTermsKeys, durTerms);
  });

  it("should verify terms in ETOTokenTerms", async () => {
    await verifyTerms(etoTokenTerms, tokenTermsKeys, tokenTerms);
  });

  it("should verify terms in ShareholderRights", async () => {
    await verifyTerms(shareholderRights, shareholderTermsKeys, shareholderTerms);
  });

  it("ShareholderRights todo: also verify constant parameters");

  it("should verify default eto terms against platform terms", async () => {
    await etoTerms.requireValidTerms(platformTerms.address);
  });

  // should be a set of tests with different rounding, we should be able to run it on equity token as well
  it("should convert equity token amount to shares");

  describe("terms validation", () => {
    it("rejects on platform terms with minimum ticket too small", async () => {
      // change to sub(0) for this test to fail
      const [modifiedTerms] = await redeployTerms({
        MIN_TICKET_EUR_ULPS: (await platformTerms.MIN_TICKET_EUR_ULPS()).sub(1),
      });
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        EvmError,
      );
    });

    /*
    it("should reject on platform terms with max ticket in crowdfunding too large", async () => {
      // change to sub(0) for this test to fail
      const oldValue = await platformTerms.MAX_TICKET_CROWFUNDING_SOPHISTICATED_EUR_ULPS();
      terms.MAX_TICKET_EUR_ULPS = oldValue.add(1);
      terms.IS_CROWDFUNDING = true;
      const termsValues = termsKeys.map(v => terms[v]);
      // console.log(termsValues);
      etoTerms = await ETOTerms.new.apply(this, termsValues);
      await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
    });

    it("should reject on platform terms with simple max ticket in crowdfunding too large", async () => {
      // change to sub(0) for this test to fail
      const oldValue = await platformTerms.MAX_TICKET_CROWFUNDING_SIMPLE_EUR_ULPS();
      terms.MAX_TICKET_SIMPLE_EUR_ULPS = oldValue.add(1);
      terms.IS_CROWDFUNDING = true;
      const termsValues = termsKeys.map(v => terms[v]);
      // console.log(termsValues);
      etoTerms = await ETOTerms.new.apply(this, termsValues);
      await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
    });
    */

    it("reverts on retail eto with transfers enabled", async () => {
      const [modifiedTerms] = await redeployTerms({
        ALLOW_RETAIL_INVESTORS: true,
        ENABLE_TRANSFERS_ON_SUCCESS: true,
      });
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_MUST_DISABLE_TRANSFERS",
      );
    });

    it("reverts on non retail eto with minimum tickets too small", async () => {
      const [modifiedTerms] = await redeployTerms({
        ALLOW_RETAIL_INVESTORS: false,
        MIN_TICKET_EUR_ULPS: constETOTerms.MIN_QUALIFIED_INVESTOR_TICKET_EUR_ULPS.sub(1),
      });
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_MIN_QUALIFIED_INVESTOR_TICKET",
      );
    });

    // MIN_TICKET_LT_TOKEN_PRICE
    it("rejects ETO TERMS on min ticket less than token price", async () => {
      [etoTokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        TOKEN_PRICE_EUR_ULPS: terms.MIN_TICKET_EUR_ULPS.add(1),
      });
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_MIN_TICKET_LT_TOKEN_PRICE",
      );
    });

    // MAX_FUNDS_LT_MIN_TICKET - otherwise it's impossible to succesfully complete ETO
    it("rejects ETO TERMS if maximum funds collected less than min ticket", async () => {
      // lower number of tokens required
      [etoTokenTerms, tokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        MIN_NUMBER_OF_TOKENS: new web3.BigNumber(10000),
        MAX_NUMBER_OF_TOKENS: new web3.BigNumber(10000),
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(100),
      });
      // set public discount so it's impossible to successfully complete ETO becaue min ticket > cap
      const pubPriceFraction = Q18.mul(terms.MIN_TICKET_EUR_ULPS).div(
        tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(tokenTerms.MAX_NUMBER_OF_TOKENS),
      );
      // use a little bit smaller fraction to cross into < max cap (smaller fraction -> bigger discount)
      const [modifiedTerms] = await redeployTerms({
        PUBLIC_DISCOUNT_FRAC: Q18.sub(pubPriceFraction).add(10),
      });
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_MAX_FUNDS_LT_MIN_TICKET",
      );
    });

    it("should reject TOKEN TERMS on min cap less than one share", async () => {
      // lower number of tokens required
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          MIN_NUMBER_OF_TOKENS: new web3.BigNumber(1),
          MAX_NUMBER_OF_TOKENS: new web3.BigNumber(1),
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(1),
        }),
      ).to.be.rejectedWith("NF_ETO_TERMS_ONE_SHARE");
    });

    it("should accept new duration terms", async () => {
      // change to sub(0) for this test to fail
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        WHITELIST_DURATION: (await platformTerms.MIN_WHITELIST_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await modifiedTerms.requireValidTerms(platformTerms.address);
    });

    it("should reject on platform terms with whitelist duration too small", async function() {
      const minWhitelistDuration = await platformTerms.MIN_WHITELIST_DURATION();
      // minimum limit must be > 0
      if (minWhitelistDuration.gt(0)) {
        [durationTerms] = await deployDurationTerms(ETODurationTerms, {
          WHITELIST_DURATION: (await platformTerms.MIN_WHITELIST_DURATION()).sub(1),
        });
        // redeploy with new durationTerms
        const [modifiedTerms] = await redeployTerms();
        await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
          "NF_ETO_TERMS_WL_D_MIN",
        );
      } else {
        this.skip();
      }
    });

    it("should reject on platform terms with whitelist duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        WHITELIST_DURATION: (await platformTerms.MAX_WHITELIST_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_WL_D_MAX",
      );
    });

    it("should reject on platform terms with public duration too small", async function() {
      const minPublicDuration = await platformTerms.MIN_PUBLIC_DURATION();
      if (minPublicDuration.gt(0)) {
        [durationTerms] = await deployDurationTerms(ETODurationTerms, {
          PUBLIC_DURATION: minPublicDuration.sub(1),
        });
        // redeploy with new durationTerms
        const [modifiedTerms] = await redeployTerms();
        await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
          "NF_ETO_TERMS_PUB_D_MIN",
        );
      } else {
        this.skip();
      }
    });

    it("should reject on platform terms with public duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        PUBLIC_DURATION: (await platformTerms.MAX_PUBLIC_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_PUB_D_MAX",
      );
    });

    it("should reject on platform terms with signing duration too small", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        SIGNING_DURATION: (await platformTerms.MIN_SIGNING_DURATION()).sub(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_SIG_MIN",
      );
    });

    it("should reject on platform terms with signing duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        SIGNING_DURATION: (await platformTerms.MAX_SIGNING_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_SIG_MAX",
      );
    });

    it("should reject on platform terms with claim duration too small", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        CLAIM_DURATION: (await platformTerms.MIN_CLAIM_DURATION()).sub(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_CLAIM_MIN",
      );
    });

    it("should reject on platform terms with claim duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        CLAIM_DURATION: (await platformTerms.MAX_CLAIM_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_CLAIM_MAX",
      );
    });

    it("should reject on platform terms with total duration too small", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        WHITELIST_DURATION: (await platformTerms.MIN_OFFER_DURATION()).div(2),
        PUBLIC_DURATION: (await platformTerms.MIN_OFFER_DURATION()).div(2).sub(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_TOT_O_MIN",
      );
    });

    it("should reject on platform terms with total duration too large", async function() {
      const maxOfferDuration = await platformTerms.MAX_OFFER_DURATION();
      const maxWlPubDuration = (await platformTerms.MAX_WHITELIST_DURATION()).add(
        await platformTerms.MAX_PUBLIC_DURATION(),
      );
      if (maxWlPubDuration.gt(maxOfferDuration)) {
        // todo: this test has many internal cases and needs improvement, with current platform settings it will not be executed
        [durationTerms] = await deployDurationTerms(ETODurationTerms, {
          WHITELIST_DURATION: (await platformTerms.MAX_WHITELIST_DURATION()).sub(1),
        });
        // redeploy with new durationTerms
        const [modifiedTerms] = await redeployTerms();
        await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
          "NF_ETO_TERMS_TOT_O_MAX",
        );
      } else {
        this.skip();
      }
    });

    it("should reject on platform terms with minimum number of tokens too small", async () => {
      // change to sub(0) for this test to fail
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          MIN_NUMBER_OF_TOKENS: constTokenTerms.EQUITY_TOKENS_PER_SHARE.sub(1),
        }),
      ).to.be.rejectedWith("NF_ETO_TERMS_ONE_SHARE");
    });

    it("should reject on minimum ticket too small", async () => {
      const [modifiedTerms] = await redeployTerms({
        MIN_TICKET_EUR_ULPS: (await platformTerms.MIN_TICKET_EUR_ULPS()).sub(1),
      });
      await expect(modifiedTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
        "NF_ETO_TERMS_MIN_TICKET_EUR_ULPS",
      );
    });
  });

  describe("general calculations", () => {
    describe("no public discount", () => {
      generalCalculationTests(Q18);
    });

    describe("with public discount", () => {
      beforeEach(async () => {
        [etoTerms, terms, termsKeys] = await redeployTerms({
          WHITELIST_DISCOUNT_FRAC: Q18.mul(0),
          PUBLIC_DISCOUNT_FRAC: Q18.mul(0.7651),
        });
      });

      generalCalculationTests(Q18.mul(1 - 0.7651));
    });
  });

  function generalCalculationTests(priceFraction) {
    const tokenPrice = () => divRound(tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(priceFraction), Q18);

    function tokenAmount(amount) {
      // here we need to reproduce exact rounding as in smart contract
      return amount.div(tokenPrice()).floor();
    }

    function eurAmount(amount) {
      return amount.mul(tokenPrice());
    }

    it("should compute estimated max cap and min cap in eur", async () => {
      const maxCap = await etoTerms.ESTIMATED_MAX_CAP_EUR_ULPS();
      expect(maxCap).to.be.bignumber.eq(eurAmount(tokenTerms.MAX_NUMBER_OF_TOKENS));
      const minCap = await etoTerms.ESTIMATED_MIN_CAP_EUR_ULPS();
      expect(minCap).to.be.bignumber.eq(eurAmount(tokenTerms.MIN_NUMBER_OF_TOKENS));
    });

    it("should calculate price fraction", async () => {
      expect(await etoTerms.calculatePriceFraction(priceFraction)).to.be.bignumber.eq(tokenPrice());
    });

    it("should compute tokens from eur", async () => {
      expect(await etoTerms.calculateTokenAmount(0, tokenPrice())).to.be.bignumber.eq(1);
      expect(await etoTerms.calculateTokenAmount(0, 0)).to.be.bignumber.eq(0);
      const ticket = Q18.mul(717271).add(1);
      expect(await etoTerms.calculateTokenAmount(0, ticket)).to.be.bignumber.eq(
        tokenAmount(ticket),
      );
      const ticket2 = Q18.mul(7162.129821);
      expect(await etoTerms.calculateTokenAmount(0, ticket2)).to.be.bignumber.eq(
        tokenAmount(ticket2),
      );
    });

    it("should compute eurs from tokens", async () => {
      expect(await etoTerms.calculateEurUlpsAmount(0, 1)).to.be.bignumber.eq(tokenPrice());
      expect(await etoTerms.calculateEurUlpsAmount(0, 0)).to.be.bignumber.eq(0);
      const tokens1 = new web3.BigNumber(9812791);
      expect(await etoTerms.calculateEurUlpsAmount(0, tokens1)).to.be.bignumber.eq(
        eurAmount(tokens1),
      );
      const tokens2 = new web3.BigNumber(9812791);
      expect(await etoTerms.calculateEurUlpsAmount(0, tokens2)).to.be.bignumber.eq(
        eurAmount(tokens2),
      );
    });
  }

  describe("whitelist tests", () => {
    it("add single investor", async () => {
      // no discount
      let tx = await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], { from: deployer });
      expectLogInvestorWhitelisted(tx.logs[0], investorNoDiscount, 0, Q18);
      let ticket = await etoTerms.whitelistTicket(investorNoDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(0);
      expect(ticket[2]).to.be.bignumber.eq(Q18);

      // with discount of 60% with ticket 500000
      const whitelistedAmount = Q18.mul(500000).add(1);
      const discount = Q18.mul(0.6).sub(1);
      tx = await etoTerms.addWhitelisted([investorDiscount], [whitelistedAmount], [discount], {
        from: deployer,
      });
      expectLogInvestorWhitelisted(tx.logs[0], investorDiscount, whitelistedAmount, discount);
      ticket = await etoTerms.whitelistTicket(investorDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(whitelistedAmount);
      expect(ticket[2]).to.be.bignumber.eq(discount);
    });

    it("add many investors", async () => {
      const tx = await etoTerms.addWhitelisted(
        [investors[0], investors[1], investors[2]],
        [Q18.mul(500000), Q18.mul(600000), Q18.mul(700000)],
        [Q18.mul(0.5), Q18.mul(0.6), Q18.mul(0.7)],
        {
          from: deployer,
        },
      );
      expectLogInvestorWhitelisted(tx.logs[0], investors[0], Q18.mul(500000), Q18.mul(0.5));
      expectLogInvestorWhitelisted(tx.logs[1], investors[1], Q18.mul(600000), Q18.mul(0.6));
      expectLogInvestorWhitelisted(tx.logs[2], investors[2], Q18.mul(700000), Q18.mul(0.7));

      let ticket = await etoTerms.whitelistTicket(investors[0]);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(500000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.5));

      ticket = await etoTerms.whitelistTicket(investors[1]);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(600000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.6));

      ticket = await etoTerms.whitelistTicket(investors[2]);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(700000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.7));
    });

    it("not whitelisted has no ticket", async () => {
      const ticket = await etoTerms.whitelistTicket(investors[3]);
      expect(ticket[0]).to.be.false;
    });

    it("reverts on add not from deployer", async () => {
      await expect(
        etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], { from: investors[3] }),
      ).to.revert;
    });

    it("overrides single investor", async () => {
      let tx = await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], { from: deployer });
      expectLogInvestorWhitelisted(tx.logs[0], investorNoDiscount, 0, Q18);
      let ticket = await etoTerms.whitelistTicket(investorNoDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(0);
      expect(ticket[2]).to.be.bignumber.eq(Q18);

      tx = await etoTerms.addWhitelisted([investorNoDiscount], [Q18.mul(500000)], [Q18.mul(0.6)], {
        from: deployer,
      });
      expectLogInvestorWhitelisted(tx.logs[0], investorNoDiscount, Q18.mul(500000), Q18.mul(0.6));
      ticket = await etoTerms.whitelistTicket(investorNoDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(500000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.6));
    });

    it("overrides many investors", async () => {
      await etoTerms.addWhitelisted(
        [investors[0], investors[1], investors[2]],
        [Q18.mul(500000), Q18.mul(600000), Q18.mul(700000)],
        [Q18.mul(0.5), Q18.mul(0.6), Q18.mul(0.7)],
        {
          from: deployer,
        },
      );

      await etoTerms.addWhitelisted(
        [investors[0], investors[1], investors[2]],
        [Q18.mul(800000), Q18.mul(900000), Q18.mul(1000000)],
        [Q18.mul(0.2), Q18.mul(0.3), Q18.mul(0.4)],
        {
          from: deployer,
        },
      );

      let ticket = await etoTerms.whitelistTicket(investors[0]);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(800000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.2));

      ticket = await etoTerms.whitelistTicket(investors[1]);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(900000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.3));

      ticket = await etoTerms.whitelistTicket(investors[2]);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(1000000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.4));
    });

    it("fails on setting token price frac to 0", async () => {
      await expect(
        etoTerms.addWhitelisted([investorNoDiscount], [0], [0], { from: deployer }),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");

      // fail on set many
      await expect(
        etoTerms.addWhitelisted(
          [investors[0], investors[1], investors[2]],
          [Q18.mul(500000), Q18.mul(600000), Q18.mul(700000)],
          [0, Q18.mul(0.6), Q18.mul(0.7)],
          {
            from: deployer,
          },
        ),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");
    });

    it("fails on setting token price frac > 1", async () => {
      await expect(
        etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18.add(1)], { from: deployer }),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");

      // fail on set many
      await expect(
        etoTerms.addWhitelisted(
          [investors[0], investors[1], investors[2]],
          [Q18.mul(500000), Q18.mul(600000), Q18.mul(700000)],
          [Q18.mul(0.6), Q18.mul(0.7), Q18.add(1)],
          {
            from: deployer,
          },
        ),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");
    });
  });

  describe("contribution calculation with fixed slots and no whitelist discount", () => {
    beforeEach(async () => {
      [etoTerms, terms, termsKeys] = await redeployTerms({
        WHITELIST_DISCOUNT_FRAC: Q18.mul(0),
        PUBLIC_DISCOUNT_FRAC: Q18.mul(0),
      });
    });
    discountTests(Q18, Q18);
  });

  describe("contribution calculation with fixed slots and 99% whitelist discount", () => {
    beforeEach(async () => {
      [etoTerms, terms, termsKeys] = await redeployTerms({
        WHITELIST_DISCOUNT_FRAC: Q18.mul(0.99),
        PUBLIC_DISCOUNT_FRAC: Q18.mul(0),
      });
    });
    discountTests(Q18.mul(0.01), Q18);
  });

  describe("contribution calculation with fixed slots and 50.3761% whitelist discount", () => {
    beforeEach(async () => {
      [etoTerms, terms, termsKeys] = await redeployTerms({
        WHITELIST_DISCOUNT_FRAC: Q18.mul(0.503761),
        PUBLIC_DISCOUNT_FRAC: Q18.mul(0),
      });
    });
    discountTests(Q18.mul(1 - 0.503761), Q18);
  });

  describe("contribution calculation with fixed slots, whitelist and public discounts", () => {
    beforeEach(async () => {
      [etoTerms, terms, termsKeys] = await redeployTerms({
        WHITELIST_DISCOUNT_FRAC: Q18.mul(0.503761),
        PUBLIC_DISCOUNT_FRAC: Q18.mul(0.7651),
      });
    });
    discountTests(Q18.mul(1 - 0.503761), Q18.mul(1 - 0.7651));
  });

  describe("contribution calculation without discount", () => {
    function tokenAmount(_, amount) {
      return amount.div(tokenTerms.TOKEN_PRICE_EUR_ULPS).floor();
    }

    async function fullAmount(total, amount, isWhitelisted) {
      const info = await etoTerms.calculateContribution(
        investorNoDiscount,
        total,
        total,
        amount,
        false,
      );
      expect(info[0]).to.eq(isWhitelisted);
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[4]).to.be.bignumber.eq(tokenAmount(total, amount));
      expect(info[5]).to.be.bignumber.eq(0);
    }

    it("simple amount", async () => {
      await fullAmount(0, Q18.mul(1716.1991), false);
      // invest again
      await fullAmount(Q18.mul(1121.1991), Q18.mul(87621.18981), false);
    });

    it("simple amount from former fixed slot", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.6);
      await etoTerms.addWhitelisted([investorNoDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });

      await fullAmount(0, Q18.mul(1716.1991), true);
      // invest again
      await fullAmount(Q18.mul(1121.1991), Q18.mul(87621.18981), true);
    });
  });

  function discountTests(whitelistPriceFrac, publicPriceFrac) {
    function tokenAmount(_, amount, priceFraction = Q18) {
      // here we need to reproduce exact rounding as in smart contract
      const discountedPrice = divRound(tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(priceFraction), Q18);
      return amount.div(discountedPrice).floor();
    }

    async function amountNoFixedSlot(total, amount) {
      const info = await etoTerms.calculateContribution(
        investorNoDiscount,
        total,
        total,
        amount,
        true,
      );
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[4]).to.be.bignumber.eq(tokenAmount(total, amount, whitelistPriceFrac));
      expect(info[5]).to.be.bignumber.eq(0);
    }

    it("with no amount no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: deployer,
      });
      await amountNoFixedSlot(new web3.BigNumber(0), new web3.BigNumber(0));
    });

    it("with amount no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: deployer,
      });
      await amountNoFixedSlot(0, Q18.mul(8129.1991).add(1));
      // invest again
      await amountNoFixedSlot(Q18.mul(8129.1991).sub(1), Q18.mul(29811.18981));
    });

    it("with amount crossing max ticket no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: deployer,
      });
      await amountNoFixedSlot(0, terms.MAX_TICKET_EUR_ULPS.add(1));
    });

    it("with no amount and discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2).add(1);
      const priceFrac = Q18.mul(0.6);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, 0, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[4]).to.be.bignumber.eq(
        tokenAmount(new web3.BigNumber(0), new web3.BigNumber(0), whitelistPriceFrac),
      );
      expect(info[5]).to.be.bignumber.eq(0);
    });

    it("with amount below discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.6);
      const amount = discountAmount.divToInt(2);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[4]).to.be.bignumber.eq(tokenAmount(0, amount, priceFrac));
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with amount eq discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.6);
      const amount = discountAmount;
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[4]).to.be.bignumber.eq(tokenAmount(0, amount, priceFrac));
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with amount over discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2).sub(1);
      const priceFrac = Q18.mul(0.6);
      const amount = discountAmount.add(Q18);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      const expDiscountedTokens = tokenAmount(0, discountAmount, priceFrac);
      const expTokens = expDiscountedTokens.add(
        tokenAmount(discountAmount, amount.sub(discountAmount), whitelistPriceFrac),
      );
      expect(info[4]).to.be.bignumber.eq(expTokens);
      expect(info[5]).to.be.bignumber.eq(expDiscountedTokens);
    });

    it("with amount over discount in multiple steps", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.321).add(1);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });

      // all amount within discount
      const amount = discountAmount.divToInt(2);
      let info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[4]).to.be.bignumber.eq(tokenAmount(0, amount, priceFrac));
      expect(info[5]).to.be.bignumber.eq(info[4]);
      // next amount goes over discount
      const amount2 = amount.add(Q18);
      info = await etoTerms.calculateContribution(investorDiscount, amount, amount, amount2, true);
      const expDiscountedTokens = tokenAmount(amount, discountAmount.sub(amount), priceFrac);
      const expPrice = expDiscountedTokens.add(
        tokenAmount(discountAmount, amount2.sub(amount), whitelistPriceFrac),
      );
      expect(info[4]).to.be.bignumber.eq(expPrice);
      expect(info[5]).to.be.bignumber.eq(expDiscountedTokens);

      // next amount is without discount
      const amount3 = Q18.mul(19209.111).add(1);
      const total = amount.add(amount2);
      info = await etoTerms.calculateContribution(investorDiscount, total, total, amount3, true);
      expect(info[4]).to.be.bignumber.eq(tokenAmount(total, amount3, whitelistPriceFrac));
      expect(info[5]).to.be.bignumber.eq(0);
    });

    it("with discount max ticket higher than max ticket size for other investors", async () => {
      // discounts allow overriding max ticket sizes
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.mul(2);
      const priceFrac = Q18.mul(0.6);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(
        investorDiscount,
        0,
        0,
        discountAmount,
        true,
      );
      // max cap is discountAmount
      expect(info[3]).to.be.bignumber.eq(discountAmount);
      const expPrice = tokenAmount(0, discountAmount, priceFrac);
      expect(info[4]).to.be.bignumber.eq(expPrice);
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with discount min ticket lower than min ticket for other investors", async () => {
      // discounts allow overriding min ticket size
      const discountAmount = terms.MIN_TICKET_EUR_ULPS.div(2).round();
      const priceFrac = Q18.mul(0.7);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(
        investorDiscount,
        0,
        0,
        discountAmount,
        true,
      );
      expect(info[2]).to.be.bignumber.eq(discountAmount);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      const expPrice = tokenAmount(0, discountAmount, priceFrac);
      expect(info[4]).to.be.bignumber.eq(expPrice);
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with discount min ticket override not applied to public", async () => {
      // discounts allow overriding min ticket size
      const discountAmount = terms.MIN_TICKET_EUR_ULPS.div(2).round();
      const priceFrac = Q18.mul(0.7);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      let info = await etoTerms.calculateContribution(investorDiscount, 0, 0, discountAmount, true);
      expect(info[2]).to.be.bignumber.eq(discountAmount);
      info = await etoTerms.calculateContribution(investorDiscount, 0, 0, discountAmount, false);
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
    });

    it("with public ticket", async () => {
      const amount = Q18.mul(76251.212).add(1);
      const info = await etoTerms.calculateContribution(investorNoDiscount, 0, 0, amount, false);
      expect(info[0]).to.be.false;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      // apply public discount
      expect(info[4]).to.be.bignumber.eq(tokenAmount(0, amount, publicPriceFrac));
      // no fixed slot tokens
      expect(info[5]).to.be.bignumber.eq(0);
    });

    it("with empty (0) public ticket", async () => {
      const amount = Q18.mul(0);
      const info = await etoTerms.calculateContribution(investorNoDiscount, 0, 0, amount, false);
      expect(info[0]).to.be.false;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      // apply public discount
      expect(info[4]).to.be.bignumber.eq(0);
      // no fixed slot tokens
      expect(info[5]).to.be.bignumber.eq(0);
    });
  }

  function expectLogInvestorWhitelisted(event, investor, discountAmount, priceFracFrac) {
    expect(event.event).to.eq("LogInvestorWhitelisted");
    expect(event.args.investor).to.eq(investor);
    expect(event.args.discountAmountEurUlps).to.be.bignumber.eq(discountAmount);
    expect(event.args.fullTokenPriceFrac).to.be.bignumber.eq(priceFracFrac);
  }
});
