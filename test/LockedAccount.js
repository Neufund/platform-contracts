import { expect } from "chai";
import moment from "moment";
import { hasEvent, eventValue, decodeLogs, eventWithIdxValue } from "./helpers/events";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployNeumarkUniverse,
  deployEtherTokenUniverse,
  deployEuroTokenUniverse,
  deployEtherTokenMigration,
  deployEuroTokenMigration,
  deployFeeDisbursalUniverse,
  deployPlatformTerms,
} from "./helpers/deployContracts";
import increaseTime, { setTimeTo } from "./helpers/increaseTime";
import { latestTimestamp } from "./helpers/latestTime";
import EvmError from "./helpers/EVMThrow";
import { TriState } from "./helpers/triState";
import forceEther from "./helpers/forceEther";
import { etherToWei, divRound } from "./helpers/unitConverter";
import roles from "./helpers/roles";
import { promisify } from "./helpers/evmCommands";
import {
  dayInSeconds,
  daysToSeconds,
  monthInSeconds,
  Q18,
  ZERO_ADDRESS,
} from "./helpers/constants";
import { toBytes32, contractId } from "./helpers/utils";
import { knownInterfaces } from "./helpers/knownInterfaces";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { expectLogFundsCommitted } from "./helpers/commitment";

const TestFeeDistributionPool = artifacts.require("TestFeeDistributionPool");
const TestNullContract = artifacts.require("TestNullContract");
const NullCommitment = artifacts.require("NullCommitment");
const EuroTokenController = artifacts.require("EuroTokenController");

const gasPrice = new web3.BigNumber(0x01); // this low gas price is forced by code coverage
const LOCK_PERIOD = 18 * monthInSeconds;
const UNLOCK_PENALTY_FRACTION = Q18.mul(0.1).round(0, 0);
const equityTokenAddress = "0x07a689aa85943bee87b65eb83726d7f6ec8acf01";

