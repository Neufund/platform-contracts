import { expect } from "chai";
import {
  deployPlatformTerms,
  deployUniverse,
  deployIdentityRegistry,
} from "../../helpers/deployContracts";
import { contractId, toBytes32, daysToSeconds } from "../../helpers/constants";
import { prettyPrintGasCost } from "../../helpers/gasUtils";
import EvmError from "../../helpers/EVMThrow";
import { CommitmentState } from "../../helpers/commitmentState";
import {
  deployDurationTerms,
  deployETOTerms,
  deployShareholderRights,
  deployTokenTerms,
  deployETOTermsConstraintsUniverse,
} from "../../helpers/deployTerms";
import { knownInterfaces } from "../../helpers/knownInterfaces";
import increaseTime from "../../helpers/increaseTime";

const ETOTermsConstraints = artifacts.require("ETOTermsConstraints");
const ETOTerms = artifacts.require("ETOTerms");
const ETODurationTerms = artifacts.require("ETODurationTerms");
const ETOTokenTerms = artifacts.require("ETOTokenTerms");
const ShareholderRights = artifacts.require("ShareholderRights");
const EquityToken = artifacts.require("EquityToken");

const GranularTransferController = artifacts.require("GranularTransferController");
const TestETOCommitmentPlaceholderTokenController = artifacts.require(
  "TestETOCommitmentPlaceholderTokenController",
);
const RegDTransferController = artifacts.require("RegDTransferController");

// tokens inv 1 claims in eto
const inv1DistAmount = new web3.BigNumber("1325");
// total shares in eto
const totalShares = new web3.BigNumber("7152");

