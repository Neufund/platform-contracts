import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import { deployAccessControl } from "./helpers/deployContracts";
import {
  basicTokenTests,
  standardTokenTests,
  erc677TokenTests,
  deployTestErc677Callback,
  erc223TokenTests,
  expectTransferEvent,
  ZERO_ADDRESS,
  testWithdrawal,
  deployTestErc223Callback,
} from "./helpers/tokenTestCases";
import { eventValue } from "./helpers/events";
import { etherToWei } from "./helpers/unitConverter";
import forceEther from "./helpers/forceEther";
import roles from "./helpers/roles";
import EvmError from "./helpers/EVMThrow";

const EtherToken = artifacts.require("EtherToken");

contract("EtherToken", ([broker, reclaimer, ...investors]) => {
  let etherToken;
  const RECLAIM_ETHER = "0x0";

  beforeEach(async () => {
    const rbap = await deployAccessControl([{ subject: reclaimer, role: roles.reclaimer }]);
    etherToken = await EtherToken.new(rbap.address);
  });

  describe("specific tests", () => {
    function expectDepositEvent(tx, owner, amount) {
      const event = eventValue(tx, "LogDeposit");
      expect(event).to.exist;
      expect(event.args.to).to.eq(owner);
      expect(event.args.amount).to.be.bignumber.eq(amount);
    }

    it("should deploy", async () => {
      await prettyPrintGasCost("EtherToken deploy", etherToken);
    });

    it("should deposit", async () => {
      const initialBalance = etherToWei(1.19827398791827);
      const tx = await etherToken.deposit({
        from: investors[0],
        value: initialBalance,
      });
      expectDepositEvent(tx, investors[0], initialBalance);
      expectTransferEvent(tx, ZERO_ADDRESS, investors[0], initialBalance);
      const totalSupply = await etherToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(initialBalance);
      const balance = await etherToken.balanceOf(investors[0]);
      expect(balance).to.be.bignumber.eq(initialBalance);
    });

    it("should reject to reclaim ether", async () => {
      const amount = web3.toWei(1, "ether");
      await forceEther(etherToken.address, amount, reclaimer);
      await expect(etherToken.reclaim(RECLAIM_ETHER, { from: reclaimer })).to.be.rejectedWith(
        EvmError,
      );
    });

    it("should deposit and transfer", async () => {
      const initialBalance = etherToWei(1.19827398791827);
      const amountToTranfser = etherToWei(0.543);
      const balanceAfterTransfer = initialBalance.minus(amountToTranfser);

      const tx = await etherToken.depositAndTransfer(investors[1], amountToTranfser, 0, {
        from: investors[0],
        value: initialBalance,
      });

      expectDepositEvent(tx, investors[0], initialBalance);
      expectTransferEvent(tx, investors[0], investors[1], amountToTranfser);

      const totalSupply = await etherToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(initialBalance);
      const senderBalance = await etherToken.balanceOf(investors[0]);
      expect(senderBalance).to.be.bignumber.eq(balanceAfterTransfer);

      const recivedBalance = await etherToken.balanceOf(investors[1]);
      expect(recivedBalance).to.be.bignumber.eq(amountToTranfser);
    });

    it("should deposit and transfer whole deposit", async () => {
      const initialBalance = etherToWei(1.19827398791827);
      const amountToTranfser = initialBalance;
      const balanceAfterTransfer = 0;

      const tx = await etherToken.depositAndTransfer(investors[1], amountToTranfser, 0, {
        from: investors[0],
        value: initialBalance,
      });

      expectDepositEvent(tx, investors[0], initialBalance);
      expectTransferEvent(tx, investors[0], investors[1], initialBalance);

      const totalSupply = await etherToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(initialBalance);
      const senderBalance = await etherToken.balanceOf(investors[0]);
      expect(senderBalance).to.be.bignumber.eq(balanceAfterTransfer);

      const recivedBalance = await etherToken.balanceOf(investors[1]);
      expect(recivedBalance).to.be.bignumber.eq(amountToTranfser);
    });

    it("should deposit 0 wei and transfer", async () => {
      const initialBalance = etherToWei(1.19827398791827);
      const initialDepositTx = await etherToken.deposit({
        from: investors[0],
        value: initialBalance,
      });
      expectDepositEvent(initialDepositTx, investors[0], initialBalance);

      const zeroWei = 0;
      const amountToTranfser = etherToWei(0.5432);
      const balanceAfterTransfer = initialBalance.minus(amountToTranfser);

      const tx = await etherToken.depositAndTransfer(investors[1], amountToTranfser, 0, {
        from: investors[0],
        value: zeroWei,
      });

      expectDepositEvent(tx, investors[0], zeroWei);
      expectTransferEvent(tx, investors[0], investors[1], amountToTranfser);

      const totalSupply = await etherToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(initialBalance);
      const senderBalance = await etherToken.balanceOf(investors[0]);
      expect(senderBalance).to.be.bignumber.eq(balanceAfterTransfer);

      const recivedBalance = await etherToken.balanceOf(investors[1]);
      expect(recivedBalance).to.be.bignumber.eq(amountToTranfser);
    });

    it("should deposit and transfer some funds if initial balance 0", async () => {
      const initialBalance = await etherToken.totalSupply.call();
      expect(initialBalance).to.be.bignumber.eq(0);

      const amountToDeposit = etherToWei(1.4568923);
      const amountToTranfser = etherToWei(1.0);
      const balanceAfterTransfer = amountToDeposit.minus(amountToTranfser);

      const tx = await etherToken.depositAndTransfer(investors[1], amountToTranfser, 0, {
        from: investors[0],
        value: amountToDeposit,
      });

      expectDepositEvent(tx, investors[0], amountToDeposit);
      expectTransferEvent(tx, investors[0], investors[1], amountToTranfser);

      const totalSupply = await etherToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(amountToDeposit);
      const balance = await etherToken.balanceOf(investors[0]);
      expect(balance).to.be.bignumber.eq(balanceAfterTransfer);

      const reciverBalance = await etherToken.balanceOf(investors[1]);
      expect(reciverBalance).to.be.bignumber.eq(amountToTranfser);
    });

    it("should deposit and transfer to itself", async () => {
      const initialBalance = etherToWei(1.19827398791827);
      const amountToTranfser = etherToWei(0.543);

      const tx = await etherToken.depositAndTransfer(investors[0], amountToTranfser, 0, {
        from: investors[0],
        value: initialBalance,
      });

      expectDepositEvent(tx, investors[0], initialBalance);
      expectTransferEvent(tx, investors[0], investors[0], amountToTranfser);

      const totalSupply = await etherToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(initialBalance);
      const balance = await etherToken.balanceOf(investors[0]);
      expect(balance).to.be.bignumber.eq(initialBalance);
    });

    it("should deposit and transfer to itself whole amount", async () => {
      const initialBalance = etherToWei(1.19827398791827);

      const tx = await etherToken.depositAndTransfer(investors[0], initialBalance, 0, {
        from: investors[0],
        value: initialBalance,
      });

      expectDepositEvent(tx, investors[0], initialBalance);
      expectTransferEvent(tx, investors[0], investors[0], initialBalance);

      const totalSupply = await etherToken.totalSupply.call();
      expect(totalSupply).to.be.bignumber.eq(initialBalance);
      const balance = await etherToken.balanceOf(investors[0]);
      expect(balance).to.be.bignumber.eq(initialBalance);
    });

    it("should reject to deposit and transfer more than balance", async () => {
      const initialBalance = etherToWei(1.882256125);
      const amountToTransferThatIsMoreThanBalcnce = initialBalance.plus(etherToWei(1));

      await expect(
        etherToken.depositAndTransfer(investors[1], amountToTransferThatIsMoreThanBalcnce, 0, {
          from: investors[0],
          value: initialBalance,
        }),
      ).to.be.rejectedWith(EvmError);
    });
  });

  describe("IBasicToken tests", () => {
    const initialBalance = etherToWei(1.19827398791827);
    const getToken = () => etherToken;

    beforeEach(async () => {
      await etherToken.deposit({
        from: investors[1],
        value: initialBalance,
      });
    });

    basicTokenTests(getToken, investors[1], investors[2], initialBalance);
  });

  describe("IERC20Allowance tests", () => {
    const initialBalance = etherToWei(1.0192);
    const getToken = () => etherToken;

    beforeEach(async () => {
      await etherToken.deposit({
        from: investors[1],
        value: initialBalance,
      });
    });

    standardTokenTests(getToken, investors[1], investors[2], broker, initialBalance);
  });

  describe("IERC677Token tests", () => {
    const initialBalance = etherToWei(8.91192);
    const getToken = () => etherToken;
    let erc667cb;
    const getTestErc667cb = () => erc667cb;

    beforeEach(async () => {
      await etherToken.deposit({
        from: investors[1],
        value: initialBalance,
      });
      erc667cb = await deployTestErc677Callback();
    });

    erc677TokenTests(getToken, getTestErc667cb, investors[1], initialBalance);
  });

  describe("IERC223Token tests", () => {
    const initialBalance = etherToWei(3.98172);
    const getToken = () => etherToken;
    let erc223cb;
    const getTestErc223cb = () => erc223cb;

    beforeEach(async () => {
      erc223cb = await deployTestErc223Callback(true);
      await etherToken.deposit({
        from: investors[1],
        value: initialBalance,
      });
    });

    erc223TokenTests(getToken, getTestErc223cb, investors[1], investors[2], initialBalance);
  });

  describe("withdrawal tests", () => {
    const initialBalance = etherToWei(7.189192);
    const getToken = () => etherToken;

    beforeEach(async () => {
      await etherToken.deposit({
        from: investors[0],
        value: initialBalance,
      });
    });

    testWithdrawal(getToken, investors[0], initialBalance);

    it("should withdraw and send");
    it("should withdraw and send with 0 wei payable");
    it("should withdraw and send with 0 initial balance");
    it("should reject withdraw and send over balance");
    it("should reject when withdraw amount less than payable");
  });
});