contract(
  "LockedAccount",
  ([_, admin, investor, investor2, investor3, investor4, operatorWallet]) => {
    let neumark;
    let accessPolicy;
    let universe;
    let identityRegistry;
    let controller;
    let assetToken;
    let tokenController;
    let lockedAccount;
    let icbmAssetToken;
    let icbmLockedAccount;
    let testDisbursal;
    let noCallbackContract;
    let startTimestamp;
    let commitment1;
    let commitment2;

    beforeEach(async () => {
      [universe, accessPolicy] = await deployUniverse(admin, admin);
      neumark = await deployNeumarkUniverse(universe, admin);
      identityRegistry = await deployIdentityRegistry(universe, admin, admin);
    });

    describe("EtherToken", () => {
      async function makeDepositEth(from, to, amount) {
        // make desposit to icbm asset token
        await icbmAssetToken.deposit({ from, value: amount });
        if (from !== to) {
          await icbmAssetToken.approve(to, amount, { from });
        }
      }

      async function makeWithdrawEth(investorAddress, amount) {
        // withdraw from platfrom asset token, we always migrate before unlock in the tests
        const initalBalance = await promisify(web3.eth.getBalance)(investorAddress);
        const tx = await assetToken.withdraw(amount, {
          from: investorAddress,
          gasPrice,
        });
        const afterBalance = await promisify(web3.eth.getBalance)(investorAddress);
        const gasCost = gasPrice.mul(tx.receipt.gasUsed);
        expect(afterBalance).to.be.bignumber.eq(initalBalance.add(amount).sub(gasCost));
      }

      beforeEach(async () => {
        assetToken = await deployEtherTokenUniverse(universe, admin);
        [
          lockedAccount,
          icbmLockedAccount,
          icbmAssetToken,
          controller,
        ] = await deployEtherTokenMigration(
          universe,
          admin,
          operatorWallet,
          LOCK_PERIOD,
          UNLOCK_PENALTY_FRACTION,
        );
        await deployAuxiliaryContracts();
        await setPenaltyDisbursal(operatorWallet);
      });

      describe("core tests", () => {
        beforeEach(async () => {
          await icbmLockedAccount.enableMigration(lockedAccount.address, {
            from: admin,
          });
        });
        lockedAccountTestCases(makeDepositEth, makeWithdrawEth);
      });

      describe("migration tests", () => {
        beforeEach(async () => {});
        lockedAccountMigrationTestCases(makeDepositEth);
      });

      describe("investment tests", () => {
        beforeEach(async () => {
          await icbmLockedAccount.enableMigration(lockedAccount.address, {
            from: admin,
          });
          await deployCommitments();
        });

        lockedAccountInvestTestCases(makeDepositEth);
      });
    });

    describe("EuroToken", () => {
      async function makeDepositEuro(from, to, amount) {
        // deposit to asset token
        // 'admin' has all the money in the bank, 'from' receives transfer permission to receive funds
        await icbmAssetToken.deposit(from, amount, { from: admin });
        if (from !== to) {
          await icbmAssetToken.approve(to, amount, { from });
        }
        // also let investor to send and receive new euro token + withdraw
        await setClaims(from);
      }

      async function makeWithdrawEuro(from, amount) {
        // withdraw from platfrom asset token, we always migrate before unlock in the tests
        // also the required claim is set
        const initalBalance = await assetToken.balanceOf.call(from);
        // notifies bank to pay out EUR, burns EURT
        await assetToken.withdraw(amount, { from });
        const afterBalance = await assetToken.balanceOf.call(from);
        expect(afterBalance).to.be.bignumber.eq(initalBalance.sub(amount));
      }

      beforeEach(async () => {
        [assetToken, tokenController] = await deployEuroTokenUniverse(
          universe,
          admin,
          admin,
          admin,
          Q18.mul(0),
          Q18.mul(0),
          Q18.mul(50),
        );
        [
          lockedAccount,
          icbmLockedAccount,
          icbmAssetToken,
          controller,
        ] = await deployEuroTokenMigration(
          universe,
          admin,
          operatorWallet,
          LOCK_PERIOD,
          UNLOCK_PENALTY_FRACTION,
        );
        await deployAuxiliaryContracts();
        // this will also re-apply euro token settings
        await setPenaltyDisbursal(operatorWallet);
      });

      describe("core tests", () => {
        beforeEach(async () => {
          await icbmLockedAccount.enableMigration(lockedAccount.address, {
            from: admin,
          });
        });
        lockedAccountTestCases(makeDepositEuro, makeWithdrawEuro);
      });

      describe("migration tests", () => {
        beforeEach(async () => {});

        lockedAccountMigrationTestCases(makeDepositEuro);
      });

      describe("investment tests", () => {
        beforeEach(async () => {
          await icbmLockedAccount.enableMigration(lockedAccount.address, {
            from: admin,
          });
          await deployCommitments();
        });

        lockedAccountInvestTestCases(makeDepositEuro);
      });
    });

    function lockedAccountInvestTestCases(makeDeposit) {
      function calcNeuRelease(neu, ticket, balance) {
        return divRound(ticket.mul(neu), balance);
      }

      async function commitFunds(
        investorAddress,
        ticket,
        balance,
        neumarks,
        commitment = commitment1,
      ) {
        const tx = await lockedAccount.transfer(commitment.address, ticket, "", {
          from: investorAddress,
        });
        const releasedNeu = calcNeuRelease(neumarks, ticket, balance);
        expectLockLogFundsCommitted(tx, investorAddress, commitment.address, ticket, releasedNeu);
        tx.logs = decodeLogs(tx, commitment.address, commitment.abi);
        expectLogFundsCommitted(
          tx,
          investorAddress,
          lockedAccount.address,
          assetToken.address,
          ticket,
          ticket.mul(2),
          ticket.mul(3),
          equityTokenAddress,
          ticket.mul(4),
        );
        return releasedNeu;
      }

      it("should invest below balance", async () => {
        const balance = Q18.mul(1571.1812);
        const neumarks = await lock(investor, balance, makeDeposit);
        const ticket = balance.sub(Q18.mul(671.2891));
        const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(releasedNeu));
        // check totals
        expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.eq(balance.sub(ticket));
      });

      it("should invest balance", async () => {
        const balance = Q18.mul(761.7212);
        const neumarks = await lock(investor, balance, makeDeposit);
        await commitFunds(investor, balance, balance, neumarks);
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(0);
        expect(icbmBalance[1]).to.be.bignumber.eq(0);
        // but account still exist there
        expect(icbmBalance[2]).to.be.bignumber.gt(0);
        // check totals
        expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.eq(0);
        expect(await lockedAccount.totalInvestors()).to.be.bignumber.eq(1);
      });

      it("reverts on invest over balance", async () => {
        const balance = Q18.mul(76.42871);
        const neumarks = await lock(investor, balance, makeDeposit);
        await expect(
          commitFunds(investor, balance.add(1), balance.add(1), neumarks),
        ).to.be.rejectedWith("NF_LOCKED_NO_FUNDS");
      });

      it("reverts on overflow 2**112", async () => {
        const balance = Q18.mul(7635.18727);
        const ticket = new web3.BigNumber(2).pow(112).add(1);
        const neumarks = await lock(investor, balance, makeDeposit);
        await expect(commitFunds(investor, ticket, balance, neumarks)).to.be.rejectedWith(
          "NF_LOCKED_NO_FUNDS",
        );
      });

      it("reverts on investing 0 wei", async () => {
        const balance = Q18.mul(7635.18727);
        const neumarks = await lock(investor, balance, makeDeposit);
        await expect(commitFunds(investor, 0, balance, neumarks)).to.be.rejectedWith(
          "NF_LOCKED_NO_ZERO",
        );
      });

      it("reverts on investment in unregistered commitment", async () => {
        const balance = Q18.mul(15271.1812);
        await lock(investor, balance, makeDeposit);
        const ticket = balance.sub(Q18.mul(671.2891));
        await universe.setCollectionInterface(
          knownInterfaces.commitmentInterface,
          commitment1.address,
          false,
          { from: admin },
        );
        await expect(
          lockedAccount.transfer(commitment1.address, ticket, "", { from: investor }),
        ).to.be.rejectedWith("NF_LOCKED_ONLY_COMMITMENT");
      });

      it("should invest balance in tranches", async () => {
        const balance = Q18.mul(77837.87162173).add(1);
        const neumarks = await lock(investor, balance, makeDeposit);
        const tranche1 = Q18.mul(0.76281).sub(1);
        const tranche2 = Q18.mul(8732.1882192).add(1);
        const tranche3 = Q18.mul(12812.38923);
        const tranche4 = Q18.mul(6.29832);
        const ticket = tranche1
          .add(tranche2)
          .add(tranche3)
          .add(tranche4);
        await commitFunds(investor, tranche1, balance, neumarks);
        await commitFunds(investor, tranche2, balance, neumarks);
        await commitFunds(investor, tranche3, balance, neumarks);
        await commitFunds(investor, tranche4, balance, neumarks);
        const pending = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(pending[0]).to.be.bignumber.eq(ticket);
        expect(pending[1]).to.be.bignumber.eq(calcNeuRelease(neumarks, ticket, balance));
        // totals
        expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.eq(balance.sub(ticket));
        const lockedBalance = await lockedAccount.balanceOf(investor);
        expect(lockedBalance[0]).to.be.bignumber.eq(balance.sub(ticket));
        expect(lockedBalance[1]).to.be.bignumber.eq(
          calcNeuRelease(neumarks, balance.sub(ticket), balance),
        );
      });

      it("should invest 1 wei in final tranche", async () => {
        // spending whole balance in tranches
        const balance = Q18.mul(876.2810821);
        const neumarks = await lock(investor, balance, makeDeposit);
        const tranche1 = Q18.mul(121.76281).sub(1);
        const tranche2 = balance.sub(tranche1.add(1));
        const tranche3 = new web3.BigNumber(1);

        await commitFunds(investor, tranche1, balance, neumarks);
        await commitFunds(investor, tranche2, balance, neumarks);
        await commitFunds(investor, tranche3, balance, neumarks);
        const pending = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(pending[0]).to.be.bignumber.eq(balance);
        expect(pending[1]).to.be.bignumber.eq(neumarks);
        // totals
        expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.eq(0);
        const lockedBalance = await lockedAccount.balanceOf(investor);
        expect(lockedBalance[0]).to.be.bignumber.eq(0);
        expect(lockedBalance[1]).to.be.bignumber.eq(0);
        // get refund
        await commitment1.refund(lockedAccount.address, { from: investor });
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks);
      });

      it("should invest in multiple commitments", async () => {
        const balance = Q18.mul(7281.2810821).add(1);
        const neumarks = await lock(investor, balance, makeDeposit);
        const ticket1 = Q18.mul(1121.776281).sub(1);
        const ticket2 = balance.sub(ticket1);

        await commitFunds(investor, ticket1, balance, neumarks);
        await commitFunds(investor, ticket2, balance, neumarks, commitment2);

        const pending1 = await lockedAccount.pendingCommitments(commitment1.address, investor);
        const neuTicket1 = calcNeuRelease(neumarks, ticket1, balance);
        expect(pending1[0]).to.be.bignumber.eq(ticket1);
        expect(pending1[1]).to.be.bignumber.eq(neuTicket1);
        const pending2 = await lockedAccount.pendingCommitments(commitment2.address, investor);
        const neuTicket2 = calcNeuRelease(neumarks.sub(neuTicket1), ticket2, balance.sub(ticket1));
        expect(pending2[0]).to.be.bignumber.eq(ticket2);
        expect(pending2[1]).to.be.bignumber.eq(neuTicket2);

        let icbmBalance = await lockedAccount.balanceOf(investor);
        const remainingBalance = balance.sub(ticket1).sub(ticket2);
        expect(icbmBalance[0]).to.be.bignumber.eq(remainingBalance);
        expect(icbmBalance[1]).to.be.bignumber.eq(
          calcNeuRelease(neumarks, remainingBalance, balance),
        );

        // refund 2
        await commitment2.refund(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket1));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(neuTicket1));
        // refund 1
        await commitment1.refund(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks);
      });

      it("should get refund", async () => {
        const balance = Q18.mul(1571.1812);
        const neumarks = await lock(investor, balance, makeDeposit);
        const ticket = balance.sub(Q18.mul(671.2891).add(1));
        const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
        let commitment = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(commitment[0]).to.be.bignumber.eq(ticket);
        expect(commitment[1]).to.be.bignumber.eq(releasedNeu);
        const tx = await commitment1.refund(lockedAccount.address, { from: investor });
        const logs = decodeLogs(tx, lockedAccount.address, lockedAccount.abi);
        tx.logs.push(...logs);
        expectLogFundsRefunded(tx, investor, commitment1.address, ticket, releasedNeu);
        commitment = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(commitment[0]).to.be.bignumber.eq(0);
        expect(commitment[1]).to.be.bignumber.eq(0);
        // all the money are back in the icbm wallet
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks);
      });

      it("should claim", async () => {
        const balance = Q18.mul(1571.1812);
        const neumarks = await lock(investor, balance, makeDeposit);
        const ticket = balance.sub(Q18.mul(671.2891).add(1));
        const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
        let commitment = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(commitment[0]).to.be.bignumber.eq(ticket);
        expect(commitment[1]).to.be.bignumber.eq(releasedNeu);
        await commitment1.claim(lockedAccount.address, { from: investor });
        commitment = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(commitment[0]).to.be.bignumber.eq(0);
        expect(commitment[1]).to.be.bignumber.eq(0);
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(releasedNeu));
      });

      it("should get refund from multiple tranches", async () => {
        const balance = Q18.mul(1571.1812).add(1);
        const neumarks = await lock(investor, balance, makeDeposit);
        const ticket = balance.sub(Q18.mul(671.2891));
        const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
        const ticket2 = Q18.mul(32.182112).sub(1);
        const releasedNeu2 = await commitFunds(
          investor,
          ticket2,
          balance.sub(ticket),
          neumarks.sub(releasedNeu),
        );
        const commitment = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(commitment[0]).to.be.bignumber.eq(ticket.add(ticket2));
        expect(commitment[1]).to.be.bignumber.eq(releasedNeu.add(releasedNeu2));
        const tx = await commitment1.refund(lockedAccount.address, { from: investor });
        const logs = decodeLogs(tx, lockedAccount.address, lockedAccount.abi);
        tx.logs.push(...logs);
        expectLogFundsRefunded(
          tx,
          investor,
          commitment1.address,
          ticket.add(ticket2),
          releasedNeu.add(releasedNeu2),
        );
        // all the money are back in the icbm wallet
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks);
      });

      it("should get refund from many commitments", async () => {
        const balance = Q18.mul(1571.1812);
        const neumarks = await lock(investor, balance, makeDeposit);

        const ticket = balance.sub(Q18.mul(671.2891));
        const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
        const committed = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(committed[0]).to.be.bignumber.eq(ticket);
        expect(committed[1]).to.be.bignumber.eq(releasedNeu);

        const ticket2 = Q18.mul(32.182112);
        const releasedNeu2 = await commitFunds(
          investor,
          ticket2,
          balance.sub(ticket),
          neumarks.sub(releasedNeu),
          commitment2,
        );
        const committed2 = await lockedAccount.pendingCommitments(commitment2.address, investor);
        expect(committed2[0]).to.be.bignumber.eq(ticket2);
        expect(committed2[1]).to.be.bignumber.eq(releasedNeu2);

        const tx = await commitment1.refund(lockedAccount.address, { from: investor });
        const logs = decodeLogs(tx, lockedAccount.address, lockedAccount.abi);
        tx.logs.push(...logs);
        expectLogFundsRefunded(tx, investor, commitment1.address, ticket, releasedNeu);
        // commitment 2 money is not back, remove from balance
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket2));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(releasedNeu2));

        const tx2 = await commitment2.refund(lockedAccount.address, { from: investor });
        const logs2 = decodeLogs(tx2, lockedAccount.address, lockedAccount.abi);
        tx2.logs.push(...logs2);
        expectLogFundsRefunded(tx2, investor, commitment2.address, ticket2, releasedNeu2);
        // all the money are back in the icbm wallet
        const icbmBalance2 = await lockedAccount.balanceOf(investor);
        expect(icbmBalance2[0]).to.be.bignumber.eq(balance);
        expect(icbmBalance2[1]).to.be.bignumber.eq(neumarks);
      });

      it("should ignore refunds if not invested before", async () => {
        // check unknown commitment contract, investor and when there was no preceding investment
        const balance = Q18.mul(761.7212).add(1);
        const neumarks = await lock(investor, balance, makeDeposit);
        await commitFunds(investor, balance, balance, neumarks);
        let icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(0);
        await commitment2.refund(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(0);
      });

      it("should ignore duplicate refunds", async () => {
        const balance = Q18.mul(761.7212).add(1);
        const neumarks = await lock(investor, balance, makeDeposit);
        await commitFunds(investor, balance, balance, neumarks);
        let icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(0);
        await commitment1.refund(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);
        await commitment1.refund(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);
      });

      it("reverts on refund if account unlocked", async () => {
        const balance = Q18.mul(761.7212).add(1);
        const neumarks = await lock(investor, balance, makeDeposit);
        const releasedNeu = await commitFunds(investor, Q18, balance, neumarks);
        await unlockWithApprove(investor, neumarks.sub(releasedNeu));
        await expect(
          commitment1.refund(lockedAccount.address, { from: investor }),
        ).to.be.rejectedWith("NF_LOCKED_ACCOUNT_LIQUIDATED");
      });

      it("should not refund after claim", async () => {
        const balance = Q18.mul(8716.111812);
        const neumarks = await lock(investor, balance, makeDeposit);
        const ticket = balance.sub(Q18.mul(1671.28991));
        const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);

        await commitment1.claim(lockedAccount.address, { from: investor });
        const commitment = await lockedAccount.pendingCommitments(commitment1.address, investor);
        expect(commitment[0]).to.be.bignumber.eq(0);
        expect(commitment[1]).to.be.bignumber.eq(0);
        // expect silently ignored
        const tx = await commitment1.refund(lockedAccount.address, { from: investor });
        expect(hasEvent(tx, "LogFundsRefunded")).to.be.false;
        // funds were spent
        const icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(releasedNeu));
      });

      it("should refund from commitment 1 and claim from  commitment 2", async () => {
        const balance = Q18.mul(8716.111812).sub(3);
        const neumarks = await lock(investor, balance, makeDeposit);
        const ticket = balance.sub(Q18.mul(1671.28991));
        const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
        const ticket2 = Q18.mul(0.219280912).add(1);
        const releasedNeu2 = await commitFunds(
          investor,
          ticket2,
          balance.sub(ticket),
          neumarks.sub(releasedNeu),
          commitment2,
        );
        let icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket).sub(ticket2));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(releasedNeu).sub(releasedNeu2));
        // refund 1
        await commitment1.refund(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket2));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(releasedNeu2));
        // claim2
        await commitment2.claim(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance.sub(ticket2));
        expect(icbmBalance[1]).to.be.bignumber.eq(neumarks.sub(releasedNeu2));
      });

      it("should silently ignore unexpected claims", async () => {
        // non existing investor
        await commitment1.claim(lockedAccount.address, { from: investor });
        const balance = Q18.mul(8716.111812);
        const neumarks = await lock(investor, balance, makeDeposit);
        let icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);
        await commitment1.claim(lockedAccount.address, { from: investor });
        icbmBalance = await lockedAccount.balanceOf(investor);
        expect(icbmBalance[0]).to.be.bignumber.eq(balance);

        const ticket = balance.sub(Q18.mul(1671.28991));
        await commitFunds(investor, ticket, balance, neumarks);

        await commitment2.claim(lockedAccount.address, { from: investor });
      });
    }

    function lockedAccountMigrationTestCases(makeDeposit) {
      function splitNeu(tranche, ticket, neumarks) {
        return divRound(tranche.mul(neumarks), ticket);
      }
      async function addOne(
        ticket,
        investorAddress,
        finalMigration = true,
        initialMigration = true,
      ) {
        const neumarks = ticket.mul(6.5).round(0, 4);
        // lock investor
        await makeDeposit(investorAddress, controller.address, ticket);
        await controller.investToken(neumarks, { from: investorAddress });
        if (finalMigration) {
          await controller.succ();
        }
        if (initialMigration) {
          // migration source set in the constructor of lockedAccount
          expect(await lockedAccount.currentMigrationSource()).to.eq(icbmLockedAccount.address);
          const tx = await icbmLockedAccount.enableMigration(lockedAccount.address, {
            from: admin,
          });
          expectMigrationEnabledEvent(tx, lockedAccount.address);
          expect(await icbmLockedAccount.currentMigrationTarget()).to.be.eq(lockedAccount.address);
        }
        return neumarks;
      }

      async function migrateOne(ticket, investorAddress, destinationAddress, allowMerge = false) {
        const neumarks = ticket.mul(6.5).round(0, 4);
        const initialLockedAmount = await lockedAccount.totalLockedAmount();
        const initialIcbmLockedAmount = await icbmLockedAccount.totalLockedAmount();
        const initialNumberOfInvestors = await lockedAccount.totalInvestors();
        const initialIcbmNumberOfInvestors = await icbmLockedAccount.totalInvestors();
        const investorBalanceBefore = await icbmLockedAccount.balanceOf.call(investorAddress);
        const assetBalanceTargetBefore = await assetToken.balanceOf.call(lockedAccount.address);
        const assetBalanceSourceBefore = await icbmAssetToken.balanceOf.call(
          icbmLockedAccount.address,
        );
        let investorBalanceTargetBefore = [
          new web3.BigNumber(0),
          new web3.BigNumber(0),
          new web3.BigNumber(0),
        ];
        if (allowMerge) {
          investorBalanceTargetBefore = await lockedAccount.balanceOf(destinationAddress);
        }
        // migrate investor
        const tx = await icbmLockedAccount.migrate({ from: investorAddress });
        expectInvestorMigratedEvent(
          tx,
          investorAddress,
          ticket,
          neumarks,
          investorBalanceBefore[2],
        );
        // must sign escrow agreement
        expect(await lockedAccount.agreementSignedAtBlock(destinationAddress)).to.be.bignumber.gt(
          0,
        );
        // check invariants
        expect(await icbmLockedAccount.totalLockedAmount()).to.be.bignumber.equal(
          initialIcbmLockedAmount.sub(ticket),
        );
        expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.equal(
          initialLockedAmount.add(ticket),
        );
        expect(await icbmLockedAccount.totalInvestors()).to.be.bignumber.equal(
          initialIcbmNumberOfInvestors.sub(1),
        );
        let newInvestors = 1;
        if (allowMerge && !investorBalanceTargetBefore[2].eq(0)) {
          // investor already exist in locked account so no new account will be created (merge)
          newInvestors = 0;
        }
        expect(await lockedAccount.totalInvestors()).to.be.bignumber.equal(
          initialNumberOfInvestors.add(newInvestors),
        );
        // check balance on old - no investor
        const investorBalanceAfter = await icbmLockedAccount.balanceOf.call(investorAddress);
        // unlockDate == 0: does not exit
        expect(investorBalanceAfter[2]).to.be.bignumber.equal(0);
        // check asset balance
        const assetBalanceSourceAfter = await icbmAssetToken.balanceOf.call(
          icbmLockedAccount.address,
        );
        const assetBalanceTargetAfter = await assetToken.balanceOf.call(lockedAccount.address);
        expect(assetBalanceSourceAfter).to.be.bignumber.eq(assetBalanceSourceBefore.sub(ticket));
        expect(assetBalanceTargetAfter).to.be.bignumber.eq(assetBalanceTargetBefore.add(ticket));
        // check balance in new locked account
        const investorBalanceTargetAfter = await lockedAccount.balanceOf(destinationAddress);
        expect(investorBalanceTargetAfter[0]).to.be.bignumber.eq(
          investorBalanceTargetBefore[0].add(ticket),
        );
        expect(investorBalanceTargetAfter[1]).to.be.bignumber.eq(
          investorBalanceTargetBefore[1].add(neumarks),
        );
        let expectedUnlockDate = investorBalanceBefore[2];
        if (allowMerge && !investorBalanceTargetBefore[2].eq(0)) {
          // we must preserve later unlock date
          if (investorBalanceTargetBefore[2].gt(expectedUnlockDate))
            expectedUnlockDate = investorBalanceTargetBefore[2];
        }
        expect(investorBalanceTargetAfter[2]).to.be.bignumber.eq(expectedUnlockDate);
      }

      it("reverts on call migrateInvestor not from source", async () => {
        await expect(
          lockedAccount.migrateInvestor(investor, Q18.mul(1), Q18.mul(1), startTimestamp, {
            from: admin,
          }),
        ).to.be.rejectedWith("NF_INV_SOURCE");
      });

      it("should migrate investor", async () => {
        const ticket = Q18.mul(781.28192);
        await addOne(ticket, investor);
        await migrateOne(ticket, investor, investor);
      });

      it("migrate same investor twice should do nothing", async () => {
        const ticket = Q18.mul(711.28192).add(1);
        await addOne(ticket, investor);
        await migrateOne(ticket, investor, investor);
        const tx = await icbmLockedAccount.migrate({ from: investor });
        expect(hasEvent(tx, "LogInvestorMigrated")).to.be.false;
      });

      it("migrate non existing investor should do nothing", async () => {
        const ticket = Q18.mul(719.98192);
        await addOne(ticket, investor);
        await migrateOne(ticket, investor, investor);
        const tx = await icbmLockedAccount.migrate({ from: investor2 });
        expect(hasEvent(tx, "LogInvestorMigrated")).to.be.false;
      });

      it("should migrate two", async () => {
        const ticket1 = Q18.mul(761.87178912);
        const ticket2 = Q18.mul(8728.82812).sub(1);
        await addOne(ticket1, investor, false);
        await addOne(ticket2, investor2, true, false);
        await migrateOne(ticket1, investor, investor);
        await migrateOne(ticket2, investor2, investor2);
      });

      it("should migrate to different destination address", async () => {
        const ticket = Q18.mul(37.172121);
        await addOne(ticket, investor);
        // destination wallet must be verified
        await setClaims(investor2);
        const tx = await lockedAccount.setInvestorMigrationWallet(investor2, { from: investor });
        expectLogMigrationDestination(tx, 0, investor, investor2, 0);
        await migrateOne(ticket, investor, investor2);
      });

      it("reverts on migration to not verified destination address", async () => {
        await expect(
          lockedAccount.setInvestorMigrationWallet(investor2, { from: investor }),
        ).to.be.rejectedWith("NF_DEST_NO_VERIFICATION");
      });

      it("should not squat existing investor", async () => {
        const ticket1 = Q18.mul(761.87178912);
        const ticket2 = Q18.mul(871628.82812).add(1);
        await addOne(ticket1, investor, false);
        await addOne(ticket2, investor2, true, false);
        await setClaims(investor2);
        // tries to occupy existing icbm investor2
        await expect(
          lockedAccount.setInvestorMigrationWallet(investor2, { from: investor }),
        ).to.be.rejectedWith("NF_DEST_NO_SQUATTING");
        // investor2 migrates
        await migrateOne(ticket2, investor2, investor2);
        // now destination address can be set
        await lockedAccount.setInvestorMigrationWallet(investor2, { from: investor });
        // now when investor migrates, ticket will blend into one and investor2 will own it
        await migrateOne(ticket1, investor, investor2, true);
      });

      it("should merge two migrations via destination address", async () => {
        const ticket1 = Q18.mul(761.87178912);
        const ticket2 = Q18.mul(871628.82812).add(1);
        await addOne(ticket1, investor, false);
        await addOne(ticket2, investor2, true, false);
        await setClaims(investor3);
        await lockedAccount.setInvestorMigrationWallet(investor3, { from: investor2 });
        await migrateOne(ticket2, investor2, investor3);
        await lockedAccount.setInvestorMigrationWallet(investor3, { from: investor });
        await migrateOne(ticket1, investor, investor3, true);
        const balance = await lockedAccount.balanceOf(investor3);
        expect(balance[0]).to.be.bignumber.eq(ticket1.add(ticket2));
      });

      it("should merge two migrations via destination address with later unlock date", async () => {
        const ticket1 = Q18.mul(761.87178912);
        const ticket2 = Q18.mul(5162112.82812);
        await addOne(ticket1, investor, false);
        await increaseTime(daysToSeconds(3));
        await addOne(ticket2, investor2, true, false);
        const preBalance = await icbmLockedAccount.balanceOf(investor2);
        await setClaims(investor3);
        await lockedAccount.setInvestorMigrationWallet(investor3, { from: investor2 });
        await migrateOne(ticket2, investor2, investor3);
        await lockedAccount.setInvestorMigrationWallet(investor3, { from: investor });
        await migrateOne(ticket1, investor, investor3, true);
        const balance = await lockedAccount.balanceOf(investor3);
        // investor 2 joined later and this unlock date will be preserved
        expect(balance[2]).to.be.bignumber.eq(preBalance[2]);
      });

      it("should overwrite destination address", async () => {
        // no destinations are set
        let destinations = await lockedAccount.getInvestorMigrationWallets(investor2);
        expect(destinations[0]).to.be.empty;
        expect(destinations[1]).to.be.empty;
        // investor2 is investing
        const ticket2 = Q18.mul(8728.182812);
        await addOne(ticket2, investor2);
        // will set many destinations
        await setClaims(investor4);
        await setClaims(investor);
        await setClaims(investor3);
        await setClaims(investor2);
        let tx = await lockedAccount.setInvestorMigrationWallet(investor3, { from: investor2 });
        expectLogMigrationDestination(tx, 0, investor2, investor3, 0);
        destinations = await lockedAccount.getInvestorMigrationWallets(investor2);
        expect(destinations[0]).to.deep.eq([investor3]);
        expect(destinations[1]).to.deep.eq([new web3.BigNumber(0)]);
        // set multiple destinations
        const ticket3 = Q18.mul(817.213);
        tx = await lockedAccount.setInvestorMigrationWallets([investor, investor3], [ticket3, 0], {
          from: investor2,
        });
        expectLogMigrationDestination(tx, 0, investor2, investor, ticket3);
        expectLogMigrationDestination(tx, 1, investor2, investor3, 0);
        destinations = await lockedAccount.getInvestorMigrationWallets(investor2);
        expect(destinations[0]).to.deep.eq([investor, investor3]);
        // console.log(destinations[1]);
        // console.log([ticket3, new web3.BigNumber(0)]);
        // expect(destinations[1]).to.have.same.deep.members([ticket3, new web3.BigNumber(0)]);
        // set single destination again - to yourself
        tx = await lockedAccount.setInvestorMigrationWallet(investor2, { from: investor2 });
        destinations = await lockedAccount.getInvestorMigrationWallets(investor2);
        expect(destinations[0]).to.deep.eq([investor2]);
        expect(destinations[1]).to.deep.eq([new web3.BigNumber(0)]);
        expectLogMigrationDestination(tx, 0, investor2, investor2, 0);
        await migrateOne(ticket2, investor2, investor2);
        destinations = await lockedAccount.getInvestorMigrationWallets(investor2);
        expect(destinations[0]).to.be.empty;
        expect(destinations[1]).to.be.empty;
      });

      it("rejects on overspend during split", async () => {
        const ticket2 = Q18.mul(8728.182812);
        await addOne(ticket2, investor2);
        await setClaims(investor2);
        await setClaims(investor3);
        // tries to overspent
        await lockedAccount.setInvestorMigrationWallets([investor2], [ticket2.add(1)], {
          from: investor2,
        });
        await expect(migrateOne(ticket2.add(1), investor2, investor2)).to.be.rejectedWith(
          "NF_LOCKED_ACCOUNT_SPLIT_OVERSPENT",
        );
        await lockedAccount.setInvestorMigrationWallets([investor2, investor3], [ticket2, 1], {
          from: investor2,
        });
        await expect(migrateOne(ticket2.add(1), investor2, investor2)).to.be.rejectedWith(
          "NF_LOCKED_ACCOUNT_SPLIT_OVERSPENT",
        );
        // equal spend (in tranches) will pass
        const tranche1 = Q18.mul(0.289182);
        const tranche2 = Q18.mul(837.21983);
        const tranche3 = Q18.mul(5281.93892932);
        await lockedAccount.setInvestorMigrationWallets(
          [investor2, investor2, investor2, investor2],
          [tranche1, tranche2, tranche3, 0],
          { from: investor2 },
        );
        await migrateOne(ticket2, investor2, investor2);
      });

      it("rejects on underspend during split", async () => {
        const ticket2 = Q18.mul(9128.817231);
        await addOne(ticket2, investor2);
        await setClaims(investor2);
        await setClaims(investor3);
        // tries to underspend
        await lockedAccount.setInvestorMigrationWallets([investor2], [ticket2.sub(1)], {
          from: investor2,
        });
        await expect(migrateOne(ticket2.add(1), investor2, investor2)).to.be.rejectedWith(
          "NF_LOCKED_ACCOUNT_SPLIT_UNDERSPENT",
        );
        await lockedAccount.setInvestorMigrationWallets(
          [investor2, investor3],
          [ticket2.sub(2), 1],
          { from: investor2 },
        );
        await expect(migrateOne(ticket2.add(1), investor2, investor2)).to.be.rejectedWith(
          "NF_LOCKED_ACCOUNT_SPLIT_UNDERSPENT",
        );
        // equal spend (in tranches) will pass
        const tranche1 = Q18.mul(1.873289182);
        const tranche2 = Q18.mul(8371.8732);
        const tranche3 = Q18.mul(65.918827817);
        const tranche4 = ticket2
          .sub(tranche1)
          .sub(tranche2)
          .sub(tranche3);
        await lockedAccount.setInvestorMigrationWallets(
          [investor2, investor2, investor2, investor2],
          [tranche1, tranche2, tranche3, tranche4],
          { from: investor2 },
        );
        await migrateOne(ticket2, investor2, investor2);
      });

      it("should split into many separate destinations", async () => {
        // investor2 is investing
        const ticket2 = Q18.mul(81728.182812);
        const neumarks = await addOne(ticket2, investor2);
        const initialBalance = await icbmLockedAccount.balanceOf(investor2);
        // split into 4 accounts including himself
        await setClaims(investor4);
        await setClaims(investor);
        await setClaims(investor3);
        await setClaims(investor2);
        // define splits
        const tranche1 = Q18.mul(8217.281).sub(1);
        const tranche2 = Q18.mul(451.182).add(1);
        const tranche3 = Q18.mul(0.9992182);
        const tranche4 = ticket2
          .sub(tranche1)
          .sub(tranche2)
          .sub(tranche3);
        await lockedAccount.setInvestorMigrationWallets(
          [investor4, investor, investor3, investor2],
          [tranche1, tranche2, tranche3, tranche4],
          { from: investor2 },
        );
        // migrate
        const tx = await icbmLockedAccount.migrate({ from: investor2 });
        // expect 4 locked events
        const tranche1Neu = splitNeu(tranche1, ticket2, neumarks);
        const tranche2Neu = splitNeu(tranche2, ticket2.sub(tranche1), neumarks.sub(tranche1Neu));
        const tranche3Neu = splitNeu(
          tranche3,
          ticket2.sub(tranche1).sub(tranche2),
          neumarks.sub(tranche1Neu).sub(tranche2Neu),
        );
        const tranche4Neu = splitNeu(
          tranche4,
          ticket2
            .sub(tranche1)
            .sub(tranche2)
            .sub(tranche3),
          neumarks
            .sub(tranche1Neu)
            .sub(tranche2Neu)
            .sub(tranche3Neu),
        );
        expectLockEvent(tx, 0, investor4, tranche1, tranche1Neu);
        expectLockEvent(tx, 1, investor, tranche2, tranche2Neu);
        expectLockEvent(tx, 2, investor3, tranche3, tranche3Neu);
        expectLockEvent(tx, 3, investor2, tranche4, tranche4Neu);
        // get balances
        async function expectBalance(b, t, n) {
          expect(b[0]).to.be.bignumber.eq(t);
          expect(b[1]).to.be.bignumber.eq(n);
          expect(b[2]).to.be.bignumber.eq(initialBalance[2]);
        }
        const balance4 = await lockedAccount.balanceOf(investor4);
        const balance = await lockedAccount.balanceOf(investor);
        const balance3 = await lockedAccount.balanceOf(investor3);
        const balance2 = await lockedAccount.balanceOf(investor2);
        expectBalance(balance4, tranche1, tranche1Neu);
        expectBalance(balance, tranche2, tranche2Neu);
        expectBalance(balance3, tranche3, tranche3Neu);
        expectBalance(balance2, tranche4, tranche4Neu);
        // check totals
        expect(await lockedAccount.totalInvestors()).to.be.bignumber.eq(4);
        expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.eq(ticket2);
      });

      it("should split and merge into many separate destinations", async () => {
        // investor2 splits into 3 investor, investor3 and investor4
        // investor merges into investor3
        // investor4 splits into investor4 and investor3
        const ticket = Q18.mul(763.91982);
        const ticket2 = Q18.mul(81728.182812);
        const ticket4 = Q18.mul(1652.8821);
        const neumarks = await addOne(ticket, investor, false);
        const neumarks2 = await addOne(ticket2, investor2, false, false);
        const neumarks4 = await addOne(ticket4, investor4, true, false);
        await setClaims(investor4);
        await setClaims(investor);
        await setClaims(investor3);
        await setClaims(investor2);
        // split 4
        const tranche43 = Q18.mul(76.18721);
        const tranche4 = ticket4.sub(tranche43);
        await lockedAccount.setInvestorMigrationWallets(
          [investor3, investor4],
          [tranche43, tranche4],
          { from: investor4 },
        );
        // migrate
        let tx = await icbmLockedAccount.migrate({ from: investor4 });
        // expect 2 locked events
        expectLockEvent(tx, 0, investor3, tranche43, splitNeu(tranche43, ticket4, neumarks4));
        expectLockEvent(tx, 1, investor4, tranche4, splitNeu(tranche4, ticket4, neumarks4));
        // split 1
        await lockedAccount.setInvestorMigrationWallet(investor3, { from: investor });
        tx = await icbmLockedAccount.migrate({ from: investor });
        // expect 2 locked events
        expectLockEvent(tx, 0, investor3, ticket, neumarks);
        // split 2
        const tranche21 = Q18.mul(671.2812);
        const tranche23 = Q18.mul(1.9992182);
        const tranche24 = ticket2.sub(tranche21).sub(tranche23);
        await lockedAccount.setInvestorMigrationWallets(
          [investor, investor3, investor4],
          [tranche21, tranche23, tranche24],
          { from: investor2 },
        );
        // migrate
        tx = await icbmLockedAccount.migrate({ from: investor2 });
        // expect 4 locked events
        expectLockEvent(tx, 0, investor, tranche21, splitNeu(tranche21, ticket2, neumarks2));
        expectLockEvent(tx, 1, investor3, tranche23, splitNeu(tranche23, ticket2, neumarks2));
        expectLockEvent(tx, 2, investor4, tranche24, splitNeu(tranche24, ticket2, neumarks2));
        // get balances
        async function expectBalance(b, t, n) {
          expect(b[0]).to.be.bignumber.eq(t);
          expect(b[1]).to.be.bignumber.eq(n);
        }
        const balance4 = await lockedAccount.balanceOf(investor4);
        const balance = await lockedAccount.balanceOf(investor);
        const balance3 = await lockedAccount.balanceOf(investor3);
        const balance2 = await lockedAccount.balanceOf(investor2);
        expectBalance(
          balance4,
          tranche4.add(tranche24),
          splitNeu(tranche4, ticket4, neumarks4).add(splitNeu(tranche24, ticket2, neumarks2)),
        );
        expectBalance(balance, tranche21, splitNeu(tranche21, ticket2, neumarks2));
        expectBalance(
          balance3,
          tranche43.add(ticket).add(tranche23),
          splitNeu(tranche43, ticket4, neumarks4)
            .add(neumarks)
            .add(splitNeu(tranche23, ticket2, neumarks2)),
        );
        expectBalance(balance2, 0, 0);
        // check totals
        expect(await lockedAccount.totalInvestors()).to.be.bignumber.eq(3);
        expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.eq(
          ticket2.add(ticket).add(ticket4),
        );
      });

      it("ignores overflow in set migration destination", async () => {
        // skip tests for ether token
        if (assetToken.address === (await universe.etherToken())) {
          return;
        }
        const overflow = Q18.mul(50.49);
        const ticket = new web3.BigNumber(2).pow(112).add(overflow);
        await addOne(overflow, investor);
        // destination wallet must be verified
        await setClaims(investor);
        // ticket % 2**112 will be passed as amount, see solidity code
        const tx = await lockedAccount.setInvestorMigrationWallets([investor], [ticket], {
          from: investor,
        });
        expectLogMigrationDestination(tx, 0, investor, investor, overflow);
        const destination = await lockedAccount.getInvestorMigrationWallets(investor);
        expect(destination[1][0]).to.be.bignumber.eq(overflow);
        await migrateOne(overflow, investor, investor);
      });

      it("reverts on overflow in migration", async () => {
        // skip tests for ether token
        if (assetToken.address === (await universe.etherToken())) {
          return;
        }
        const overflow = new web3.BigNumber(1);
        const ticket = new web3.BigNumber(2).pow(112).add(overflow);
        await addOne(ticket, investor);
        // destination wallet must be verified
        await setClaims(investor);
        // ticket % 2**112 will be passed as amount, see solidity code
        const tx = await lockedAccount.setInvestorMigrationWallets([investor], [ticket], {
          from: investor,
        });
        expectLogMigrationDestination(tx, 0, investor, investor, overflow);
        const destination = await lockedAccount.getInvestorMigrationWallets(investor);
        expect(destination[1][0]).to.be.bignumber.eq(overflow);
        await expect(migrateOne(overflow, investor, investor)).to.be.rejectedWith("NF_OVR");
      });
    }

    function lockedAccountTestCases(makeDeposit, makeWithdraw) {
      async function allowToReclaim(account) {
        await accessPolicy.setUserRole(
          account,
          roles.reclaimer,
          lockedAccount.address,
          TriState.Allow,
        );
      }

      it("should be able to read lock parameters", async () => {
        await prettyPrintGasCost("LockedAcount deploy", lockedAccount);
        expect(await lockedAccount.totalLockedAmount.call()).to.be.bignumber.eq(0);
        expect(await lockedAccount.totalInvestors.call()).to.be.bignumber.eq(0);
        expect(await lockedAccount.paymentToken.call()).to.eq(assetToken.address);
        expect(await lockedAccount.neumark.call()).to.eq(neumark.address);
        expect(await lockedAccount.lockPeriod.call()).to.be.bignumber.eq(LOCK_PERIOD);
        expect(await lockedAccount.penaltyFraction.call()).to.be.bignumber.eq(
          UNLOCK_PENALTY_FRACTION,
        );
        expect(await lockedAccount.currentMigrationSource()).to.eq(icbmLockedAccount.address);
        expect((await lockedAccount.contractId())[0]).to.eq(contractId("LockedAccount"));
      });

      it("should lock and migrate", async () => {
        await lock(investor, etherToWei(1), makeDeposit);
      });

      it("should lock and migrate two different investors", async () => {
        await lock(investor, etherToWei(1), makeDeposit);
        await lock(investor2, etherToWei(0.5), makeDeposit);
      });

      it("should unlock with approval on contract disbursal", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        // change disbursal pool
        await setPenaltyDisbursal(testDisbursal.address);
        const unlockTx = await unlockWithApprove(investor, neumarks);
        const penalty = await calculateUnlockPenalty(ticket);
        // check if disbursal pool logged transfer
        const logs = decodeLogs(unlockTx, testDisbursal.address, testDisbursal.abi);
        unlockTx.logs.push(...logs);
        expectLogTestReceiveTransfer(
          unlockTx,
          assetToken.address,
          neumark.address,
          lockedAccount.address,
          penalty,
        );
        await assertCorrectUnlock(unlockTx, investor, ticket, penalty);
        await expectPenaltyEvent(unlockTx, investor, penalty);
        expectUnlockEvent(unlockTx, investor, ticket.sub(penalty), neumarks);
        await makeWithdraw(investor, ticket.sub(penalty));
      });

      it("should unlock two investors both with penalty", async () => {
        const ticket1 = etherToWei(1);
        const ticket2 = etherToWei(0.6210939884);
        const neumarks1 = await lock(investor, ticket1, makeDeposit);
        const neumarks2 = await lock(investor2, ticket2, makeDeposit);
        await setPenaltyDisbursal(operatorWallet);
        let unlockTx = await unlockWithApprove(investor, neumarks1);
        const penalty1 = await calculateUnlockPenalty(ticket1);
        await expectPenaltyEvent(unlockTx, investor, penalty1);
        await expectPenaltyBalance(penalty1);
        expectUnlockEvent(unlockTx, investor, ticket1.sub(penalty1), neumarks1);
        expect(await neumark.balanceOf(investor2)).to.be.bignumber.eq(neumarks2);
        expect(await neumark.totalSupply()).to.be.bignumber.eq(neumarks2);
        expect(await assetToken.balanceOf(lockedAccount.address)).to.be.bignumber.eq(ticket2);
        expect(await assetToken.totalSupply()).to.be.bignumber.eq(ticket1.add(ticket2));

        unlockTx = await unlockWithApprove(investor2, neumarks2);
        const penalty2 = await calculateUnlockPenalty(ticket2);
        await expectPenaltyEvent(unlockTx, investor2, penalty2);
        await expectPenaltyBalance(penalty1.add(penalty2));
        expectUnlockEvent(unlockTx, investor2, ticket2.sub(penalty2), neumarks2);
      });

      it("should reject unlock with approval on contract disbursal that has tokenFallback not implemented", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        // change disbursal pool to contract without receiveApproval, comment line below for test to fail
        await setPenaltyDisbursal(noCallbackContract.address);
        const tx = await neumark.approve(lockedAccount.address, neumarks, {
          from: investor,
        });
        expect(eventValue(tx, "Approval", "amount")).to.be.bignumber.equal(neumarks);
        await expect(lockedAccount.unlock({ from: investor })).to.be.rejectedWith(EvmError);
      });

      it("should unlock with approval on simple address disbursal", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        await setPenaltyDisbursal(operatorWallet);
        const unlockTx = await unlockWithApprove(investor, neumarks);
        const penalty = await calculateUnlockPenalty(ticket);
        await assertCorrectUnlock(unlockTx, investor, ticket, penalty);
        await expectPenaltyEvent(unlockTx, investor, penalty);
        expectUnlockEvent(unlockTx, investor, ticket.sub(penalty), neumarks);
        await makeWithdraw(investor, ticket.sub(penalty));
      });

      it("should unlock with approveAndCall on simple address disbursal", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        await setPenaltyDisbursal(operatorWallet);
        const unlockTx = await unlockWithCallback(investor, neumarks);
        const penalty = await calculateUnlockPenalty(ticket);
        await assertCorrectUnlock(unlockTx, investor, ticket, penalty);
        const logs = decodeLogs(unlockTx, lockedAccount.address, lockedAccount.abi);
        unlockTx.logs.push(...logs);
        await expectPenaltyEvent(unlockTx, investor, penalty);
        expectUnlockEvent(unlockTx, investor, ticket.sub(penalty), neumarks);
        expectNeumarksBurnedEvent(unlockTx, lockedAccount.address, ticket, neumarks);
        await makeWithdraw(investor, ticket.sub(penalty));
      });

      it("should unlock with approveAndCall on real FeeDisbursal", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        // must have platform terms to read default recycle period
        await deployPlatformTerms(universe, admin);
        // change to new FeeDisbursal
        const [feeDisbursal] = await deployFeeDisbursalUniverse(universe, admin);
        // all neu will be burned so give neu to someone else so we can distribute
        await neumark.issueForEuro(Q18, { from: admin });
        // also let it process nEUR
        const etcAddress = await universe.getSingleton(knownInterfaces.euroTokenController);
        if (etcAddress !== ZERO_ADDRESS) {
          const euroTokenController = await EuroTokenController.at(etcAddress);
          await euroTokenController.applySettings(0, 0, Q18, { from: admin });
        }
        // this will pay out
        await unlockWithCallback(investor, neumarks);
        const penalty = await calculateUnlockPenalty(ticket);
        expect(await assetToken.balanceOf(feeDisbursal.address)).to.be.bignumber.eq(penalty);
      });

      it("should silently exit on unlock of non-existing investor", async () => {
        await setPenaltyDisbursal(operatorWallet);
        const unlockTx = await unlockWithCallback(investor, new web3.BigNumber(1));
        const events = unlockTx.logs.filter(e => e.event === "LogFundsUnlocked");
        expect(events).to.be.empty;
      });

      it("should reject unlock with approveAndCall with unknown token", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        await setPenaltyDisbursal(operatorWallet);
        await unlockWithCallbackUnknownToken(investor, neumarks);
      });

      it("should allow unlock when neumark allowance and balance is too high", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        const neumarks2 = await lock(investor2, ticket, makeDeposit);
        await setPenaltyDisbursal(testDisbursal.address);
        // simulate trade
        const tradedAmount = neumarks2.mul(0.71389012).round(0);
        await neumark.transfer(investor, tradedAmount, {
          from: investor2,
        });
        neumark.approveAndCall(lockedAccount.address, neumarks.add(tradedAmount), "", {
          from: investor,
        });
        // should keep traded amount
        expect(await neumark.balanceOf(investor)).to.be.bignumber.eq(tradedAmount);
      });

      it("should reject approveAndCall unlock when neumark allowance too low", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        await setPenaltyDisbursal(testDisbursal.address);
        // change to mul(0) for test to fail
        const tradedAmount = neumarks.mul(0.71389012).round(0);
        await neumark.transfer(investor2, tradedAmount, {
          from: investor,
        });
        await expect(
          neumark.approveAndCall(lockedAccount.address, neumarks.sub(tradedAmount), "", {
            from: investor,
          }),
        ).to.be.rejectedWith(EvmError);
      });

      it("should reject unlock when neumark allowance too low", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        await setPenaltyDisbursal(testDisbursal.address);
        // allow 1/3 amount
        await neumark.approve(lockedAccount.address, neumarks.mul(0.3), {
          from: investor,
        });
        await expect(lockedAccount.unlock({ from: investor })).to.be.rejectedWith(EvmError);
      });

      it("should reject unlock when neumark balance too low but allowance OK", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        await setPenaltyDisbursal(testDisbursal.address);
        // simulate trade
        const tradedAmount = neumarks.mul(0.71389012).round(0);
        await neumark.transfer(investor2, tradedAmount, {
          from: investor,
        });
        // allow full amount
        await neumark.approve(lockedAccount.address, neumarks, {
          from: investor,
        });
        await expect(lockedAccount.unlock({ from: investor })).to.be.rejectedWith(EvmError);
      });

      it("should unlock after unlock date without penalty", async () => {
        const ticket = etherToWei(1);
        const neumarks = await lock(investor, ticket, makeDeposit);
        await setPenaltyDisbursal(testDisbursal.address);
        const investorBalance = await lockedAccount.balanceOf(investor);
        // forward time to unlock date
        await setTimeTo(investorBalance[2]);
        const unlockTx = await unlockWithApprove(investor, neumarks);
        await assertCorrectUnlock(unlockTx, investor, ticket, 0);
        expectUnlockEvent(unlockTx, investor, ticket, neumarks);
        await makeWithdraw(investor, ticket);
        await expectPenaltyBalance(0);
      });

      it("should unlock two investors both without penalty", async () => {
        const ticket1 = etherToWei(4.18781092183);
        const ticket2 = etherToWei(0.46210939884);
        const neumarks1 = await lock(investor, ticket1, makeDeposit);
        // day later
        await increaseTime(moment.duration(dayInSeconds, "s"));
        const neumarks2 = await lock(investor2, ticket2, makeDeposit);
        await setPenaltyDisbursal(testDisbursal.address);
        // forward to investor1 unlock date
        const investorBalance = await lockedAccount.balanceOf(investor);
        await setTimeTo(investorBalance[2]);
        let unlockTx = await unlockWithApprove(investor, neumarks1);
        expectUnlockEvent(unlockTx, investor, ticket1, neumarks1);
        await makeWithdraw(investor, ticket1);

        const investor2Balance = await lockedAccount.balanceOf(investor2);
        await setTimeTo(investor2Balance[2]);
        unlockTx = await unlockWithApprove(investor2, neumarks2);
        expectUnlockEvent(unlockTx, investor2, ticket2, neumarks2);
        await makeWithdraw(investor2, ticket2);
        await expectPenaltyBalance(0);
      });

      it("should unlock two investors one with penalty, second without penalty", async () => {
        const ticket1 = etherToWei(9.18781092183);
        const ticket2 = etherToWei(0.06210939884);
        const neumarks1 = await lock(investor, ticket1, makeDeposit);
        // day later
        await increaseTime(moment.duration(dayInSeconds, "s"));
        const neumarks2 = await lock(investor2, ticket2, makeDeposit);
        await setPenaltyDisbursal(testDisbursal.address);
        // forward to investor1 unlock date
        const investorBalance = await lockedAccount.balanceOf(investor);
        await setTimeTo(investorBalance[2]);
        let unlockTx = await unlockWithApprove(investor, neumarks1);
        expectUnlockEvent(unlockTx, investor, ticket1, neumarks1);
        await makeWithdraw(investor, ticket1);

        const investor2Balance = await lockedAccount.balanceOf(investor2);
        // 10 seconds before unlock date should produce penalty
        await setTimeTo(investor2Balance[2] - 10);
        unlockTx = await unlockWithApprove(investor2, neumarks2);
        const penalty2 = await calculateUnlockPenalty(ticket2);
        await expectPenaltyEvent(unlockTx, investor2, penalty2);
        await expectPenaltyBalance(penalty2);
        expectUnlockEvent(unlockTx, investor2, ticket2.sub(penalty2), neumarks2);
        await makeWithdraw(investor2, ticket2.sub(penalty2));
      });

      it("should reject unlock if disbursal pool is not set");

      it("should reject to reclaim paymentToken", async () => {
        const ticket1 = etherToWei(9.18781092183);
        await lock(investor, ticket1, makeDeposit);
        // send assetToken to locked account
        const shouldBeReclaimedDeposit = etherToWei(0.028319821);
        await makeDeposit(investor2, lockedAccount.address, shouldBeReclaimedDeposit);
        // should reclaim
        await allowToReclaim(admin);
        // replace assetToken with neumark for this test to fail
        await expect(
          lockedAccount.reclaim(assetToken.address, {
            from: admin,
          }),
        ).to.be.rejectedWith("NO_PAYMENT_TOKEN_RECLAIM");
      });

      it("should reclaim neumarks", async () => {
        const ticket1 = etherToWei(9.18781092183);
        const neumarks1 = await lock(investor, ticket1, makeDeposit);
        await neumark.transfer(lockedAccount.address, neumarks1, {
          from: investor,
        });
        await allowToReclaim(admin);
        await lockedAccount.reclaim(neumark.address, { from: admin });
        expect(await neumark.balanceOf(admin)).to.be.bignumber.eq(neumarks1);
      });

      it("should reclaim ether", async () => {
        const RECLAIM_ETHER = "0x0";
        const amount = etherToWei(1);
        await forceEther(lockedAccount.address, amount, investor);
        await allowToReclaim(admin);
        const adminEthBalance = await promisify(web3.eth.getBalance)(admin);
        const tx = await lockedAccount.reclaim(RECLAIM_ETHER, {
          from: admin,
          gasPrice,
        });
        const gasCost = gasPrice.mul(tx.receipt.gasUsed);
        const adminEthAfterBalance = await promisify(web3.eth.getBalance)(admin);
        expect(adminEthAfterBalance).to.be.bignumber.eq(adminEthBalance.add(amount).sub(gasCost));
      });
    }

    async function deployCommitments() {
      commitment1 = await NullCommitment.new(universe.address);
      commitment2 = await NullCommitment.new(universe.address);
      await universe.setCollectionsInterfaces(
        [knownInterfaces.commitmentInterface, knownInterfaces.commitmentInterface],
        [commitment1.address, commitment2.address],
        [true, true],
        { from: admin },
      );
    }

    async function lock(investorAddress, ticket, makeDeposit) {
      // initial state of the new lock
      const initialLockedAmount = await lockedAccount.totalLockedAmount();
      const initialAssetSupply = await assetToken.totalSupply();
      const initialNumberOfInvestors = await lockedAccount.totalInvestors();
      const initialNeumarksBalance = await neumark.balanceOf(investorAddress);
      const initialLockedBalance = await lockedAccount.balanceOf(investorAddress);
      // issue real neumarks and check against
      let tx = await neumark.issueForEuro(ticket, {
        from: investorAddress,
      });
      const neumarks = eventValue(tx, "LogNeumarksIssued", "neumarkUlps");
      expect(await neumark.balanceOf(investorAddress)).to.be.bignumber.equal(
        neumarks.add(initialNeumarksBalance),
      );
      // will put tokens in old lock
      await makeDeposit(investorAddress, controller.address, ticket);
      tx = await controller.investToken(neumarks, { from: investorAddress });
      expectLockEvent(tx, 0, investorAddress, ticket, neumarks);
      // timestamp of block _investFor was mined
      const txBlock = await promisify(web3.eth.getBlock)(tx.receipt.blockNumber);
      const timebase = txBlock.timestamp;
      // migrate to new lock
      await icbmLockedAccount.migrate({ from: investorAddress });
      // expect funds locked for destination wallet
      expectLockEvent(tx, 0, investorAddress, ticket, neumarks);
      // check balance in new lock
      const investorBalance = await lockedAccount.balanceOf(investorAddress);
      expect(investorBalance[0]).to.be.bignumber.equal(ticket.add(initialLockedBalance[0]));
      expect(investorBalance[1]).to.be.bignumber.equal(neumarks.add(initialLockedBalance[1]));
      // verify longstop date independently
      let unlockDate = new web3.BigNumber(timebase + 18 * 30 * dayInSeconds);
      if (initialLockedBalance[2] > 0) {
        // earliest date is preserved for repeated investor address
        unlockDate = initialLockedBalance[2];
      }
      expect(investorBalance[2], "18 months in future").to.be.bignumber.eq(unlockDate);
      expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.equal(
        initialLockedAmount.add(ticket),
      );
      expect(await assetToken.totalSupply()).to.be.bignumber.equal(initialAssetSupply.add(ticket));
      const hasNewInvestor = initialLockedBalance[2] > 0 ? 0 : 1;
      expect(await lockedAccount.totalInvestors()).to.be.bignumber.equal(
        initialNumberOfInvestors.add(hasNewInvestor),
      );

      return neumarks;
    }

    async function setClaims(investorAddress, claims = "0x5") {
      const currentClaims = await identityRegistry.getClaims(investorAddress);
      await identityRegistry.setClaims(investorAddress, currentClaims, toBytes32(claims), {
        from: admin,
      });
    }

    async function unlockWithApprove(investorAddress, neumarkToBurn) {
      // investor approves transfer to lock contract to burn neumarks
      // console.log(`investor has ${parseInt(await neumark.balanceOf(investor))}`);
      const tx = await neumark.approve(lockedAccount.address, neumarkToBurn, {
        from: investorAddress,
      });
      expect(eventValue(tx, "Approval", "amount")).to.be.bignumber.equal(neumarkToBurn);
      // only investor can unlock and must burn tokens
      return lockedAccount.unlock({ from: investorAddress });
    }

    async function unlockWithCallback(investorAddress, neumarkToBurn) {
      // investor approves transfer to lock contract to burn neumarks
      // console.log(`investor has ${await neumark.balanceOf(investor)} against ${neumarkToBurn}`);
      // console.log(`${lockedAccount.address} should spend`);
      // await lockedAccount.receiveApproval(investor, neumarkToBurn, neumark.address, "");
      const tx = await neumark.approveAndCall(lockedAccount.address, neumarkToBurn, "", {
        from: investorAddress,
      });
      expect(eventValue(tx, "Approval", "amount")).to.be.bignumber.equal(neumarkToBurn);

      return tx;
    }

    async function unlockWithCallbackUnknownToken(investorAddress, neumarkToBurn) {
      // asset token is not allowed to call unlock on ICBMLockedAccount, change to neumark for test to fail
      await expect(
        assetToken.approveAndCall(lockedAccount.address, neumarkToBurn, "", {
          from: investorAddress,
        }),
      ).to.be.rejectedWith("NF_ONLY_NEU");
    }

    async function calculateUnlockPenalty(ticket) {
      return ticket.mul(await lockedAccount.penaltyFraction()).div(etherToWei(1));
    }

    async function assertCorrectUnlock(tx, investorAddress, ticket, penalty) {
      const disbursalPool = await universe.feeDisbursal();
      expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.equal(0);
      expect(await assetToken.totalSupply()).to.be.bignumber.equal(ticket);
      // returns tuple as array
      const investorBalance = await lockedAccount.balanceOf(investorAddress);
      expect(investorBalance[2]).to.be.bignumber.eq(0); // checked by timestamp == 0
      expect(await lockedAccount.totalInvestors()).to.be.bignumber.eq(0);
      const balanceOfInvestorAndPool = (await assetToken.balanceOf(investorAddress)).add(
        await assetToken.balanceOf(disbursalPool),
      );
      expect(balanceOfInvestorAndPool).to.be.bignumber.equal(ticket);
      // check penalty value
      await expectPenaltyBalance(penalty);
      // 0 neumarks at the end
      expect(await neumark.balanceOf(investorAddress)).to.be.bignumber.equal(0);
    }

    function expectLogFundsRefunded(tx, investorAddress, commitment, ticket, releasedNeu) {
      const event = eventValue(tx, "LogFundsRefunded");
      expect(event).to.exist;
      expect(event.args.investor).to.equal(investorAddress);
      expect(event.args.commitment).to.equal(commitment);
      expect(event.args.amount).to.be.bignumber.eq(ticket);
      expect(event.args.neumarks).to.be.bignumber.eq(releasedNeu);
    }

    function expectLockLogFundsCommitted(tx, investorAddress, commitment, ticket, releasedNeu) {
      const event = eventValue(tx, "LogFundsCommitted");
      expect(event).to.exist;
      expect(event.args.investor).to.equal(investorAddress);
      expect(event.args.commitment).to.equal(commitment);
      expect(event.args.amount).to.be.bignumber.eq(ticket);
      expect(event.args.neumarks).to.be.bignumber.eq(releasedNeu);
    }

    function expectLogMigrationDestination(
      tx,
      logIdx,
      investorAddress,
      destinationAddress,
      amount,
    ) {
      const event = eventWithIdxValue(tx, logIdx, "LogMigrationDestination");
      expect(event).to.exist;
      expect(event.args.investor).to.equal(investorAddress);
      expect(event.args.destination).to.equal(destinationAddress);
      expect(event.args.amount).to.be.bignumber.equal(amount);
    }

    function expectLockEvent(tx, logIdx, investorAddress, ticket, neumarks) {
      const event = eventWithIdxValue(tx, logIdx, "LogFundsLocked");
      expect(event).to.exist;
      expect(event.args.investor).to.equal(investorAddress);
      expect(event.args.amount).to.be.bignumber.equal(ticket);
      expect(event.args.neumarks).to.be.bignumber.equal(neumarks);
    }

    function expectNeumarksBurnedEvent(tx, owner, euroUlps, neumarkUlps) {
      const event = eventValue(tx, "LogNeumarksBurned");
      expect(event).to.exist;
      expect(event.args.owner).to.equal(owner);
      expect(event.args.euroUlps).to.be.bignumber.equal(euroUlps);
      expect(event.args.neumarkUlps).to.be.bignumber.equal(neumarkUlps);
    }

    function expectUnlockEvent(tx, investorAddress, amount, neumarksBurned) {
      const event = eventValue(tx, "LogFundsUnlocked");
      expect(event).to.exist;
      expect(event.args.investor).to.equal(investorAddress);
      expect(event.args.amount).to.be.bignumber.equal(amount);
      expect(event.args.neumarks).to.be.bignumber.equal(neumarksBurned);
    }

    async function expectPenaltyEvent(tx, investorAddress, penalty) {
      const disbursalPool = await universe.feeDisbursal();
      const event = eventValue(tx, "LogPenaltyDisbursed");
      expect(event).to.exist;
      expect(event.args.disbursalPoolAddress).to.equal(disbursalPool);
      expect(event.args.amount).to.be.bignumber.equal(penalty);
      expect(event.args.paymentToken).to.equal(assetToken.address);
      expect(event.args.investor).to.equal(investorAddress);
    }

    async function expectPenaltyBalance(penalty) {
      const disbursalPool = await universe.feeDisbursal();
      const poolBalance = await assetToken.balanceOf.call(disbursalPool);
      expect(poolBalance).to.be.bignumber.eq(penalty);
    }

    function expectMigrationEnabledEvent(tx, target) {
      const event = eventValue(tx, "LogMigrationEnabled");
      expect(event).to.exist;
      expect(event.args.target).to.be.equal(target);
    }

    function expectInvestorMigratedEvent(tx, investorAddress, ticket, neumarks, unlockDate) {
      const event = eventValue(tx, "LogInvestorMigrated");
      expect(event).to.exist;
      expect(event.args.investor).to.be.equal(investorAddress);
      expect(event.args.amount).to.be.bignumber.equal(ticket);
      expect(event.args.neumarks).to.be.bignumber.equal(neumarks);
      // check unlockDate optionally
      if (unlockDate) {
        expect(event.args.unlockDate).to.be.bignumber.equal(unlockDate);
      }
    }

    function expectLogTestReceiveTransfer(tx, tokenAddress, snapshotTokenAddress, from, penalty) {
      const event = eventValue(tx, "LogTestReceiveTransfer");
      expect(event).to.exist;
      expect(event.args.paymentToken).to.be.equal(tokenAddress);
      expect(event.args.snapshotToken).to.be.equal(snapshotTokenAddress);
      expect(event.args.amount).to.be.bignumber.equal(penalty);
      expect(event.args.from).to.be.equal(from);
    }

    async function setPenaltyDisbursal(disbursalAddress) {
      // apply settings on token controller - again
      await universe.setSingleton(knownInterfaces.feeDisbursal, disbursalAddress, { from: admin });
      if (tokenController) {
        await tokenController.applySettings(Q18.mul(0), Q18.mul(0), Q18.mul(50), { from: admin });
      }
    }

    async function deployAuxiliaryContracts() {
      noCallbackContract = await TestNullContract.new();
      testDisbursal = await TestFeeDistributionPool.new();
      startTimestamp = await latestTimestamp();
    }
  },
);