contract(
  "ExtraEquityTokenController",
  ([_, admin, company, nominee, investor1, investor2, ...investors]) => {
    let equityToken;
    let equityTokenController;
    let universe;
    let etoTerms;
    let tokenTerms;
    let testCommitment;
    let shareholderRights;
    let durationTerms;
    let termsConstraints;

    beforeEach(async () => {
      [universe] = await deployUniverse(admin, admin);
      await deployPlatformTerms(universe, admin);
      [shareholderRights] = await deployShareholderRights(ShareholderRights);
      [durationTerms] = await deployDurationTerms(ETODurationTerms);
      [tokenTerms] = await deployTokenTerms(ETOTokenTerms);
    });

    describe("GranularTransferController", () => {
      it("should deploy", async () => {
        await deployController(GranularTransferController);
        await prettyPrintGasCost("GranularTransferController deploy", equityTokenController);
        const cId = await equityTokenController.contractId();
        expect(cId[0]).to.eq(contractId("PlaceholderEquityTokenController"));
        // temporary override marker
        expect(cId[1]).to.be.bignumber.eq(0xff);
      });

      describe("post investment transfers on transferable token", () => {
        beforeEach(async () => {
          await deployController(GranularTransferController, { ENABLE_TRANSFERS_ON_SUCCESS: true });
          await deployETO();
          await makeInvestment(totalShares, inv1DistAmount);
        });

        it("should force transfer", async () => {
          expect(await equityToken.balanceOf(investor1)).to.be.bignumber.eq(inv1DistAmount);
          // transferable tokens
          await equityToken.transfer(investor2, 1, { from: investor1 });
          await equityToken.transfer(investor1, 1, { from: investor2 });
          // investor lost PK to investor1 account but proved to company that he's a legitimate owner
          await equityTokenController.enableForcedTransfer(investor1, investor2, inv1DistAmount, {
            from: company,
          });
          // this should setup allowance for equity token controller
          const controllerAllowance = await equityTokenController.onAllowance(
            investor1,
            equityTokenController.address,
          );
          expect(controllerAllowance).to.be.bignumber.eq(inv1DistAmount);
          // erc20 allowance
          const tokenAllowance = await equityToken.allowance(
            investor1,
            equityTokenController.address,
          );
          expect(tokenAllowance).to.be.bignumber.eq(inv1DistAmount);
          // check if forced transfer is allowed
          let isAllowed = await equityTokenController.onTransfer(
            equityTokenController.address,
            investor1,
            investor2,
            inv1DistAmount,
          );
          expect(isAllowed).to.be.true;
          // different amount is not allowed
          isAllowed = await equityTokenController.onTransfer(
            equityTokenController.address,
            investor1,
            investor2,
            inv1DistAmount.sub(1),
          );
          expect(isAllowed).to.be.false;
          await equityTokenController.executeForcedTransfer(investor1);
          expect(await equityToken.balanceOf(investor1)).to.be.bignumber.eq(0);
          expect(await equityToken.balanceOf(investor2)).to.be.bignumber.eq(inv1DistAmount);
          // forced transfer cannot be executed again
          await expect(equityTokenController.executeForcedTransfer(investor1)).to.be.rejectedWith(
            "NF_FORCED_T_NOT_EXISTS",
          );
        });

        it("should freeze and unfreeze account", async () => {
          // make successful transfer
          await equityToken.transfer(investor2, 1, { from: investor1 });
          // freeze investor1
          await equityTokenController.freezeHolder(investor1, { from: company });
          // no permission to send
          let canTransfer = await equityTokenController.onTransfer(
            investor1,
            investor1,
            investor2,
            "1",
          );
          expect(canTransfer).to.be.false;
          await expect(equityToken.transfer(investor2, 1, { from: investor1 })).to.be.rejectedWith(
            EvmError,
          );
          // no permission to receive
          canTransfer = await equityTokenController.onTransfer(
            investor2,
            investor2,
            investor1,
            "1",
          );
          expect(canTransfer).to.be.false;
          await expect(equityToken.transfer(investor1, 1, { from: investor2 })).to.be.rejectedWith(
            EvmError,
          );
          // no permission to send via broker
          canTransfer = await equityTokenController.onTransfer(
            investor1,
            investor1,
            investor2,
            "1",
          );
          expect(canTransfer).to.be.false;
          // todo: test forced transfer interaction, but that's for the real code
          // now unfreeze
          await equityTokenController.unfreezeHolder(investor1, { from: company });
          // receive
          await equityToken.transfer(investor2, 1, { from: investor1 });
          // send
          await equityToken.transfer(investor1, 1, { from: investor2 });
        });
      });

      describe("post investment transfers on non-transferable token", () => {
        beforeEach(async () => {
          await deployController(GranularTransferController, {
            ENABLE_TRANSFERS_ON_SUCCESS: false,
          });
          await deployETO();
          await makeInvestment(totalShares, inv1DistAmount);
        });

        it("should force transfer", async () => {
          // non transferable token
          const canTransfer = await equityTokenController.onTransfer(
            investor1,
            investor1,
            investor2,
            "1",
          );
          expect(canTransfer).to.be.false;
          // force transfer
          await equityTokenController.enableForcedTransfer(investor1, investor2, inv1DistAmount, {
            from: company,
          });
          await equityTokenController.executeForcedTransfer(investor1);
          expect(await equityToken.balanceOf(investor1)).to.be.bignumber.eq(0);
          expect(await equityToken.balanceOf(investor2)).to.be.bignumber.eq(inv1DistAmount);
        });

        it("should force transfer out of eto contract", async () => {
          // company is allowed to force transfer tokens that were not claimed from commitment contract
          // as mentioned: forced transfer make tokens non-trustless in the strict sense
          // force transfer of remaining tokens
          const amount = new web3.BigNumber(totalShares * (await equityToken.tokensPerShare())).sub(
            inv1DistAmount,
          );
          await equityTokenController.enableForcedTransfer(
            testCommitment.address,
            investor2,
            amount,
            {
              from: company,
            },
          );
          await equityTokenController.executeForcedTransfer(testCommitment.address);
          expect(await equityToken.balanceOf(testCommitment.address)).to.be.bignumber.eq(0);
          expect(await equityToken.balanceOf(investor2)).to.be.bignumber.eq(amount);
        });

        it("should not unfreeze tokens", async () => {
          let canTransfer = await equityTokenController.onTransfer(
            investor1,
            investor1,
            investor2,
            "1",
          );
          expect(canTransfer).to.be.false;
          await equityTokenController.freezeHolder(investor1, { from: company });
          await equityTokenController.unfreezeHolder(investor1, { from: company });
          canTransfer = await equityTokenController.onTransfer(
            investor1,
            investor1,
            investor2,
            "1",
          );
          expect(canTransfer).to.be.false;
        });
      });
    });

    describe("RegDTransferController", async () => {
      it("should deploy", async () => {
        await deployController(RegDTransferController);
        await prettyPrintGasCost("RegDTransferController deploy", equityTokenController);
      });

      it("should lock during lockin period", async () => {
        // make investor 1 reg-d investor
        const identityRegistry = await deployIdentityRegistry(universe, admin, admin);
        // verified, requires reg d accreditiation, has accreditiation
        await identityRegistry.setClaims(investor1, toBytes32("0x0"), toBytes32("0x31"), {
          from: admin,
        });
        // simulate ETO
        await deployController(RegDTransferController, { ENABLE_TRANSFERS_ON_SUCCESS: true });
        await deployETO();
        await makeInvestment(totalShares, inv1DistAmount);
        // investor 2 is a regular investor with transfer rights
        await testCommitment._distributeTokens(investor2, "1");
        // investor 1 should not be able to send
        let canTransfer = await equityTokenController.onTransfer(
          investor1,
          investor1,
          investor2,
          "1",
        );
        expect(canTransfer).to.be.false;
        // investor 1 should be able to receive
        canTransfer = await equityTokenController.onTransfer(investor2, investor2, investor1, "1");
        expect(canTransfer).to.be.true;
        // investor 2 is able to send
        canTransfer = await equityTokenController.onTransfer(
          investor2,
          investor2,
          investors[0],
          "1",
        );
        expect(canTransfer).to.be.true;
        // wait a year for lock in to expire
        await increaseTime(daysToSeconds(365) + 1);
        // investor 1 able to transfer
        canTransfer = await equityTokenController.onTransfer(investor1, investor1, investor2, "1");
        expect(canTransfer).to.be.true;
        await equityToken.transfer(investor2, 1, { from: investor1 });
        expect(await equityToken.balanceOf(investor1)).to.be.bignumber.eq(inv1DistAmount.sub("1"));
      });
    });

    async function deployController(impl, termsOverride, constraintsOverride) {
      [termsConstraints] = await deployETOTermsConstraintsUniverse(
        admin,
        universe,
        ETOTermsConstraints,
        constraintsOverride,
      );

      // default terms have non transferable token
      [etoTerms] = await deployETOTerms(
        universe,
        ETOTerms,
        durationTerms,
        tokenTerms,
        shareholderRights,
        termsConstraints,
        termsOverride,
      );
      equityTokenController = await impl.new(universe.address, company);
      equityToken = await EquityToken.new(
        universe.address,
        equityTokenController.address,
        tokenTerms.address,
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

    async function makeInvestment(shares, inv1amount) {
      // register new offering
      await testCommitment._triggerStateTransition(
        CommitmentState.Setup,
        CommitmentState.Whitelist,
      );
      // make investments
      const amount = new web3.BigNumber(shares * (await equityToken.tokensPerShare()));
      await testCommitment._generateTokens(amount);
      // finish offering
      await testCommitment._triggerStateTransition(
        CommitmentState.Whitelist,
        CommitmentState.Claim,
      );
      // distribute tokens to investors
      await testCommitment._distributeTokens(investor1, inv1amount);
    }
  },
);
