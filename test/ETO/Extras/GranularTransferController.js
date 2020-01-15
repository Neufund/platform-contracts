import { expect } from "chai";
import { deployPlatformTerms, deployUniverse } from "../../helpers/deployContracts";
import { contractId, ZERO_ADDRESS, toBytes32, Q18 } from "../../helpers/constants";
import { prettyPrintGasCost } from "../../helpers/gasUtils";
import { GovState, GovAction } from "../../helpers/govState";
import { CommitmentState } from "../../helpers/commitmentState";
import { divRound } from "../../helpers/unitConverter";
import {
  deployDurationTerms,
  deployETOTerms,
  deployShareholderRights,
  deployTokenTerms,
  deployETOTermsConstraintsUniverse,
} from "../../helpers/deployTerms";
import { knownInterfaces } from "../../helpers/knownInterfaces";
import { decodeLogs, eventValue, eventWithIdxValue, hasEvent } from "../../helpers/events";
import {
  basicTokenTests,
  deployTestErc223Callback,
  deployTestErc677Callback,
  erc223TokenTests,
  erc677TokenTests,
  standardTokenTests,
} from "../../helpers/tokenTestCases";
import createAccessPolicy from "../../helpers/createAccessPolicy";
import roles from "../../helpers/roles";

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

const inv1DistAmount = new web3.BigNumber("1325");

contract(
  "GranularTransferController",
  ([_, admin, company, nominee, investor1, investor2, ...investors]) => {
    let equityToken;
    let equityTokenController;
    let accessPolicy;
    let universe;
    let etoTerms;
    let etoTermsDict;
    let tokenTerms;
    let tokenTermsDict;
    let testCommitment;
    let shareholderRights;
    let durationTerms;
    let termsConstraints;

    beforeEach(async () => {
      [universe, accessPolicy] = await deployUniverse(admin, admin);
      await deployPlatformTerms(universe, admin);
      [shareholderRights] = await deployShareholderRights(ShareholderRights);
      [durationTerms] = await deployDurationTerms(ETODurationTerms);
      [tokenTerms, tokenTermsDict] = await deployTokenTerms(ETOTokenTerms);
    });

    it("should deploy", async () => {
      await deployController();
      await prettyPrintGasCost("PlaceholderEquityTokenController deploy", equityTokenController);
      const cId = await equityTokenController.contractId();
      expect(cId[0]).to.eq(contractId("PlaceholderEquityTokenController"));
      // temporary override marker
      expect(cId[1]).to.be.bignumber.eq(0xff);
    });

    describe("post investment transfers on transferable token", () => {
      beforeEach(async () => {
        await deployController({ ENABLE_TRANSFERS_ON_SUCCESS: true });
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
        // distribute tokens to investors
        await testCommitment._distributeTokens(investor1, inv1DistAmount);
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

      it("should freeze and unfreeze account", async () => {});
    });

    async function deployController(termsOverride, constraintsOverride) {
      [termsConstraints] = await deployETOTermsConstraintsUniverse(
        admin,
        universe,
        ETOTermsConstraints,
        constraintsOverride,
      );

      // default terms have non transferable token
      [etoTerms, etoTermsDict] = await deployETOTerms(
        universe,
        ETOTerms,
        durationTerms,
        tokenTerms,
        shareholderRights,
        termsConstraints,
        termsOverride,
      );
      equityTokenController = await GranularTransferController.new(universe.address, company);
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
  },
);
