import { expect } from "chai";
import {
  deployUniverse,
  deployEuroTokenUniverse,
  deployPlatformTerms,
  deployIdentityRegistry,
} from "../../helpers/deployContracts";
import createAccessPolicy from "../../helpers/createAccessPolicy";
import { deployTokenTerms } from "../../helpers/deployTerms";
import roles from "../../helpers/roles";
import { prettyPrintGasCost } from "../../helpers/gasUtils";
import { Q18 } from "../../helpers/constants";
import { toBytes32, contractId } from "../../helpers/utils";
import increaseTime from "../../helpers/increaseTime";

const TestMockableEquityTokenController = artifacts.require("TestMockableEquityTokenController");
const ExitController = artifacts.require("ExitController");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const EquityToken = artifacts.require("EquityToken");
const zero = new web3.BigNumber(0);

/*
    TODO: test events, test ellgible token reply for manual resolution
*/

contract("ExitController", ([admin, nominee, company, ...investors]) => {
  let equityToken;
  let equityTokenController;
  let accessPolicy;
  let universe;
  let exitController;
  let tokenTerms;
  let euroToken;
  let euroTokenController;
  let identityRegistry;

  const tokensInvestor0 = 18201298;
  const tokensInvestor1 = 58201298;
  const tokensInvestor2 = 28201298;
  const tokensInvestor3 = 8201298;

  beforeEach(async () => {
    [universe, accessPolicy] = await deployUniverse(admin, admin);
    await createAccessPolicy(accessPolicy, [{ subject: admin, role: roles.reclaimer }]);
    await deployPlatformTerms(universe, admin);

    // verify some addresses
    identityRegistry = await deployIdentityRegistry(universe, admin, admin);
    await identityRegistry.setClaims(admin, toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(nominee, toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(investors[0], toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(investors[1], toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(investors[2], toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(investors[3], toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(investors[4], toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(investors[5], toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });
    await identityRegistry.setClaims(investors[6], toBytes32("0x0"), toBytes32("0x1"), {
      from: admin,
    });

    // create equity Token
    [tokenTerms] = await deployTokenTerms(ETOTokenTerms);
    equityTokenController = await TestMockableEquityTokenController.new(universe.address);
    equityToken = await EquityToken.new(
      universe.address,
      equityTokenController.address,
      tokenTerms.address,
      nominee,
      company,
    );
    await equityToken.amendAgreement("AGREEMENT#HASH", { from: nominee });

    // add some investor balances
    await equityToken.issueTokens(tokensInvestor0, {
      from: investors[0],
    });
    await equityToken.issueTokens(tokensInvestor1, {
      from: investors[1],
    });
    await equityToken.issueTokens(tokensInvestor2, {
      from: investors[2],
    });
    await equityToken.issueTokens(tokensInvestor3, {
      from: investors[3],
    });

    // eurotoken
    [euroToken, euroTokenController] = await deployEuroTokenUniverse(
      universe,
      admin,
      admin,
      admin,
      zero,
      zero,
      zero,
    );

    // create exit controller
    exitController = await ExitController.new(universe.address, equityToken.address);

    // allow exit controller to receive and send eur-t
    await euroTokenController.setAllowedTransferTo(exitController.address, true, { from: admin });
    await euroTokenController.setAllowedTransferFrom(exitController.address, true, { from: admin });
  });

  describe("specific tests", () => {
    it("should deploy to default state", async () => {
      await prettyPrintGasCost("ExitController deploy", exitController);
      // setup state
      expect(await exitController.state()).to.be.bignumber.eq(0);
      // elligibility endpoints all return 0
      let proceeds = await exitController.eligibleProceedsForInvestor(investors[0]);
      expect(proceeds[0]).to.be.bignumber.eq(0);
      expect(proceeds[1]).to.be.bignumber.eq(0);
      proceeds = await exitController.eligibleProceedsForTokens(Q18);
      expect(proceeds).to.be.bignumber.eq(0);

      const [tokenSupply, exitFunds, manualStart] = await exitController.payoutInfo();
      expect(tokenSupply).to.be.bignumber.eq(0);
      expect(exitFunds).to.be.bignumber.eq(0);
      expect(manualStart).to.be.bignumber.eq(0);
    });

    it("should correctly calculate eligible proceeds in payout state", async () => {
      // give some euro-t to nominee, total payout 13 mio
      const payoutEurt = Q18.mul(13000000);
      const equityTokenSupply = await equityToken.totalSupply();
      await euroToken.deposit(nominee, payoutEurt, 0x0, { from: admin });

      // start payout, contract should go to payout state
      await euroToken.transfer["address,uint256,bytes"](exitController.address, payoutEurt, "", {
        from: nominee,
      });

      // check eligible proceeds for investors
      let [tokens0, proceeds0] = await exitController.eligibleProceedsForInvestor(investors[0]);
      expect(tokens0).to.be.bignumber.eq(tokensInvestor0);
      expect(proceeds0).to.be.bignumber.eq(
        tokens0
          .mul(payoutEurt)
          .div(equityTokenSupply)
          .round(0),
      );

      const [tokens1, proceeds1] = await exitController.eligibleProceedsForInvestor(investors[1]);
      expect(tokens1).to.be.bignumber.eq(tokensInvestor1);
      expect(proceeds1).to.be.bignumber.eq(
        tokens1
          .mul(payoutEurt)
          .div(equityTokenSupply)
          .round(0),
      );

      const [tokens2, proceeds2] = await exitController.eligibleProceedsForInvestor(investors[2]);
      expect(tokens2).to.be.bignumber.eq(tokensInvestor2);
      expect(proceeds2).to.be.bignumber.eq(
        tokens2
          .mul(payoutEurt)
          .div(equityTokenSupply)
          .round(0),
      );

      const [tokens3, proceeds3] = await exitController.eligibleProceedsForInvestor(investors[3]);
      expect(tokens3).to.be.bignumber.eq(tokensInvestor3);
      expect(proceeds3).to.be.bignumber.eq(
        tokens3
          .mul(payoutEurt)
          .div(equityTokenSupply)
          .round(0),
      );

      const proceedsTotal = proceeds0
        .add(proceeds1)
        .add(proceeds2)
        .add(proceeds3);
      expect(proceedsTotal).to.be.bignumber.eq(payoutEurt.minus(1)); // rounding error of 1

      // do a payout on investor 0 and then check again, should yield 0
      await equityToken.transfer["address,uint256,bytes"](
        exitController.address,
        tokensInvestor0,
        "",
        { from: investors[0] },
      );
      [tokens0, proceeds0] = await exitController.eligibleProceedsForInvestor(investors[0]);
      expect(tokens0).to.be.bignumber.eq(0);
      expect(proceeds0).to.be.bignumber.eq(0);
    });

    it("should be able to serve claims in payout mode", async () => {
      // give some euro-t to nominee, total payout 13 mio
      const payoutEurt = Q18.mul(13000000);
      const equityTokenSupply = await equityToken.totalSupply();
      await euroToken.deposit(nominee, payoutEurt, 0x0, { from: admin });
      await euroToken.transfer["address,uint256,bytes"](exitController.address, payoutEurt, "", {
        from: nominee,
      });

      // try to claim with zero tokens
      await expect(
        equityToken.transfer["address,uint256,bytes"](exitController.address, 0, "", {
          from: investors[0],
        }),
      ).to.be.rejectedWith("NF_ZERO_TOKENS");

      // try to claim with less than full amount
      await expect(
        equityToken.transfer["address,uint256,bytes"](
          exitController.address,
          tokensInvestor0 - 1,
          "",
          { from: investors[0] },
        ),
      ).to.be.rejectedWith("NF_MUST_SEND_ALL_TOKENS");

      // claim some tokens
      await equityToken.transfer["address,uint256,bytes"](
        exitController.address,
        tokensInvestor0,
        "",
        { from: investors[0] },
      );
      const expectedEurt = payoutEurt
        .mul(tokensInvestor0)
        .div(equityTokenSupply)
        .round(0);
      expect(await euroToken.balanceOf(investors[0])).to.be.bignumber.eq(expectedEurt);
      expect(await equityToken.balanceOf(investors[0])).to.be.bignumber.eq(0);

      // try to claim again
      await expect(
        equityToken.transfer["address,uint256,bytes"](exitController.address, tokensInvestor0, "", {
          from: investors[0],
        }),
      ).to.revert;
    });

    it("should reject equity token transfers in setup state", async () => {
      await expect(
        equityToken.transfer["address,uint256,bytes"](exitController.address, tokensInvestor0, "", {
          from: investors[0],
        }),
      ).to.be.rejectedWith("NF_ETO_INCORRECT_TOKEN");
    });

    it("should reject euro tokens from non nominee user", async () => {
      // give some euro-t to nominee, total payout 13 mio
      const payoutEurt = Q18.mul(13000000);
      await euroToken.deposit(investors[0], payoutEurt, 0x0, { from: admin });
      await expect(
        euroToken.transfer["address,uint256,bytes"](exitController.address, payoutEurt, "", {
          from: investors[0],
        }),
      ).to.be.rejectedWith("NF_ONLY_NOMINEE");
    });

    it("should reject euro tokens after setup state", async () => {
      const payoutEurt = Q18.mul(13000000);
      await euroToken.deposit(nominee, payoutEurt, 0x0, { from: admin });

      // should not start payout with 0 tokens
      await expect(
        euroToken.transfer["address,uint256,bytes"](exitController.address, 0, "", {
          from: nominee,
        }),
      ).to.be.rejectedWith("NF_ZERO_TOKENS");

      // start payout state, but only with 12mio eurt
      await euroToken.transfer["address,uint256,bytes"](
        exitController.address,
        Q18.mul(12000000),
        "",
        {
          from: nominee,
        },
      );
      expect(await exitController.state()).to.be.bignumber.eq(1);

      // sending more eur-t will be rejected
      await expect(
        euroToken.transfer["address,uint256,bytes"](exitController.address, Q18.mul(1000000), "", {
          from: nominee,
        }),
      ).to.be.rejectedWith("NF_ETO_UNK_TOKEN");
    });

    it("should only allow nominee to start manual payout state", async () => {
      // switch to manual payout from setup not allowed
      await expect(
        exitController.startManualPayoutResolution({ from: nominee }),
      ).to.be.rejectedWith("NF_INCORRECT_STATE");

      // start regular payout
      await euroToken.deposit(nominee, Q18.mul(13000000), 0x0, { from: admin });
      await euroToken.transfer["address,uint256,bytes"](
        exitController.address,
        Q18.mul(12000000),
        "",
        {
          from: nominee,
        },
      );
      expect(await exitController.state()).to.be.bignumber.eq(1);

      // try to switch to manual payout from other address
      await expect(
        exitController.startManualPayoutResolution({ from: investors[0] }),
      ).to.be.rejectedWith("NF_ONLY_NOMINEE");
      expect(await exitController.state()).to.be.bignumber.eq(1);

      // nominee may do it
      await exitController.startManualPayoutResolution({ from: nominee });
      expect(await exitController.state()).to.be.bignumber.eq(2);
    });

    it("should reject regular payouts when in manual payout state", async () => {
      // start regular payout
      await euroToken.deposit(nominee, Q18.mul(13000000), 0x0, { from: admin });
      await euroToken.transfer["address,uint256,bytes"](
        exitController.address,
        Q18.mul(12000000),
        "",
        {
          from: nominee,
        },
      );
      expect(await exitController.state()).to.be.bignumber.eq(1);

      // go to manual payout
      await exitController.startManualPayoutResolution({ from: nominee });
      expect(await exitController.state()).to.be.bignumber.eq(2);

      // sending equity tokens now reverts
      await expect(
        equityToken.transfer["address,uint256,bytes"](exitController.address, tokensInvestor0, "", {
          from: investors[0],
        }),
      ).to.revert;
    });

    it("allows manual payout only in certain conditions", async () => {
      // rejected bc in setup state
      const equityTokenSupply = await equityToken.totalSupply();
      const payoutEurt = Q18.mul(13000000);

      await expect(
        exitController.payoutManually(investors[0], investors[4], { from: nominee }),
      ).to.be.rejectedWith("NF_INCORRECT_STATE");
      await euroToken.deposit(nominee, payoutEurt, 0x0, { from: admin });
      await euroToken.transfer["address,uint256,bytes"](exitController.address, payoutEurt, "", {
        from: nominee,
      });

      // rejected bc in payout state
      await expect(
        exitController.payoutManually(investors[0], investors[4], { from: nominee }),
      ).to.be.rejectedWith("NF_INCORRECT_STATE");
      // go to manual payout state
      await exitController.startManualPayoutResolution({ from: nominee });
      // only nominee may call this
      await expect(
        exitController.payoutManually(investors[0], investors[4], { from: investors[0] }),
      ).to.be.rejectedWith("NF_ONLY_NOMINEE");
      // prevent sending funds to 0x address
      await expect(
        exitController.payoutManually(investors[0], 0x0, { from: nominee }),
      ).to.be.rejectedWith("NF_INVALID_NEW_WALLET");
      // we need to wait for the next snapshot
      await expect(
        exitController.payoutManually(investors[0], investors[4], { from: nominee }),
      ).to.be.rejectedWith("NF_WAIT");
      increaseTime(10);
      await expect(
        exitController.payoutManually(investors[0], investors[4], { from: nominee }),
      ).to.be.rejectedWith("NF_WAIT");
      increaseTime(60 * 60 * 24);

      // try payout from address without tokens
      await expect(
        exitController.payoutManually(investors[5], investors[4], { from: nominee }),
      ).to.be.rejectedWith("NF_NO_PROCEEDS");

      // finally it works
      await exitController.payoutManually(investors[0], investors[4], { from: nominee });
      // payout already done..
      await expect(
        exitController.payoutManually(investors[0], investors[4], { from: nominee }),
      ).to.be.rejectedWith("NF_ALREADY_PAYED_OUT");

      // check payed out eur-t
      const expectedEurt0 = payoutEurt
        .mul(tokensInvestor0)
        .div(equityTokenSupply)
        .round(0);
      expect(await euroToken.balanceOf(investors[4])).to.be.bignumber.eq(expectedEurt0);
      expect(await euroToken.balanceOf(investors[0])).to.be.bignumber.eq(0);
    });

    it("should prevent double manual payout", async () => {
      // give some euro-t to nominee, total payout 13 mio
      const payoutEurt = Q18.mul(13000000);
      const equityTokenSupply = await equityToken.totalSupply();

      await euroToken.deposit(nominee, payoutEurt, 0x0, { from: admin });
      // start payout, contract should go to payout state
      await euroToken.transfer["address,uint256,bytes"](exitController.address, payoutEurt, "", {
        from: nominee,
      });

      // investor 1 claims
      await equityToken.transfer["address,uint256,bytes"](
        exitController.address,
        tokensInvestor0,
        "",
        { from: investors[0] },
      );
      const expectedEurt0 = payoutEurt
        .mul(tokensInvestor0)
        .div(equityTokenSupply)
        .round(0);
      expect(await euroToken.balanceOf(investors[0])).to.be.bignumber.eq(expectedEurt0);

      // go to manual payout
      await exitController.startManualPayoutResolution({ from: nominee });

      // wait for one day
      increaseTime(60 * 60 * 24);

      // claim for investor0 should not work, since the money was gone before
      await expect(
        exitController.payoutManually(investors[0], investors[4], { from: nominee }),
      ).to.be.rejectedWith("NF_NO_PROCEEDS");
      expect(await euroToken.balanceOf(investors[0])).to.be.bignumber.eq(expectedEurt0);
      expect(await euroToken.balanceOf(investors[4])).to.be.bignumber.eq(0);

      // claim for investor 1 into investor 4 wallet
      await exitController.payoutManually(investors[1], investors[4], { from: nominee });
      const expectedEurt1 = payoutEurt
        .mul(tokensInvestor1)
        .div(equityTokenSupply)
        .round(0)
        .minus(1);
      expect(await euroToken.balanceOf(investors[1])).to.be.bignumber.eq(0);
      expect(await euroToken.balanceOf(investors[4])).to.be.bignumber.eq(expectedEurt1);

      // try to claim again into wallet 5
      await expect(
        exitController.payoutManually(investors[1], investors[5], { from: nominee }),
      ).to.be.rejectedWith("NF_ALREADY_PAYED_OUT");

      // different sneaky trick: move the funds to a different wallet and request claim again
      await equityToken.transfer(investors[2], tokensInvestor1, { from: investors[1] });
      expect(await equityToken.balanceOf(investors[2])).to.bignumber.eq(
        tokensInvestor1 + tokensInvestor2,
      );

      // payout will work, but only for the amount of original tokens from investor 2
      await exitController.payoutManually(investors[2], investors[5], { from: nominee });
      const expectedEurt2 = payoutEurt
        .mul(tokensInvestor2)
        .div(equityTokenSupply)
        .round(0);
      expect(await euroToken.balanceOf(investors[5])).to.be.bignumber.eq(expectedEurt2);

      // try from another address that never had tokens
      await equityToken.transfer(investors[4], tokensInvestor3, { from: investors[3] });
      await expect(
        exitController.payoutManually(investors[1], investors[5], { from: nominee }),
      ).to.be.rejectedWith("NF_ALREADY_PAYED_OUT");
    });

    it("Should do the full payout case", async () => {
      // setup state
      expect(await exitController.state()).to.be.bignumber.eq(0);

      // give some euro-t to nominee, total payout 13 mio
      const payoutEurt = Q18.mul(13000000);
      await euroToken.deposit(nominee, payoutEurt, 0x0, { from: admin });

      // start payout, contract should go to payout state
      await euroToken.transfer["address,uint256,bytes"](exitController.address, payoutEurt, "", {
        from: nominee,
      });
      expect(await exitController.state()).to.be.bignumber.eq(1);
      let [tokenSupply, exitFunds, manualStart] = await exitController.payoutInfo();
      expect(tokenSupply).to.be.bignumber.eq(await equityToken.totalSupply());
      expect(exitFunds).to.be.bignumber.eq(payoutEurt);
      expect(manualStart).to.be.bignumber.eq(0);

      // do some paying out
      await equityToken.transfer["address,uint256,bytes"](
        exitController.address,
        tokensInvestor0,
        "",
        { from: investors[0] },
      );
      await equityToken.transfer["address,uint256,bytes"](
        exitController.address,
        tokensInvestor1,
        "",
        { from: investors[1] },
      );

      // go to manual resolution and do some manual payouts
      await exitController.startManualPayoutResolution({ from: nominee });
      expect(await exitController.state()).to.be.bignumber.eq(2);
      increaseTime(60 * 60 * 24);
      await exitController.payoutManually(investors[2], investors[4], { from: nominee });
      await exitController.payoutManually(investors[3], investors[5], { from: nominee });

      [tokenSupply, exitFunds, manualStart] = await exitController.payoutInfo();
      expect(tokenSupply).to.be.bignumber.eq(await equityToken.totalSupply());
      expect(exitFunds).to.be.bignumber.eq(payoutEurt);
      expect(manualStart).to.be.bignumber.not.eq(0);

      const fullPayout = (await euroToken.balanceOf(investors[0]))
        .add(await euroToken.balanceOf(investors[1]))
        .add(await euroToken.balanceOf(investors[4]))
        .add(await euroToken.balanceOf(investors[5]));
      expect(fullPayout).to.be.bignumber.eq(payoutEurt.minus(1)); // rounding error :)
    });

    it("should allow to reclaim euro tokens and equity tokens", async () => {
      // give some euro-t to nominee, total payout 13 mio
      const payoutEurt = Q18.mul(13000000);
      await euroToken.deposit(nominee, payoutEurt, 0x0, { from: admin });
      // start payout, contract should go to payout state
      await euroToken.transfer["address,uint256,bytes"](exitController.address, payoutEurt, "", {
        from: nominee,
      });

      // some paying out
      await equityToken.transfer["address,uint256,bytes"](
        exitController.address,
        tokensInvestor0,
        "",
        { from: investors[0] },
      );

      const euroTokens = await euroToken.balanceOf(exitController.address);
      const equityTokens = await equityToken.balanceOf(exitController.address);

      // reclaim from admin
      await exitController.reclaim(euroToken.address, { from: admin });
      await exitController.reclaim(equityToken.address, { from: admin });

      // check that we have reclaimed all the tokens
      expect(await euroToken.balanceOf(admin)).to.be.bignumber.eq(euroTokens);
      expect(await equityToken.balanceOf(admin)).to.be.bignumber.eq(equityTokens);
    });

    it("should implement the correct contract id", async () => {
      expect((await exitController.contractId())[0]).to.eq(contractId("ExitController"));
    });
  });
});
