import { expect } from "chai";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { divRound } from "../helpers/unitConverter";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployPlatformTerms,
} from "../helpers/deployContracts";
import {
  deployTokenholderRights,
  deployDurationTerms,
  deployTokenTerms,
  deployETOTermsConstraintsUniverse,
  deployETOTermsConstraints,
  deployETOTerms,
  defTokenTerms,
  verifyTerms,
} from "../helpers/deployTerms";
import { Q18, web3, defEquityTokenPower, decimalBase } from "../helpers/constants";
import { contractId } from "../helpers/utils";
import roles from "../helpers/roles";
import createAccessPolicy from "../helpers/createAccessPolicy";

const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const TokenholderRights = artifacts.require("EquityTokenholderRights");
const ETOTermsConstraints = artifacts.require("ETOTermsConstraints");

contract("ETOTerms", ([, admin, investorDiscount, investorNoDiscount, ...investors]) => {
  let universe;
  let accessPolicy;
  let termsConstraints;
  let etoTerms;
  let terms, termsKeys;
  let tokenholderRights;
  let tokenholderTerms, tokenholderTermsKeys;
  let durationTerms;
  let durTerms, durationTermsKeys;
  let etoTokenTerms, tokenTerms, tokenTermsKeys;

  beforeEach(async () => {
    [universe, accessPolicy] = await deployUniverse(admin, admin);
    await deployIdentityRegistry(universe, admin, admin);
    await deployPlatformTerms(universe, admin);

    [tokenholderRights, tokenholderTerms, tokenholderTermsKeys] = await deployTokenholderRights(
      TokenholderRights,
    );
    [durationTerms, durTerms, durationTermsKeys] = await deployDurationTerms(ETODurationTerms);
    [etoTokenTerms, tokenTerms, tokenTermsKeys] = await deployTokenTerms(ETOTokenTerms);
    [etoTerms, terms, termsKeys] = await redeployTerms(
      {},
      { MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(200) },
    );
  });

  it("should deploy", async () => {
    await prettyPrintGasCost("TokenholderRights deploy", tokenholderRights);
    await prettyPrintGasCost("ETODurationTerms deploy", durationTerms);
    await prettyPrintGasCost("ETOTerms deploy", etoTerms);
    await prettyPrintGasCost("ETOTokenTerms deploy", etoTokenTerms);
    expect((await tokenholderRights.contractId())[0]).to.eq(contractId("EquityTokenholderRights"));
    expect((await durationTerms.contractId())[0]).to.eq(contractId("ETODurationTerms"));
    expect((await etoTerms.contractId())[0]).to.eq(contractId("ETOTerms"));
    expect((await etoTokenTerms.contractId())[0]).to.eq(contractId("ETOTokenTerms"));
  });

  async function redeployTerms(etoTermsOverride, constraintsOverride) {
    [termsConstraints] = await deployETOTermsConstraintsUniverse(
      admin,
      universe,
      ETOTermsConstraints,
      constraintsOverride,
    );

    const [deployedTerms, _etoTerms, _termsKeys, termsValues] = await deployETOTerms(
      universe,
      ETOTerms,
      durationTerms,
      etoTokenTerms,
      tokenholderRights,
      termsConstraints,
      etoTermsOverride,
    );
    // admin gets whitelist rights
    await createAccessPolicy(accessPolicy, [
      { role: roles.whitelistAdmin, object: _etoTerms.address, subject: admin },
    ]);
    return [deployedTerms, _etoTerms, _termsKeys, termsValues];
  }

  it("should reject constraints not in universe", async () => {
    [termsConstraints] = await deployETOTermsConstraints(ETOTermsConstraints, {});

    await expect(
      deployETOTerms(
        universe,
        ETOTerms,
        durationTerms,
        etoTokenTerms,
        tokenholderRights,
        termsConstraints,
        {},
      ),
    ).to.be.rejectedWith("NF_TERMS_NOT_IN_UNIVERSE");
  });

  it("should save ETOTerms Contraints", async () => {
    expect(await etoTerms.ETO_TERMS_CONSTRAINTS()).to.eq(termsConstraints.address);
  });

  it("should verify terms in ETOTerms", async () => {
    await verifyTerms(etoTerms, termsKeys, terms);
    // verify available tokens
    expect(await etoTerms.MAX_AVAILABLE_TOKENS()).to.be.bignumber.eq(
      defTokenTerms.MAX_NUMBER_OF_TOKENS.div("1.02").round(0, 4),
    );
    // MAX_AVAILABLE_TOKENS_IN_WHITELIST not crossing over MAX_AVAILABLE_TOKENS
    expect(await etoTerms.MAX_AVAILABLE_TOKENS_IN_WHITELIST()).to.be.bignumber.eq(
      defTokenTerms.MAX_NUMBER_OF_TOKENS_IN_WHITELIST,
    );
  });

  it("ETOTerms: also verify constant parameters that are not set but part of interface");

  it("should verify terms in ETODurationTerms", async () => {
    await verifyTerms(durationTerms, durationTermsKeys, durTerms);
  });

  it("should verify terms in ETOTokenTerms", async () => {
    await verifyTerms(etoTokenTerms, tokenTermsKeys, tokenTerms);
  });

  it("should verify terms in TokenholderRights", async () => {
    await verifyTerms(tokenholderRights, tokenholderTermsKeys, tokenholderTerms);
  });

  it("TokenholderRights todo: also verify constant parameters");

  it("should verify default eto terms", async () => {
    await etoTerms.requireValidTerms();
  });

  it("should calculate share price in token terms", async () => {
    expect(await etoTokenTerms.SHARE_PRICE_EUR_ULPS()).to.be.bignumber.eq(
      divRound(
        defTokenTerms.TOKEN_PRICE_EUR_ULPS.mul(defTokenTerms.EQUITY_TOKENS_PER_SHARE),
        getTokenPower(defTokenTerms),
      ),
    );
  });

  it("should convert equity token amount to shares", async () => {
    const amounts = [
      "1",
      tokenTerms.EQUITY_TOKENS_PER_SHARE,
      "599",
      Q18,
      "71627621",
      tokenTerms.EQUITY_TOKENS_PER_SHARE.mul("762651"),
    ].map(a => new web3.BigNumber(a));
    for (const amount of amounts) {
      expect(await etoTerms.equityTokensToSharesFrac(amount)).to.be.bignumber.eq(
        divRound(amount.mul(Q18), tokenTerms.EQUITY_TOKENS_PER_SHARE),
      );
    }
    // make precomputed test
    const wholeTokens = getTokenPower(tokenTerms).mul(1161);
    expect(await etoTerms.equityTokensToSharesFrac(wholeTokens)).to.be.bignumber.eq(
      decimalBase
        .pow(18 - Math.log10(tokenTerms.EQUITY_TOKENS_PER_SHARE.toNumber()))
        .mul(wholeTokens),
    );
  });

  it("should calculate actual equity token price", async () => {
    const amountEurUlps = Q18.mul("12712").add("17621728");
    const amountTokens = defEquityTokenPower.mul("7362").add("162");
    // reproduce contract rounding (HALF_UP)
    expect(await etoTerms.calculateTokenEurPrice(amountEurUlps, amountTokens)).to.be.bignumber.eq(
      divRound(amountEurUlps.mul(defEquityTokenPower), amountTokens),
    );
  });

  it("should correctly calculate available tokens", async () => {
    const maxNumberOfTokens = getTokenPower(tokenTerms).mul(new web3.BigNumber("32039029039"));
    const availableTokens = maxNumberOfTokens.div("1.02").round(0, 4);
    const tokenPower = getTokenPower(defTokenTerms);
    const testCases = [
      [maxNumberOfTokens, availableTokens],
      [availableTokens.add(1), availableTokens],
      [availableTokens.add(tokenPower), availableTokens],
      [availableTokens, availableTokens],
      [availableTokens.sub(1), availableTokens.sub(1)],
      [availableTokens.sub(tokenPower), availableTokens.sub(tokenPower)],
    ];
    for (const wlTokensMap of testCases) {
      [etoTokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        EQUITY_TOKENS_PER_SHARE: tokenPower,
        MAX_NUMBER_OF_TOKENS: maxNumberOfTokens,
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST: wlTokensMap[0],
      });
      const [deployedTerms] = await redeployTerms();
      expect(await deployedTerms.MAX_AVAILABLE_TOKENS_IN_WHITELIST()).to.be.bignumber.eq(
        wlTokensMap[1],
      );
    }
  });

  describe("terms validation", () => {
    it("rejects on token terms with minimum ticket too small", async () => {
      // change to sub(0) for this test to fail
      await expect(
        redeployTerms(
          { MIN_TICKET_EUR_ULPS: Q18.mul(200).sub(1) },
          { MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(200) },
        ),
      ).to.be.rejectedWith("NF_ETO_TERMS_MIN_TICKET_EUR_ULPS");
    });

    it("rejects on tokens per share not in whole tokens", async () => {
      // tokens per share must be in whole tokens, so set tokens per share 1/10 of the whole tokens
      // so other "whole tokens" checks work but this particular don't
      const decimals = new web3.BigNumber("1");
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          EQUITY_TOKEN_DECIMALS: decimals, // one decimal place
          EQUITY_TOKENS_PER_SHARE: decimalBase.div(10), // scale is ten but set scale / 10
        }),
      ).to.be.rejectedWith("NF_SHARES_NOT_WHOLE_TOKENS");
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

    it("reverts on transferable token for non transferable eto constraints", async () => {
      await expect(
        redeployTerms({ ENABLE_TRANSFERS_ON_SUCCESS: true }, { CAN_SET_TRANSFERABILITY: false }),
      ).to.be.rejectedWith("NF_ETO_TERMS_ENABLE_TRANSFERS_ON_SUCCESS");
    });

    // MIN_TICKET_LT_TOKEN_PRICE
    it("rejects ETO TERMS on min ticket less than token price", async () => {
      [etoTokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        TOKEN_PRICE_EUR_ULPS: terms.MIN_TICKET_EUR_ULPS.add(1),
      });
      await expect(
        redeployTerms(
          { TOKEN_TERMS: etoTokenTerms },
          { MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10).sub(1) },
        ),
      ).to.be.rejectedWith("NF_MIN_TICKET_LT_TOKEN_PRICE");
    });

    // MAX_FUNDS_LT_MIN_TICKET - otherwise it's impossible to succesfully complete ETO
    it("rejects ETO TERMS if maximum funds collected less than min ticket", async () => {
      // lower number of tokens required and min ticket
      const modMinTicket = Q18.mul(100000);
      [etoTokenTerms, tokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        MIN_NUMBER_OF_TOKENS: tokenTerms.EQUITY_TOKENS_PER_SHARE,
        MAX_NUMBER_OF_TOKENS: tokenTerms.EQUITY_TOKENS_PER_SHARE.mul(2),
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST: tokenTerms.EQUITY_TOKENS_PER_SHARE.div(100),
      });
      const power = getTokenPower(tokenTerms);
      // that works on available tokens that are counted into max investment value
      const availableTokens = tokenTerms.MAX_NUMBER_OF_TOKENS.div("1.02").round(0, 4);
      // set public discount so it's impossible to successfully complete ETO becaue min ticket > cap
      const pubPriceFraction = Q18.mul(modMinTicket)
        .mul(power)
        .divToInt(tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(availableTokens));
      // that must pass
      await redeployTerms({
        MIN_TICKET_EUR_ULPS: modMinTicket,
        PUBLIC_DISCOUNT_FRAC: Q18.sub(pubPriceFraction),
      });
      // use a little bit smaller fraction to cross into < max cap (smaller fraction -> bigger discount)
      await expect(
        redeployTerms({
          MIN_TICKET_EUR_ULPS: modMinTicket,
          PUBLIC_DISCOUNT_FRAC: Q18.sub(pubPriceFraction.sub(10)),
        }),
      ).to.be.rejectedWith("NF_MAX_FUNDS_LT_MIN_TICKET");
    });

    it("rejects discounts not in range", async () => {
      const maxDiscount = Q18.mul("0.99");
      await expect(
        redeployTerms({
          PUBLIC_DISCOUNT_FRAC: maxDiscount.add(1),
        }),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");
      await expect(
        redeployTerms({
          WHITELIST_DISCOUNT_FRAC: maxDiscount.add(1),
        }),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");
      await redeployTerms({
        PUBLIC_DISCOUNT_FRAC: maxDiscount,
      });
    });

    it("rejects min investment amount without discounts > terms contraints maximum investment", async () => {
      // current constrains have limit 5*10^6 EUR
      const maxInvestmentConstraintEur = new web3.BigNumber("5000000");
      [etoTokenTerms, tokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        MIN_NUMBER_OF_TOKENS: defEquityTokenPower.mul(maxInvestmentConstraintEur),
        MAX_NUMBER_OF_TOKENS: defEquityTokenPower.mul(maxInvestmentConstraintEur.mul(2)),
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST: defEquityTokenPower.mul(maxInvestmentConstraintEur),
        TOKEN_PRICE_EUR_ULPS: Q18,
      });
      // exactly at the limit
      await redeployTerms(
        {},
        { MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(maxInvestmentConstraintEur) },
      );
      // cross the limit
      await expect(
        redeployTerms(
          {},
          { MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(maxInvestmentConstraintEur).sub(1) },
        ),
      ).to.be.rejectedWith("NF_MIN_CAP_GT_PROD_MAX_CAP");
      // public discount lowers it and let's pass
      await redeployTerms(
        {
          PUBLIC_DISCOUNT_FRAC: Q18.mul("0.00001"),
        },
        { MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(maxInvestmentConstraintEur).sub(1) },
      );
    });

    it("rejects if max tokens not fit in 2**128", async () => {
      // force token decimals of 0 (indivisible), to operate on 32bytes word range
      const b2 = new web3.BigNumber("2");
      const b1 = new web3.BigNumber("1");
      // should pass - just one share below 2**256
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          EQUITY_TOKEN_DECIMALS: new web3.BigNumber("0"),
          EQUITY_TOKENS_PER_SHARE: b1,
          MAX_NUMBER_OF_TOKENS: b2.pow(128).sub(b1),
          TOKEN_PRICE_EUR_ULPS: b1,
        }),
      ).to.be.rejectedWith("NF_TOO_MUCH_FUNDS_COLLECTED");
      // won't fit
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          EQUITY_TOKENS_PER_SHARE: b1,
          TOKEN_PRICE_EUR_ULPS: b1,
          MAX_NUMBER_OF_TOKENS: b2.pow(128),
        }),
      ).to.be.rejectedWith("NF_TOO_MANY_TOKENS");
    });

    it("rejects if max funds possibly collected not fit in 2**112", async () => {
      const b2 = new web3.BigNumber("2");
      const maxTokenPrice = b2
        .pow("112")
        .div(tokenTerms.MAX_NUMBER_OF_TOKENS)
        .mul(getTokenPower(tokenTerms))
        .floor();
      // should pass
      await deployTokenTerms(ETOTokenTerms, {
        TOKEN_PRICE_EUR_ULPS: maxTokenPrice,
      });
      // won't fit
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          TOKEN_PRICE_EUR_ULPS: maxTokenPrice.add(1),
        }),
      ).to.be.rejectedWith("NF_TOO_MUCH_FUNDS_COLLECTED");
    });

    it("reject token terms on min tokens less than max available tokens", async () => {
      const tps = tokenTerms.EQUITY_TOKENS_PER_SHARE;
      const maxNumberOfTokens = tps.mul("1764783");
      const availableTokens = maxNumberOfTokens.div("1.02").round(0, 4);
      // all good
      [etoTokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        EQUITY_TOKENS_PER_SHARE: tps,
        MAX_NUMBER_OF_TOKENS: maxNumberOfTokens,
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(0),
        MIN_NUMBER_OF_TOKENS: availableTokens,
      });
      const [deployedTerms] = await redeployTerms();
      expect(await deployedTerms.MAX_AVAILABLE_TOKENS()).to.be.bignumber.eq(availableTokens);
      // should revert
      [etoTokenTerms] = await deployTokenTerms(ETOTokenTerms, {
        EQUITY_TOKENS_PER_SHARE: tps,
        MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(0),
        MAX_NUMBER_OF_TOKENS: maxNumberOfTokens,
        MIN_NUMBER_OF_TOKENS: availableTokens.add(1),
      });
      await expect(redeployTerms({}, {})).to.be.rejectedWith("NF_AVAILABLE_TOKEN_LT_MIN_TOKENS");
    });

    it("should reject TOKEN TERMS on max tokens less than whitelist tokens", async () => {
      // whitelist tokens must be < max tokens
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          MIN_NUMBER_OF_TOKENS: defTokenTerms.EQUITY_TOKENS_PER_SHARE,
          MAX_NUMBER_OF_TOKENS: defTokenTerms.EQUITY_TOKENS_PER_SHARE.mul(2),
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: defTokenTerms.EQUITY_TOKENS_PER_SHARE.mul(2).add(1),
        }),
      ).to.be.rejectedWith("NF_WL_TOKENS_GT_MAX_TOKENS");
    });

    it("rejects on max tokens not representing full shares", async () => {
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          MAX_NUMBER_OF_TOKENS_IN_WHITELIST: new web3.BigNumber(0),
          MIN_NUMBER_OF_TOKENS: defTokenTerms.EQUITY_TOKENS_PER_SHARE,
          MAX_NUMBER_OF_TOKENS: defTokenTerms.EQUITY_TOKENS_PER_SHARE.mul(2).sub(1),
        }),
      ).to.be.rejectedWith("NF_MAX_TOKENS_FULL_SHARES");
    });

    it("should reject on platform terms with minimum number of tokens less than one share", async () => {
      await expect(
        deployTokenTerms(ETOTokenTerms, {
          MIN_NUMBER_OF_TOKENS: tokenTerms.EQUITY_TOKENS_PER_SHARE.sub(1),
        }),
      ).to.be.rejectedWith("NF_ETO_TERMS_ONE_SHARE");
    });

    it("should reject on minimum ticket too small", async () => {
      await expect(
        redeployTerms(
          {
            MIN_TICKET_EUR_ULPS: Q18.mul(200).sub(1),
          },
          {
            MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(200),
          },
        ),
      ).to.be.rejectedWith("NF_ETO_TERMS_MIN_TICKET_EUR_ULPS");
    });

    it("should reject on maximum ticket too high", async () => {
      await expect(
        redeployTerms(
          {
            MIN_TICKET_EUR_ULPS: Q18.mul(5000).add(1),
          },
          {
            MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(5000),
          },
        ),
      ).to.be.rejectedWith("NF_ETO_TERMS_MAX_TICKET_EUR_ULPS");
    });

    it("should interpret MAX_TICKET_SIZE_EUR_ULPS == 0 as unlimited", async () => {
      await redeployTerms(
        {
          MIN_TICKET_EUR_ULPS: Q18.mul(5000),
          MAX_TICKET_EUR_ULPS: Q18.mul(10000),
        },
        {
          MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
        },
      );
    });
  });

  describe("duration validations", () => {
    it("should accept new duration terms", async () => {
      // change to sub(0) for this test to fail
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        WHITELIST_DURATION: (await termsConstraints.MIN_WHITELIST_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      const [modifiedTerms] = await redeployTerms();
      await modifiedTerms.requireValidTerms();
    });

    it("should reject on platform terms with whitelist duration too small", async function() {
      const minWhitelistDuration = await termsConstraints.MIN_WHITELIST_DURATION();
      // minimum limit must be > 0
      if (minWhitelistDuration.gt(0)) {
        [durationTerms] = await deployDurationTerms(ETODurationTerms, {
          WHITELIST_DURATION: (await termsConstraints.MIN_WHITELIST_DURATION()).sub(1),
        });
        // redeploy with new durationTerms
        await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_WL_D_MIN");
      } else {
        this.skip();
      }
    });

    it("should reject on platform terms with whitelist duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        WHITELIST_DURATION: (await termsConstraints.MAX_WHITELIST_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_WL_D_MAX");
    });

    it("should reject on platform terms with public duration too small", async function() {
      const minPublicDuration = await termsConstraints.MIN_PUBLIC_DURATION();
      if (minPublicDuration.gt(0)) {
        [durationTerms] = await deployDurationTerms(ETODurationTerms, {
          PUBLIC_DURATION: minPublicDuration.sub(1),
        });
        // redeploy with new durationTerms
        await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_PUB_D_MIN");
      } else {
        this.skip();
      }
    });

    it("should reject on platform terms with public duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        PUBLIC_DURATION: (await termsConstraints.MAX_PUBLIC_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_PUB_D_MAX");
    });

    it("should reject on platform terms with signing duration too small", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        SIGNING_DURATION: (await termsConstraints.MIN_SIGNING_DURATION()).sub(1),
      });
      // redeploy with new durationTerms
      await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_SIG_MIN");
    });

    it("should reject on platform terms with signing duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        SIGNING_DURATION: (await termsConstraints.MAX_SIGNING_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_SIG_MAX");
    });

    it("should reject on platform terms with claim duration too small", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        CLAIM_DURATION: (await termsConstraints.MIN_CLAIM_DURATION()).sub(1),
      });
      // redeploy with new durationTerms
      await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_CLAIM_MIN");
    });

    it("should reject on platform terms with claim duration too large", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        CLAIM_DURATION: (await termsConstraints.MAX_CLAIM_DURATION()).add(1),
      });
      // redeploy with new durationTerms
      await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_CLAIM_MAX");
    });

    it("should reject on platform terms with total duration too small", async () => {
      [durationTerms] = await deployDurationTerms(ETODurationTerms, {
        WHITELIST_DURATION: (await termsConstraints.MIN_OFFER_DURATION()).div(2),
        PUBLIC_DURATION: (await termsConstraints.MIN_OFFER_DURATION()).div(2).sub(1),
      });
      // redeploy with new durationTerms
      await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_TOT_O_MIN");
    });

    it("should reject on platform terms with total duration too large", async function() {
      const maxOfferDuration = await termsConstraints.MAX_OFFER_DURATION();
      const maxWlPubDuration = (await termsConstraints.MAX_WHITELIST_DURATION()).add(
        await termsConstraints.MAX_PUBLIC_DURATION(),
      );
      if (maxWlPubDuration.gt(maxOfferDuration)) {
        // todo: this test has many internal cases and needs improvement, with current platform settings it will not be executed
        [durationTerms] = await deployDurationTerms(ETODurationTerms, {
          WHITELIST_DURATION: (await termsConstraints.MAX_WHITELIST_DURATION()).sub(1),
        });
        // redeploy with new durationTerms
        await expect(redeployTerms()).to.be.rejectedWith("NF_ETO_TERMS_TOT_O_MAX");
      } else {
        this.skip();
      }
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
          PUBLIC_DISCOUNT_FRAC: Q18.mul("0.7651"),
        });
      });

      generalCalculationTests(Q18.mul(1 - 0.7651));
    });
  });

  function generalCalculationTests(priceFraction) {
    const tokenPrice = () => divRound(tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(priceFraction), Q18);

    function tokenAmount(amount, power) {
      // here we need to reproduce exact rounding as in smart contract (FLOOR)
      return amount.mul(power).divToInt(tokenPrice());
    }

    function eurAmount(amount, power) {
      // here we need to reproduce exact rounding as in smart contract (HALF_UP)
      return divRound(amount.mul(tokenPrice()), power);
    }

    it("should calculate price fraction", async () => {
      expect(await etoTerms.calculatePriceFraction(priceFraction)).to.be.bignumber.eq(tokenPrice());
    });

    it("should compute tokens from eur", async () => {
      const tokenPower = getTokenPower(tokenTerms);
      expect(await etoTerms.calculateTokenAmount(0, tokenPrice())).to.be.bignumber.eq(
        tokenPower.mul(1),
      );
      expect(await etoTerms.calculateTokenAmount(0, 0)).to.be.bignumber.eq(0);
      const ticket = Q18.mul(717271).add(1);
      expect(await etoTerms.calculateTokenAmount(0, ticket)).to.be.bignumber.eq(
        tokenAmount(ticket, tokenPower),
      );
      const ticket2 = Q18.mul(7162.129821);
      expect(await etoTerms.calculateTokenAmount(0, ticket2)).to.be.bignumber.eq(
        tokenAmount(ticket2, tokenPower),
      );
    });

    it("should compute eurs from tokens", async () => {
      const tokenPower = getTokenPower(tokenTerms);
      expect(await etoTerms.calculateEurUlpsAmount(0, tokenPower)).to.be.bignumber.eq(tokenPrice());
      expect(await etoTerms.calculateEurUlpsAmount(0, 0)).to.be.bignumber.eq(0);
      const tokens1 = tokenPower.mul(new web3.BigNumber(9812791));
      expect(await etoTerms.calculateEurUlpsAmount(0, tokens1)).to.be.bignumber.eq(
        eurAmount(tokens1, tokenPower),
      );
      const tokens2 = tokenPower.mul(new web3.BigNumber(9812791));
      expect(await etoTerms.calculateEurUlpsAmount(0, tokens2)).to.be.bignumber.eq(
        eurAmount(tokens2, tokenPower),
      );
    });
  }

  describe("whitelist tests", () => {
    it("add single investor", async () => {
      // no discount
      let tx = await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], { from: admin });
      expectLogInvestorWhitelisted(tx.logs[0], investorNoDiscount, 0, Q18);
      let ticket = await etoTerms.whitelistTicket(investorNoDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(0);
      expect(ticket[2]).to.be.bignumber.eq(Q18);

      // with discount of 40% with ticket 500000
      const whitelistedAmount = Q18.mul(500000).add(1);
      const discount = Q18.mul("0.6").sub(1);
      tx = await etoTerms.addWhitelisted([investorDiscount], [whitelistedAmount], [discount], {
        from: admin,
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
          from: admin,
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

    it("reverts on add to whitelist not from whitelist admin role", async () => {
      await expect(
        etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], { from: investors[3] }),
      ).to.revert;
    });

    it("overrides single investor", async () => {
      let tx = await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], { from: admin });
      expectLogInvestorWhitelisted(tx.logs[0], investorNoDiscount, 0, Q18);
      let ticket = await etoTerms.whitelistTicket(investorNoDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(0);
      expect(ticket[2]).to.be.bignumber.eq(Q18);

      tx = await etoTerms.addWhitelisted([investorNoDiscount], [Q18.mul(500000)], [Q18.mul(0.6)], {
        from: admin,
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
          from: admin,
        },
      );

      await etoTerms.addWhitelisted(
        [investors[0], investors[1], investors[2]],
        [Q18.mul(800000), Q18.mul(900000), Q18.mul(1000000)],
        [Q18.mul(0.2), Q18.mul(0.3), Q18.mul(0.4)],
        {
          from: admin,
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

    it("should delete ticket", async () => {
      let tx = await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], { from: admin });
      expectLogInvestorWhitelisted(tx.logs[0], investorNoDiscount, 0, Q18);
      let ticket = await etoTerms.whitelistTicket(investorNoDiscount);
      expect(ticket[0]).to.be.true;
      expect(ticket[1]).to.be.bignumber.eq(0);
      expect(ticket[2]).to.be.bignumber.eq(Q18);

      tx = await etoTerms.addWhitelisted([investorNoDiscount], [0], [0], { from: admin });
      expectLogInvestorWhitelisted(tx.logs[0], investorNoDiscount, 0, 0);
      ticket = await etoTerms.whitelistTicket(investorNoDiscount);
      expect(ticket[0]).to.be.false;
      expect(ticket[1]).to.be.bignumber.eq(0);
      expect(ticket[2]).to.be.bignumber.eq(0);
    });

    it("fails on setting token price frac to 0", async () => {
      // only cominations of 0 fraction and non zero discount amount is not allowed
      await expect(
        etoTerms.addWhitelisted([investorNoDiscount], [1], [0], { from: admin }),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");

      // fail on set many
      await expect(
        etoTerms.addWhitelisted(
          [investors[0], investors[1], investors[2]],
          [Q18.mul(500000), Q18.mul(0), Q18.mul(700000)],
          [0, Q18.mul(0.6), Q18.mul(0.7)],
          {
            from: admin,
          },
        ),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");
    });

    it("fails on setting token price frac > 1", async () => {
      await expect(
        etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18.add(1)], { from: admin }),
      ).to.be.rejectedWith("NF_DISCOUNT_RANGE");

      // fail on set many
      await expect(
        etoTerms.addWhitelisted(
          [investors[0], investors[1], investors[2]],
          [Q18.mul("500000"), Q18.mul("600000"), Q18.mul("700000")],
          [Q18.mul("0.6"), Q18.mul("0.7"), Q18.add(1)],
          {
            from: admin,
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
        WHITELIST_DISCOUNT_FRAC: Q18.mul("0.99"),
        PUBLIC_DISCOUNT_FRAC: Q18.mul(0),
      });
    });
    discountTests(Q18.mul("0.01"), Q18);
  });

  describe("contribution calculation with fixed slots and 50.3761% whitelist discount", () => {
    beforeEach(async () => {
      [etoTerms, terms, termsKeys] = await redeployTerms({
        WHITELIST_DISCOUNT_FRAC: Q18.mul("0.503761"),
        PUBLIC_DISCOUNT_FRAC: Q18.mul(0),
      });
    });
    discountTests(Q18.sub(Q18.mul("0.503761")), Q18);
  });

  describe("contribution calculation with fixed slots, whitelist and public discounts", () => {
    beforeEach(async () => {
      [etoTerms, terms, termsKeys] = await redeployTerms({
        WHITELIST_DISCOUNT_FRAC: Q18.mul("0.503761"),
        PUBLIC_DISCOUNT_FRAC: Q18.mul("0.7651"),
      });
    });
    discountTests(Q18.sub(Q18.mul("0.503761")), Q18.sub(Q18.mul("0.7651")));
  });

  describe("contribution calculation without discount", () => {
    function tokenAmount(_, amount, power) {
      return amount.mul(power).divToInt(tokenTerms.TOKEN_PRICE_EUR_ULPS);
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
      expect(info[4]).to.be.bignumber.eq(tokenAmount(total, amount, getTokenPower(tokenTerms)));
      expect(info[5]).to.be.bignumber.eq(0);
    }

    it("simple amount", async () => {
      await fullAmount(0, Q18.mul("1716.1991"), false);
      // invest again
      await fullAmount(Q18.mul("1121.1991"), Q18.mul("87621.18981"), false);
    });

    it("simple amount from former fixed slot", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul("0.6");
      await etoTerms.addWhitelisted([investorNoDiscount], [discountAmount], [priceFrac], {
        from: admin,
      });

      await fullAmount(0, Q18.mul("1716.1991"), true);
      // invest again
      await fullAmount(Q18.mul("1121.1991"), Q18.mul("87621.18981"), true);
    });
  });

  function discountTests(whitelistPriceFrac, publicPriceFrac) {
    function tokenAmount(_, amount, power, priceFraction = Q18) {
      // here we need to reproduce exact rounding as in smart contract
      const discountedPrice = divRound(tokenTerms.TOKEN_PRICE_EUR_ULPS.mul(priceFraction), Q18);
      return amount.mul(power).divToInt(discountedPrice);
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
      expect(info[4]).to.be.bignumber.eq(
        tokenAmount(total, amount, getTokenPower(tokenTerms), whitelistPriceFrac),
      );
      expect(info[5]).to.be.bignumber.eq(0);
    }

    it("with no amount no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: admin,
      });
      await amountNoFixedSlot(new web3.BigNumber(0), new web3.BigNumber(0));
    });

    it("with amount no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: admin,
      });
      await amountNoFixedSlot(0, Q18.mul("8129.1991").add(1));
      // invest again
      await amountNoFixedSlot(Q18.mul("8129.1991").sub(1), Q18.mul("29811.18981"));
    });

    it("with amount crossing max ticket no discount", async () => {
      await etoTerms.addWhitelisted([investorNoDiscount], [0], [Q18], {
        from: admin,
      });
      await amountNoFixedSlot(0, terms.MAX_TICKET_EUR_ULPS.add(1));
    });

    it("with no amount and discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2).add(1);
      const priceFrac = Q18.mul("0.6");
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
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
      const priceFrac = Q18.mul("0.6");
      const amount = discountAmount.divToInt(2);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[4]).to.be.bignumber.eq(
        tokenAmount(0, amount, getTokenPower(tokenTerms), priceFrac),
      );
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with amount eq discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul("0.6");
      const amount = discountAmount;
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      expect(info[4]).to.be.bignumber.eq(
        tokenAmount(0, amount, getTokenPower(tokenTerms), priceFrac),
      );
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with amount over discount", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2).sub(1);
      const priceFrac = Q18.mul(0.6);
      const amount = discountAmount.add(Q18);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
      });
      const info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[0]).to.be.true;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      const expDiscountedTokens = tokenAmount(
        0,
        discountAmount,
        getTokenPower(tokenTerms),
        priceFrac,
      );
      const expTokens = expDiscountedTokens.add(
        tokenAmount(
          discountAmount,
          amount.sub(discountAmount),
          getTokenPower(tokenTerms),
          whitelistPriceFrac,
        ),
      );
      expect(info[4]).to.be.bignumber.eq(expTokens);
      expect(info[5]).to.be.bignumber.eq(expDiscountedTokens);
    });

    it("with amount over discount in multiple steps", async () => {
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.divToInt(2);
      const priceFrac = Q18.mul(0.321).add(1);
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
      });

      // all amount within discount
      const amount = discountAmount.divToInt(2);
      let info = await etoTerms.calculateContribution(investorDiscount, 0, 0, amount, true);
      expect(info[4]).to.be.bignumber.eq(
        tokenAmount(0, amount, getTokenPower(tokenTerms), priceFrac),
      );
      expect(info[5]).to.be.bignumber.eq(info[4]);
      // next amount goes over discount
      const amount2 = amount.add(Q18);
      info = await etoTerms.calculateContribution(investorDiscount, amount, amount, amount2, true);
      const expDiscountedTokens = tokenAmount(
        amount,
        discountAmount.sub(amount),
        getTokenPower(tokenTerms),
        priceFrac,
      );
      const expPrice = expDiscountedTokens.add(
        tokenAmount(
          discountAmount,
          amount2.sub(amount),
          getTokenPower(tokenTerms),
          whitelistPriceFrac,
        ),
      );
      expect(info[4]).to.be.bignumber.eq(expPrice);
      expect(info[5]).to.be.bignumber.eq(expDiscountedTokens);

      // next amount is without discount
      const amount3 = Q18.mul("19209.111").add(1);
      const total = amount.add(amount2);
      info = await etoTerms.calculateContribution(investorDiscount, total, total, amount3, true);
      expect(info[4]).to.be.bignumber.eq(
        tokenAmount(total, amount3, getTokenPower(tokenTerms), whitelistPriceFrac),
      );
      expect(info[5]).to.be.bignumber.eq(0);
    });

    it("with discount max ticket higher than max ticket size for other investors", async () => {
      // discounts allow overriding max ticket sizes
      const discountAmount = terms.MAX_TICKET_EUR_ULPS.mul(2);
      const priceFrac = Q18.mul("0.6");
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
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
      const expPrice = tokenAmount(0, discountAmount, getTokenPower(tokenTerms), priceFrac);
      expect(info[4]).to.be.bignumber.eq(expPrice);
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with discount min ticket lower than min ticket for other investors", async () => {
      // discounts allow overriding min ticket size
      const discountAmount = terms.MIN_TICKET_EUR_ULPS.div(2).round();
      const priceFrac = Q18.mul("0.7");
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
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
      const expPrice = tokenAmount(0, discountAmount, getTokenPower(tokenTerms), priceFrac);
      expect(info[4]).to.be.bignumber.eq(expPrice);
      expect(info[5]).to.be.bignumber.eq(info[4]);
    });

    it("with discount min ticket override not applied to public", async () => {
      // discounts allow overriding min ticket size
      const discountAmount = terms.MIN_TICKET_EUR_ULPS.div(2).round();
      const priceFrac = Q18.mul("0.7");
      await etoTerms.addWhitelisted([investorDiscount], [discountAmount], [priceFrac], {
        from: admin,
      });
      let info = await etoTerms.calculateContribution(investorDiscount, 0, 0, discountAmount, true);
      expect(info[2]).to.be.bignumber.eq(discountAmount);
      info = await etoTerms.calculateContribution(investorDiscount, 0, 0, discountAmount, false);
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
    });

    it("with public ticket", async () => {
      const amount = Q18.mul("76251.212").add(1);
      const info = await etoTerms.calculateContribution(investorNoDiscount, 0, 0, amount, false);
      expect(info[0]).to.be.false;
      expect(info[1]).to.be.false;
      expect(info[2]).to.be.bignumber.eq(terms.MIN_TICKET_EUR_ULPS);
      expect(info[3]).to.be.bignumber.eq(terms.MAX_TICKET_EUR_ULPS);
      // apply public discount
      expect(info[4]).to.be.bignumber.eq(
        tokenAmount(0, amount, getTokenPower(tokenTerms), publicPriceFrac),
      );
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

  function getTokenPower(t) {
    return decimalBase.pow(t.EQUITY_TOKEN_DECIMALS);
  }

  function expectLogInvestorWhitelisted(event, investor, discountAmount, priceFracFrac) {
    expect(event.event).to.eq("LogInvestorWhitelisted");
    expect(event.args.investor).to.eq(investor);
    expect(event.args.discountAmountEurUlps).to.be.bignumber.eq(discountAmount);
    expect(event.args.fullTokenPriceFrac).to.be.bignumber.eq(priceFracFrac);
  }
});
