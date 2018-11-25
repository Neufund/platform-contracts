import { expect } from "chai";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { deployUniverse, deployPlatformTerms } from "../helpers/deployContracts";
import {
  deployShareholderRights,
  deployDurationTerms,
  deployETOTerms,
  deployTokenTerms,
  constTokenTerms,
} from "../helpers/deployTerms";
import {
  basicTokenTests,
  standardTokenTests,
  erc677TokenTests,
  deployTestErc677Callback,
  erc223TokenTests,
  expectTransferEvent,
  testWithdrawal,
  deployTestErc223Callback,
} from "../helpers/tokenTestCases";
import {
  testTokenController,
  testChangeTokenController,
} from "../helpers/tokenControllerTestCases";
import { eventValue } from "../helpers/events";
import roles from "../helpers/roles";
import createAccessPolicy from "../helpers/createAccessPolicy";
import { snapshotTokenTests } from "../helpers/snapshotTokenTestCases";
import { increaseTime } from "../helpers/evmCommands";
import { contractId, ZERO_ADDRESS } from "../helpers/constants";
import EvmError from "../helpers/EVMThrow";

const EquityToken = artifacts.require("EquityToken");
const TestMockableEquityTokenController = artifacts.require("TestMockableEquityTokenController");
const TestSnapshotToken = artifacts.require("TestSnapshotToken"); // for cloning tests
const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const ShareholderRights = artifacts.require("ShareholderRights");

