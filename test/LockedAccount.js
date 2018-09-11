import { expect } from "chai";
import moment from "moment";
import { hasEvent, eventValue, decodeLogs } from "./helpers/events";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployNeumarkUniverse,
  deployEtherTokenUniverse,
  deployEuroTokenUniverse,
  deployEtherTokenMigration,
  deployEuroTokenMigration,
} from "./helpers/deployContracts";
import increaseTime, { setTimeTo } from "./helpers/increaseTime";
import { latestTimestamp } from "./helpers/latestTime";
import EvmError from "./helpers/EVMThrow";
import { TriState } from "./helpers/triState";
import forceEther from "./helpers/forceEther";
import { etherToWei, divRound } from "./helpers/unitConverter";
import roles from "./helpers/roles";
import { promisify } from "./helpers/evmCommands";
import { contractId, dayInSeconds, monthInSeconds, Q18, toBytes32 } from "./helpers/constants";
import { knownInterfaces } from "./helpers/knownInterfaces";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { expectLogFundsCommitted } from "./helpers/commitment";

const TestFeeDistributionPool = artifacts.require("TestFeeDistributionPool");
const TestNullContract = artifacts.require("TestNullContract");
const NullCommitment = artifacts.require("NullCommitment");

const gasPrice = new web3.BigNumber(0x01); // this low gas price is forced by code coverage
const LOCK_PERIOD = 18 * monthInSeconds;
const UNLOCK_PENALTY_FRACTION = Q18.mul(0.1).round(0, 0);
const equityTokenAddress = "0x07a689aa85943bee87b65eb83726d7f6ec8acf01";

