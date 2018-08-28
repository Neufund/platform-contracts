import { expect } from "chai";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { divRound } from "../helpers/unitConverter";
import EvmError from "../helpers/EVMThrow";
import { deployUniverse, deployPlatformTerms } from "../helpers/deployContracts";
import {
  deployShareholderRights,
  deployDurationTerms,
  deployTokenTerms,
  deployETOTerms,
} from "../helpers/deployTerms";
import { Q18 } from "../helpers/constants";
// import { duration } from "../../node_modules/moment";

const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const ShareholderRights = artifacts.require("ShareholderRights");

contract("ETOTerms", ([deployer, admin, investorDiscount, investorNoDiscount, ...investors]) => {
  let platformTerms;
  let etoTerms;
  let terms, termsKeys;
  let shareholderRights;
  let shareholderTerms, shareholderTermsKeys;
  let durationTerms;
  let durTerms, durationTermsKeys;
  let etoTokenTerms, tokenTerms, tokenTermsKeys;

  beforeEach(async () => {
    const [universe] = await deployUniverse(admin, admin);
    [platformTerms] = await deployPlatformTerms(universe, admin);
    [shareholderRights, shareholderTerms, shareholderTermsKeys] = await deployShareholderRights(
      ShareholderRights,
    );
    [durationTerms, durTerms, durationTermsKeys] = await deployDurationTerms(ETODurationTerms);
    [etoTokenTerms, tokenTerms, tokenTermsKeys] = await deployTokenTerms(ETOTokenTerms);
    [etoTerms, terms, termsKeys] = await deployETOTerms(
      ETOTerms,
      durationTerms,
      etoTokenTerms,
      shareholderRights,
    );
  });

  it("should deploy", async () => {
    await prettyPrintGasCost("ShareholderRights deploy", shareholderRights);
    await prettyPrintGasCost("ETODurationTerms deploy", durationTerms);
    await prettyPrintGasCost("ETOTerms deploy", etoTerms);
  });

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
    // todo: also verify parameters that are not set but part of interface
  });

  it("should verify terms in ETODurationTerms", async () => {
    await verifyTerms(durationTerms, durationTermsKeys, durTerms);
  });

  it("should verify terms in ETOTokenTerms", async () => {
    await verifyTerms(etoTokenTerms, tokenTermsKeys, tokenTerms);
  });

  it("should verify terms in ShareholderRights", async () => {
    await verifyTerms(shareholderRights, shareholderTermsKeys, shareholderTerms);
    // todo: also verify constant parameters
  });

  it("should verify default eto terms against platform terms", async () => {
    await etoTerms.requireValidTerms(platformTerms.address);
  });

  it("should reject on platform terms with minimum ticket too small", async () => {
    // change to sub(0) for this test to fail
    terms.MIN_TICKET_EUR_ULPS = (await platformTerms.MIN_TICKET_EUR_ULPS()).sub(1);
    const termsValues = termsKeys.map(v => terms[v]);
    // console.log(termsValues);
    etoTerms = await ETOTerms.new.apply(this, termsValues);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

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

  it("should accept new duration terms", async () => {
    // change to sub(0) for this test to fail

    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      WHITELIST_DURATION: (await platformTerms.MIN_WHITELIST_DURATION_DAYS()).add(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await etoTerms.requireValidTerms(platformTerms.address);
  });

  it("should reject on platform terms with whitelist duration too small", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      WHITELIST_DURATION: (await platformTerms.MIN_WHITELIST_DURATION_DAYS()).sub(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with whitelist duration too large", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      WHITELIST_DURATION: (await platformTerms.MAX_WHITELIST_DURATION_DAYS()).add(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with public duration too small", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      PUBLIC_DURATION: (await platformTerms.MIN_PUBLIC_DURATION_DAYS()).sub(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with public duration too large", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      PUBLIC_DURATION: (await platformTerms.MAX_PUBLIC_DURATION_DAYS()).add(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with signing duration too small", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      SIGNING_DURATION: (await platformTerms.MIN_SIGNING_DURATION_DAYS()).sub(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(
      "ETO_TERMS_SIG_MIN",
    );
  });

  it("should reject on platform terms with signing duration too large", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      SIGNING_DURATION: (await platformTerms.MAX_SIGNING_DURATION_DAYS()).add(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with claim duration too small", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      CLAIM_DURATION: (await platformTerms.MIN_CLAIM_DURATION_DAYS()).sub(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with claim duration too large", async () => {
    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      CLAIM_DURATION: (await platformTerms.MAX_CLAIM_DURATION_DAYS()).add(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with total duration too small", async () => {
    // change to sub(0) for this test to fail

    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      WHITELIST_DURATION: (await platformTerms.MIN_OFFER_DURATION_DAYS()).div(2),
      PUBLIC_DURATION: (await platformTerms.MIN_OFFER_DURATION_DAYS()).div(2).sub(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with total duration too large", async () => {
    // change to sub(0) for this test to fail

    [durationTerms] = await deployDurationTerms(ETODurationTerms, {
      WHITELIST_DURATION: (await platformTerms.MAX_OFFER_DURATION_DAYS()).div(2),
      PUBLIC_DURATION: (await platformTerms.MAX_OFFER_DURATION_DAYS()).div(2).add(1),
    });
    terms.DURATION_TERMS = durationTerms.address;
    const values = termsKeys.map(v => terms[v]);

    etoTerms = await ETOTerms.new.apply(this, values);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should reject on platform terms with minimum number of tokens too small", async () => {
    // change to sub(0) for this test to fail
    terms.MIN_NUMBER_OF_TOKENS = (await platformTerms.EQUITY_TOKENS_PER_SHARE()).sub(1);
    terms.IS_CROWDFUNDING = true;
    const termsValues = termsKeys.map(v => terms[v]);
    // console.log(termsValues);
    etoTerms = await ETOTerms.new.apply(this, termsValues);
    await expect(etoTerms.requireValidTerms(platformTerms.address)).to.be.rejectedWith(EvmError);
  });

  it("should compute estimated max cap and min cap in eur", async () => {
    // simple flat pricing without discounts
    const maxCap = await etoTerms.ESTIMATED_MAX_CAP_EUR_ULPS();
    expect(maxCap).to.be.bignumber.eq(
      tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(tokenTerms.MAX_NUMBER_OF_TOKENS),
    );
    const minCap = await etoTerms.ESTIMATED_MIN_CAP_EUR_ULPS();
    expect(minCap).to.be.bignumber.eq(
      tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(tokenTerms.MIN_NUMBER_OF_TOKENS),
    );
  });

  it("should compute tokens from eur", async () => {
    expect(
      await etoTerms.calculateTokenAmount(0, tokenTerms.TOKEN_PRICE_EUR_ULPS),
    ).to.be.bignumber.eq(1);
    expect(await etoTerms.calculateTokenAmount(0, 0)).to.be.bignumber.eq(0);
    expect(await etoTerms.calculateTokenAmount(0, Q18.mul(717271))).to.be.bignumber.eq(
      divRound(Q18.mul(717271), tokenTerms.TOKEN_PRICE_EUR_ULPS),
    );
  });

  it("should compute eurs from tokens", async () => {
    expect(await etoTerms.calculateEurUlpsAmount(0, 1)).to.be.bignumber.eq(
      tokenTerms.TOKEN_PRICE_EUR_ULPS,
    );
    expect(await etoTerms.calculateEurUlpsAmount(0, 0)).to.be.bignumber.eq(0);
    expect(await etoTerms.calculateEurUlpsAmount(0, 9812791)).to.be.bignumber.eq(
      tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(9812791),
    );
  });

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
      tx = await etoTerms.addWhitelisted([investorDiscount], [Q18.mul(500000)], [Q18.mul(0.6)], {
        from: deployer,
      });
      expectLogInvestorWhitelisted(tx.logs[0], investorDiscount, Q18.mul(500000), Q18.mul(0.6));
      ticket = await etoTerms.whitelistTicket(investorDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(Q18.mul(500000));
      expect(ticket[2]).to.be.bignumber.eq(Q18.mul(0.6));
    });

    // todo: use generator from ICBMCommitment
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
      ).to.be.rejectedWith("DISCOUNT_RANGE");

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
      ).to.be.rejectedWith("DISCOUNT_RANGE");
    });

    it("fails on setting token price frac > 1", async () => {
      await expect(
        etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18.add(1)], { from: deployer }),
      ).to.be.rejectedWith("DISCOUNT_RANGE");

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
      ).to.be.rejectedWith("DISCOUNT_RANGE");
    });
  });

  describe("contribution calculation with fixed slots and no whitelist discount", () => {
    beforeEach(async () => {
      terms.WHITELIST_DISCOUNT_FRAC = Q18.mul(0);
      const termsValues = termsKeys.map(v => terms[v]);
      etoTerms = await ETOTerms.new.apply(this, termsValues);
    });
    discountTests(Q18);
  });

  describe("contribution calculation with fixed slots and 99% whitelist discount", () => {
    beforeEach(async () => {
      terms.WHITELIST_DISCOUNT_FRAC = Q18.mul(0.99);
      const termsValues = termsKeys.map(v => terms[v]);
      etoTerms = await ETOTerms.new.apply(this, termsValues);
    });
    discountTests(Q18.mul(0.01));
  });

  describe("contribution calculation with fixed slots and 50.3761% whitelist discount", () => {
    beforeEach(async () => {
      terms.WHITELIST_DISCOUNT_FRAC = Q18.mul(0.503761);
      const termsValues = termsKeys.map(v => terms[v]);
      etoTerms = await ETOTerms.new.apply(this, termsValues);
    });
    discountTests(Q18.mul(1 - 0.503761));
  });

  describe("contribution calculation without discount", () => {
    function tokenPrice(_, amount) {
      return divRound(amount, tokenTerms.TOKEN_PRICE_EUR_ULPS);
    }

    async function fullAmount(total, amount) {
      const info = await etoTerms.calculateContribution(
        investorNoDiscount,
        total,
        total,
        amount,
        false,
      );
      expect(info[0]).to.be.false;
      expect(info[1]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[2]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(tokenPrice(total, amount));
      expect(info[4]).to.be.bignumber.eq(0);
    }

    it("simple amount", async () => {
      await fullAmount(0, Q18.mul(1716.1991));
      // invest again
      await fullAmount(Q18.mul(1121.1991), Q18.mul(87621.18981));
    });

    it("simple amount from former fixed slot", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.6);
      await etoTerms.addWhitelisted([investorNoDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });

      await fullAmount(0, Q18.mul(1716.1991));
      // invest again
      await fullAmount(Q18.mul(1121.1991), Q18.mul(87621.18981));
    });
  });

  function discountTests(fullPriceFraction) {
    function tokenPrice(_, amount, priceFraction = Q18) {
      // here we need to reproduce exact rounding as in smart contract
      const discountedPrice = divRound(tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(priceFraction), Q18);
      return divRound(amount, discountedPrice);
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
      expect(info[1]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[2]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(tokenPrice(total, amount, fullPriceFraction));
      expect(info[4]).to.be.bignumber.eq(0);
    }

    it("with no amount no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: deployer,
      });
      await amountNoFixedSlot(0, 0);
    });

    it("with amount no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: deployer,
      });
      await amountNoFixedSlot(0, Q18.mul(8129.1991));
      // invest again
      await amountNoFixedSlot(Q18.mul(8129.1991), Q18.mul(29811.18981));
    });

    it("with amount crossing max ticket no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: deployer,
      });
      await amountNoFixedSlot(0, terms.MAX_TICKET_EUR_ULPS.add(1));
    });

    it("with no amount and discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.6);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, 0, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[2]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(tokenPrice(0, 0, fullPriceFraction));
      expect(info[4]).to.be.bignumber.eq(0);
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
      expect(info[1]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[2]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(tokenPrice(0, amount, priceFrac));
      expect(info[4]).to.be.bignumber.eq(info[3]);
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
      expect(info[1]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[2]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(tokenPrice(0, amount, priceFrac));
      expect(info[4]).to.be.bignumber.eq(info[3]);
    });

    it("with amount over discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.6);
      const amount = discountAmount.add(Q18);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[2]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      const expDiscountedTokens = tokenPrice(0, discountAmount, priceFrac);
      const expTokens = expDiscountedTokens.add(
        tokenPrice(discountAmount, amount.sub(discountAmount), fullPriceFraction),
      );
      expect(info[3]).to.be.bignumber.eq(expTokens);
      expect(info[4]).to.be.bignumber.eq(expDiscountedTokens);
    });

    it("with amount over discount in multiple steps", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.321);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: deployer,
      });

      // all amount within discount
      const amount = discountAmount.divToInt(2);
      let info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[3]).to.be.bignumber.eq(tokenPrice(0, amount, priceFrac));
      expect(info[4]).to.be.bignumber.eq(info[3]);
      // next amount goes over discount
      const amount2 = amount.add(Q18);
      info = await etoTerms.calculateContribution(investorDiscount, amount, amount, amount2, true);
      const expDiscountedTokens = tokenPrice(amount, discountAmount.sub(amount), priceFrac);
      const expPrice = expDiscountedTokens.add(
        tokenPrice(discountAmount, amount2.sub(amount), fullPriceFraction),
      );
      expect(info[3]).to.be.bignumber.eq(expPrice);
      expect(info[4]).to.be.bignumber.eq(expDiscountedTokens);

      // next amount is without discount
      const amount3 = Q18.mul(19209.111);
      const total = amount.add(amount2);
      info = await etoTerms.calculateContribution(investorDiscount, total, total, amount3, true);
      expect(info[3]).to.be.bignumber.eq(tokenPrice(total, amount3, fullPriceFraction));
      expect(info[4]).to.be.bignumber.eq(0);
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
      expect(info[2]).to.be.bignumber.eq(discountAmount);
      const expPrice = tokenPrice(0, discountAmount, priceFrac);
      expect(info[3]).to.be.bignumber.eq(expPrice);
      expect(info[4]).to.be.bignumber.eq(info[3]);
    });
  }

  function expectLogInvestorWhitelisted(event, investor, discountAmount, priceFracFrac) {
    expect(event.event).to.eq("LogInvestorWhitelisted");
    expect(event.args.investor).to.eq(investor);
    expect(event.args.discountAmountEurUlps).to.be.bignumber.eq(discountAmount);
    expect(event.args.fullTokenPriceFrac).to.be.bignumber.eq(priceFracFrac);
  }
});