contract("EquityToken", ([admin, nominee, company, broker, ...holders]) => {
  let equityToken;
  let equityTokenController;
  let accessPolicy;
  let universe;
  let etoTerms, etoTermsDict;
  let tokenTerms;

  beforeEach(async () => {
    [universe, accessPolicy] = await deployUniverse(admin, admin);
    await createAccessPolicy(accessPolicy, [{ subject: admin, role: roles.reclaimer }]);
    await deployPlatformTerms(universe, admin);
    const [shareholderRights] = await deployShareholderRights(ShareholderRights);
    const [durationTerms] = await deployDurationTerms(ETODurationTerms);
    [tokenTerms] = await deployTokenTerms(ETOTokenTerms);
    [etoTerms, etoTermsDict] = await deployETOTerms(
      universe,
      ETOTerms,
      durationTerms,
      tokenTerms,
      shareholderRights,
    );
    equityTokenController = await TestMockableEquityTokenController.new(universe.address);

    equityToken = await EquityToken.new(
      universe.address,
      equityTokenController.address,
      etoTerms.address,
      nominee,
      company,
    );
    await equityToken.amendAgreement("AGREEMENT#HASH", { from: nominee });
  });

  describe("specific tests", () => {
    it("should deploy", async () => {
      await prettyPrintGasCost("EquityToken deploy", equityToken);
      // check properties of equity token
      expect(await equityToken.tokensPerShare()).to.be.bignumber.eq(
        constTokenTerms.EQUITY_TOKENS_PER_SHARE,
      );
      expect(await equityToken.shareNominalValueEurUlps()).to.be.bignumber.eq(
        etoTermsDict.SHARE_NOMINAL_VALUE_EUR_ULPS,
      );
      expect(await equityToken.tokenController()).to.be.bignumber.eq(equityTokenController.address);
      expect(await equityToken.nominee()).to.be.bignumber.eq(nominee);
      expect(await equityToken.companyLegalRepresentative()).to.be.bignumber.eq(company);

      expect((await equityToken.contractId())[0]).to.eq(contractId("EquityToken"));
    });

    it("should deposit", async () => {
      // remember: equity tokens are not divisible
      const initialBalance = 18201298;
      const tx = await equityToken.issueTokens(initialBalance, {
        from: holders[0],
      });
      expectLogTokensIssued(tx, holders[0], equityTokenController.address, initialBalance);
      expectTransferEvent(tx, ZERO_ADDRESS, holders[0], initialBalance);
      const totalSupply = await equityToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(initialBalance);
      const balance = await equityToken.balanceOf(holders[0]);
      expect(balance).to.be.bignumber.eq(initialBalance);
    });

    it("should overflow on deposit", async () => {
      const initialBalance = new web3.BigNumber(2).pow(256).minus(1);
      await equityToken.issueTokens(initialBalance, {
        from: company,
      });

      await expect(
        equityToken.issueTokens(1, {
          from: company,
        }),
      ).to.be.rejectedWith(EvmError);
      expect(await equityToken.totalSupply()).to.be.bignumber.eq(initialBalance);
    });

    // cases for successful destroy, rejected due to controller, not enough balance etc.
    it("should destroy tokens");

    // should be a set of tests with different rounding, we should be able to run it on platform as well
    it("should convert equity token amount to shares");

    it("should set token symbol and other metadata from eto terms correctly", async () => {
      const equityTokenName = await etoTerms.EQUITY_TOKEN_NAME();
      const equityTokenSymbol = await etoTerms.EQUITY_TOKEN_SYMBOL();
      const equityTokenShareNominalValue = await etoTerms.SHARE_NOMINAL_VALUE_EUR_ULPS();
      const equityTokenPrecision = await tokenTerms.EQUITY_TOKENS_PRECISION();
      const equityTokensPerShare = await tokenTerms.EQUITY_TOKENS_PER_SHARE();

      expect(await equityToken.name()).to.have.string(equityTokenName);
      expect(await equityToken.symbol()).to.have.string(equityTokenSymbol);
      expect(await equityToken.decimals()).to.be.bignumber.eq(equityTokenPrecision);
      expect(await equityToken.tokensPerShare()).to.be.bignumber.eq(equityTokensPerShare);
      expect(await equityToken.shareNominalValueEurUlps()).to.be.bignumber.eq(
        equityTokenShareNominalValue,
      );
    });
  });

  describe("IEquityTokenController tests", () => {
    const getToken = () => equityToken;
    const getController = () => equityTokenController;
    const generate = async (amount, account) => equityToken.issueTokens(amount, { from: account });
    const destroy = async (amount, account) => equityToken.destroyTokens(amount, { from: account });

    testChangeTokenController(getToken, getController);
    testTokenController(getToken, getController, holders[0], holders[1], broker, generate, destroy);

    it("should change nominee if change enabled", async () => {
      const newNominee = holders[0];
      await equityTokenController.setAllowChangeNominee(true);
      await equityToken.changeNominee(newNominee, { from: company });
      expect(await equityToken.nominee()).to.be.bignumber.eq(newNominee);
      // change back
      await equityToken.changeNominee(nominee, { from: company });
      expect(await equityToken.nominee()).to.be.bignumber.eq(nominee);
    });

    it("reject changing nominee if change disabled", async () => {
      const newNominee = holders[0];
      await equityTokenController.setAllowChangeNominee(false);

      await expect(equityToken.changeNominee(newNominee)).to.revert;
    });

    it("should distribute when transfers enabled", async () => {
      await generate(1000, holders[0]);
      await equityTokenController.setAllowOnTransfer(true);
      await equityToken.distributeTokens(holders[1], 10, { from: holders[0] });
    });

    it("rejects distribute when transfers disabled", async () => {
      await generate(1000, holders[0]);
      await equityTokenController.setAllowOnTransfer(false);
      await expect(equityToken.distributeTokens(holders[1], 10, { from: holders[0] })).to.revert;
    });
  });

  describe("agreement tests", () => {
    it("should sign agreement on deposit", async () => {
      expect(await equityToken.agreementSignedAtBlock(holders[0])).to.be.bignumber.eq(0);
      await equityToken.issueTokens(1000, { from: holders[0] });
      expect(await equityToken.agreementSignedAtBlock(holders[0])).to.be.bignumber.not.eq(0);
    });

    it("should not sign agreement on receiving transfer", async () => {
      await equityToken.issueTokens(1000, { from: holders[0] });
      await equityToken.transfer(holders[1], 1000, { from: holders[0] });
      // transfer recipient does not implicitly sign
      expect(await equityToken.agreementSignedAtBlock(holders[1])).to.be.bignumber.eq(0);
    });

    it("should sign agreement on transfer", async () => {
      await equityToken.issueTokens(1000, { from: holders[0] });
      await equityToken.transfer(holders[1], 1000, { from: holders[0] });
      // transfer recipient does not implicitly sign
      expect(await equityToken.agreementSignedAtBlock(holders[1])).to.be.bignumber.eq(0);
      await equityToken.transfer(holders[2], 1000, { from: holders[1] });
      expect(await equityToken.agreementSignedAtBlock(holders[1])).to.be.bignumber.not.eq(0);
    });

    it("should sign agreement on approve", async () => {
      await equityToken.approve(holders[1], 1000, { from: holders[0] });
      expect(await equityToken.agreementSignedAtBlock(holders[0])).to.be.bignumber.not.eq(0);
      expect(await equityToken.agreementSignedAtBlock(holders[1])).to.be.bignumber.eq(0);
    });

    it("should sign agreement on distributeTokens for receiver", async () => {
      await equityToken.issueTokens(1000, { from: holders[0] });
      // todo: rethink and maybe we need another function in controller just to control distribute
      // that would work together with transfer control
      await equityToken.distributeTokens(holders[1], 1000, { from: holders[0] });
      expect(await equityToken.agreementSignedAtBlock(holders[1])).to.be.bignumber.not.eq(0);
    });

    it("should sign agreement on destroy", async () => {
      await equityToken.issueTokens(1000, { from: holders[0] });
      await equityToken.transfer(holders[1], 1000, { from: holders[0] });
      expect(await equityToken.agreementSignedAtBlock(holders[1])).to.be.bignumber.eq(0);
      await equityToken.destroyTokens(1000, { from: holders[1] });
      expect(await equityToken.agreementSignedAtBlock(holders[1])).to.be.bignumber.not.eq(0);
    });

    it("should sign agreement explicitely", async () => {
      await equityToken.approve(holders[0], 0, { from: holders[0] });
      expect(await equityToken.agreementSignedAtBlock(holders[0])).to.be.bignumber.not.eq(0);
    });
  });

  describe("IBasicToken tests", () => {
    const initialBalance = new web3.BigNumber(5092819281);
    const getToken = () => equityToken;

    beforeEach(async () => {
      await equityToken.issueTokens(initialBalance, {
        from: holders[1],
      });
    });

    basicTokenTests(getToken, holders[1], holders[2], initialBalance);
  });

  describe("IERC20Allowance tests", () => {
    const initialBalance = new web3.BigNumber(71723919);
    const getToken = () => equityToken;

    beforeEach(async () => {
      await equityToken.issueTokens(initialBalance, {
        from: holders[1],
      });
    });

    standardTokenTests(getToken, holders[1], holders[2], broker, initialBalance);
  });

  describe("IERC677Token tests", () => {
    const initialBalance = new web3.BigNumber(438181);
    const getToken = () => equityToken;
    let erc667cb;
    const getTestErc667cb = () => erc667cb;

    beforeEach(async () => {
      await equityToken.issueTokens(initialBalance, {
        from: holders[1],
      });
      erc667cb = await deployTestErc677Callback();
    });

    erc677TokenTests(getToken, getTestErc667cb, holders[1], initialBalance);
  });

  describe("IERC223Token tests", () => {
    const initialBalance = new web3.BigNumber(438181);
    const getToken = () => equityToken;
    let erc223cb;
    const getTestErc223cb = () => erc223cb;

    beforeEach(async () => {
      erc223cb = await deployTestErc223Callback(true);
      await equityToken.issueTokens(initialBalance, {
        from: holders[1],
      });
    });

    erc223TokenTests(getToken, getTestErc223cb, holders[1], holders[2], initialBalance);
  });

  describe("withdrawal tests", () => {
    const initialBalance = new web3.BigNumber("79827398197221");
    const getToken = () => {
      // patch deposit and withdraw
      equityToken.withdraw = equityToken.destroyTokens;
      return equityToken;
    };

    beforeEach(async () => {
      await equityToken.issueTokens(initialBalance, {
        from: holders[1],
      });
    });

    testWithdrawal(getToken, holders[1], initialBalance, expectLogTokensDestroyedComp);
  });

  describe("ITokenSnapshots tests", () => {
    const getToken = () => {
      // patch deposit and withdraw
      equityToken.deposit = equityToken.issueTokens;
      equityToken.withdraw = equityToken.destroyTokens;
      return equityToken;
    };

    const advanceSnapshotId = async snapshotable => {
      // EquityToken is Daily so forward time to create snapshot
      await increaseTime(24 * 60 * 60);
      return snapshotable.currentSnapshotId.call();
    };

    const createClone = async (parentToken, parentSnapshotId) =>
      TestSnapshotToken.new(parentToken.address, parentSnapshotId);

    snapshotTokenTests(getToken, createClone, advanceSnapshotId, holders[1], holders[2], broker);
  });

  function expectLogTokensIssued(tx, owner, controller, amount) {
    const event = eventValue(tx, "LogTokensIssued");
    expect(event).to.exist;
    expect(event.args.holder).to.eq(owner);
    expect(event.args.controller).to.eq(controller);
    expect(event.args.amount).to.be.bignumber.eq(amount);
  }

  // eslint-disable-next-line no-unused-vars
  function expectLogTokensDestroyed(tx, owner, controller, amount) {
    const event = eventValue(tx, "LogTokensDestroyed");
    expect(event).to.exist;
    expect(event.args.holder).to.eq(owner);
    expect(event.args.controller).to.eq(controller);
    expect(event.args.amount).to.be.bignumber.eq(amount);
  }

  function expectLogTokensDestroyedComp(tx, owner, amount) {
    const event = eventValue(tx, "LogTokensDestroyed");
    expect(event).to.exist;
    expect(event.args.holder).to.eq(owner);
    expect(event.args.amount).to.be.bignumber.eq(amount);
  }
});