contract("LockedAccount", ([_, admin, investor, investor2, operatorWallet]) => {
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

  // test cases and helper methods

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
    });

    it("should invest balance");

    it("reverts on invest over balance");

    it("reverts on overflow 2**112");

    it("reverts on investing 0 wei");

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
      ).to.be.rejectedWith("LOCKED_ONLY_COMMITMENT");
    });

    it("should invest balance in tranches");

    it("should invest 1 wei in final tranche");

    it("should invest in multiple commitments");

    it("should get refund", async () => {
      const balance = Q18.mul(1571.1812);
      const neumarks = await lock(investor, balance, makeDeposit);
      const ticket = balance.sub(Q18.mul(671.2891));
      const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
      const commitment = await lockedAccount.pendingCommitments(commitment1.address, investor);
      expect(commitment[0]).to.be.bignumber.eq(ticket);
      expect(commitment[1]).to.be.bignumber.eq(releasedNeu);
      const tx = await commitment1.refund(lockedAccount.address, { from: investor });
      const logs = decodeLogs(tx, lockedAccount.address, lockedAccount.abi);
      tx.logs.push(...logs);
      expectLogFundsRefunded(tx, investor, commitment1.address, ticket, releasedNeu);
      // all the money are back in the icbm wallet
      const icbmBalance = await lockedAccount.balanceOf(investor);
      expect(icbmBalance[0]).to.be.bignumber.eq(balance);
      expect(icbmBalance[1]).to.be.bignumber.eq(neumarks);
    });

    it("should get refund from multiple tranches", async () => {
      const balance = Q18.mul(1571.1812);
      const neumarks = await lock(investor, balance, makeDeposit);
      const ticket = balance.sub(Q18.mul(671.2891));
      const releasedNeu = await commitFunds(investor, ticket, balance, neumarks);
      const ticket2 = Q18.mul(32.182112);
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

    // check unknown commitment contract, investor and when there was no preceding investment
    it("should ignore refunds if not invested before");

    it("should ignore duplicate refunds");

    // LOCKED_ACCOUNT_LIQUIDATED
    it("reverts on refund if account unlocked");

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

    it("should refund from commitment1 and claim from  commitment 2");

    it("should silently ignore unexpected claims");
  }

  function lockedAccountMigrationTestCases(makeDeposit) {
    async function migrateOne(ticket, investorAddress, destinationAddress) {
      const neumarks = ticket.mul(6.5);
      // lock investor
      await makeDeposit(investorAddress, controller.address, ticket);
      await controller.investToken(neumarks, { from: investorAddress });
      await controller.succ();
      const investorBalanceBefore = await icbmLockedAccount.balanceOf.call(investorAddress);
      const assetBalanceSourceBefore = await icbmAssetToken.balanceOf.call(
        icbmLockedAccount.address,
      );
      // migration source set in the constructor of lockedAccount
      expect(await lockedAccount.currentMigrationSource()).to.eq(icbmLockedAccount.address);
      let tx = await icbmLockedAccount.enableMigration(lockedAccount.address, {
        from: admin,
      });
      expectMigrationEnabledEvent(tx, lockedAccount.address);
      expect(await icbmLockedAccount.currentMigrationTarget()).to.be.eq(lockedAccount.address);
      // migrate investor
      tx = await icbmLockedAccount.migrate({ from: investorAddress });
      expectInvestorMigratedEvent(tx, investorAddress, ticket, neumarks, investorBalanceBefore[2]);
      // expect funds locked for destination wallet
      expectLockEvent(tx, destinationAddress, ticket, neumarks);
      // check invariants
      expect(await icbmLockedAccount.totalLockedAmount()).to.be.bignumber.equal(0);
      expect(await lockedAccount.totalLockedAmount()).to.be.bignumber.equal(ticket);
      expect(await icbmLockedAccount.totalInvestors()).to.be.bignumber.equal(0);
      expect(await lockedAccount.totalInvestors()).to.be.bignumber.equal(1);
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
      expect(assetBalanceTargetAfter).to.be.bignumber.eq(ticket);
      // check balance in new locked account
      const investorBalanceTargetAfter = await lockedAccount.balanceOf(destinationAddress);
      expect(investorBalanceTargetAfter[0]).to.be.bignumber.eq(ticket);
      expect(investorBalanceTargetAfter[1]).to.be.bignumber.eq(neumarks);
      expect(investorBalanceTargetAfter[2]).to.be.bignumber.eq(investorBalanceBefore[2]);
    }

    it("reverts on call migrateInvestor not from source", async () => {
      await expect(
        lockedAccount.migrateInvestor(investor, Q18.mul(1), Q18.mul(1), startTimestamp, {
          from: admin,
        }),
      ).to.be.rejectedWith("INV_SOURCE");
    });

    it("should migrate investor", async () => {
      await migrateOne(etherToWei(1), investor, investor);
    });

    it("migrate same investor twice should do nothing", async () => {
      await migrateOne(etherToWei(1), investor, investor);
      const tx = await icbmLockedAccount.migrate({ from: investor });
      expect(hasEvent(tx, "LogInvestorMigrated")).to.be.false;
    });

    it("migrate non existing investor should do nothing", async () => {
      await migrateOne(etherToWei(1), investor, investor);
      const tx = await icbmLockedAccount.migrate({ from: investor2 });
      expect(hasEvent(tx, "LogInvestorMigrated")).to.be.false;
    });

    it("should migrate two");

    it("should migrate to different destination address", async () => {
      // destination wallet must be verified
      await setClaims(investor2);
      const tx = await lockedAccount.setInvestorMigrationWallet(investor2, { from: investor });
      expectLogMigrationDestination(tx, investor, investor2, 0);
      await migrateOne(Q18.mul(37.172121), investor, investor2);
    });

    it("reverts on migration to not verified destination address", async () => {
      await expect(
        lockedAccount.setInvestorMigrationWallet(investor2, { from: investor }),
      ).to.be.rejectedWith("DEST_VERIFICATION");
    });

    it("reverts on migration to already existing destination address");

    it("should not squat existing investor", async () => {});

    it("should overwrite destination address");

    it("should merge two migrations via destination address");

    it("should split into many separate destinations");

    it("should split and merge into many separate destinations");

    it("should split and merge into many separate destinations with duplicate destination");
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
      expectLogTestReceiveTransfer(unlockTx, assetToken.address, lockedAccount.address, penalty);
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

    /*
    function getKeyByValue(object, value) {
      return Object.keys(object).find(key => object[key] === value);
    }

    describe("should reject on invalid state", () => {
        const PublicFunctionsRejectInState = {
          lock: [LockState.Uncontrolled, LockState.AcceptingUnlocks, LockState.ReleaseAll],
          unlock: [LockState.Uncontrolled, LockState.AcceptingLocks],
          receiveApproval: [LockState.Uncontrolled, LockState.AcceptingLocks],
          controllerFailed: [
            LockState.Uncontrolled,
            LockState.AcceptingUnlocks,
            LockState.ReleaseAll,
          ],
          controllerSucceeded: [
            LockState.Uncontrolled,
            LockState.AcceptingUnlocks,
            LockState.ReleaseAll,
          ],
          enableMigration: [LockState.Uncontrolled],
          setController: [LockState.Uncontrolled, LockState.AcceptingUnlocks, LockState.ReleaseAll],
          setPenaltyDisbursal: [],
          reclaim: [],
        };

        Object.keys(PublicFunctionsRejectInState).forEach(name => {
          PublicFunctionsRejectInState[name].forEach(state => {
            it(`when ${name} in ${getKeyByValue(LockState, state)}`);
          });
        });
      });

      describe("should reject on non admin access to", () => {
        const PublicFunctionsAdminOnly = [
          "enableMigration",
          "setController",
          "setPenaltyDisbursal",
        ];
        PublicFunctionsAdminOnly.forEach(name => {
          it(`${name}`, async () => {
            let pendingTx;
            migrationTarget = await deployMigrationTarget(assetToken, operatorWallet);
            switch (name) {
              case "enableMigration":
                await migrationTarget.setMigrationSource(lockedAccount.address, {
                  from: admin,
                });
                pendingTx = lockedAccount.enableMigration(migrationTarget.address, {
                  from: investor,
                });
                break;
              case "setController":
                pendingTx = lockedAccount.setController(admin, {
                  from: investor,
                });
                break;
              case "setPenaltyDisbursal":
                pendingTx = lockedAccount.setPenaltyDisbursal(testDisbursal.address, {
                  from: investor,
                });
                break;
              default:
                throw new Error(`${name} is unknown method`);
            }
            await expect(pendingTx).to.be.rejectedWith(EvmError);
          });
        });
      });

      describe("should reject access from not a controller to", () => {
        const PublicFunctionsControllerOnly = ["lock", "controllerFailed", "controllerSucceeded"];
        PublicFunctionsControllerOnly.forEach(name => {
          it(`${name}`, async () => {
            let pendingTx;
            await deployLockedAccount(
              assetToken,
              operatorWallet,
              LOCK_PERIOD,
              UNLOCK_PENALTY_FRACTION,
              { leaveUnlocked: true },
            );
            switch (name) {
              case "lock":
                pendingTx = lock(investor, Q18);
                break;
              case "controllerFailed":
                await lockedAccount.setController(admin, { from: admin });
                pendingTx = lockedAccount.controllerFailed({ from: investor });
                break;
              case "controllerSucceeded":
                await lockedAccount.setController(admin, { from: admin });
                pendingTx = lockedAccount.controllerSucceeded({
                  from: investor,
                });
                break;
              default:
                throw new Error(`${name} is unknown method`);
            }
            await expect(pendingTx).to.be.rejectedWith(EvmError);
          });
        });
      });
    */
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
    expectLockEvent(tx, investorAddress, ticket, neumarks);
    // timestamp of block _investFor was mined
    const txBlock = await promisify(web3.eth.getBlock)(tx.receipt.blockNumber);
    const timebase = txBlock.timestamp;
    // migrate to new lock
    await icbmLockedAccount.migrate({ from: investorAddress });
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
    await identityRegistry.setClaims(investorAddress, toBytes32("0x0"), toBytes32(claims), {
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
    ).to.be.rejectedWith("ONLY_NEU");
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

  function expectLogMigrationDestination(tx, investorAddress, destinationAddress, amount) {
    const event = eventValue(tx, "LogMigrationDestination");
    expect(event).to.exist;
    expect(event.args.investor).to.equal(investorAddress);
    expect(event.args.destination).to.equal(destinationAddress);
    expect(event.args.amount).to.be.bignumber.equal(amount);
  }

  function expectLockEvent(tx, investorAddress, ticket, neumarks) {
    const event = eventValue(tx, "LogFundsLocked");
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

  function expectLogTestReceiveTransfer(tx, tokenAddress, from, penalty) {
    const event = eventValue(tx, "LogTestReceiveTransfer");
    expect(event).to.exist;
    expect(event.args.token).to.be.equal(tokenAddress);
    expect(event.args.from).to.be.equal(from);
    expect(event.args.amount).to.be.bignumber.equal(penalty);
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
});
