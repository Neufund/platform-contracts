import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import {
  basicTokenTests,
  standardTokenTests,
  erc677TokenTests,
  deployTestErc677Callback,
  deployTestErc223Callback,
  ZERO_ADDRESS,
  expectTransferEvent,
  testWithdrawal,
  erc223TokenTests,
} from "./helpers/tokenTestCases";
import { eventValue } from "./helpers/events";
import { etherToWei } from "./helpers/unitConverter";
import knownInterfaces from "./helpers/knownInterfaces";
import EvmError from "./helpers/EVMThrow";
import {
  deployUniverse,
  deployIdentityRegistry,
  toBytes32,
  deployEuroTokenUniverse,
} from "./helpers/deployContracts";

const EuroToken = artifacts.require("EuroToken");
const TestEuroTokenControllerPassThrough = artifacts.require("TestEuroTokenControllerPassThrough");
const RoleBasedAccessPolicy = artifacts.require("RoleBasedAccessPolicy");
const Q18 = web3.toBigNumber("10").pow(18);
const minDepositAmountEurUlps = Q18.mul(500);
const minWithdrawAmountEurUlps = Q18.mul(20);
const maxSimpleExchangeAllowanceEurUlps = Q18.mul(50);

contract(
  "EuroToken",
  ([_, masterManager, depositManager, eurtLegalManager, gasExchange, ...investors]) => {
    let accessControl;
    let euroToken;
    let universe;

    before(async () => {
      universe = await deployUniverse(masterManager, masterManager);
      accessControl = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
      await universe.setSingleton(knownInterfaces.gasExchange, gasExchange, {
        from: masterManager,
      });
    });

    describe("specific tests", () => {
      let tokenController;
      let identityRegistry;

      beforeEach(async () => {
        identityRegistry = await deployIdentityRegistry(universe, masterManager, masterManager);
        [euroToken, tokenController] = await deployEuroTokenUniverse(
          universe,
          masterManager,
          eurtLegalManager,
          depositManager,
          minDepositAmountEurUlps,
          minWithdrawAmountEurUlps,
          maxSimpleExchangeAllowanceEurUlps,
        );
      });

      function expectDepositEvent(tx, owner, amount) {
        const event = eventValue(tx, "LogDeposit");
        expect(event).to.exist;
        expect(event.args.to).to.eq(owner);
        expect(event.args.amount).to.be.bignumber.eq(amount);
      }

      it("should deploy", async () => {
        await prettyPrintGasCost("EuroToken deploy", euroToken);
        expect(await euroToken.tokenController()).to.be.eq(tokenController.address);
      });

      it("should deposit", async () => {
        const initialBalance = etherToWei(minDepositAmountEurUlps.add(1.19827398791827));
        // deposit only to KYC investors
        await identityRegistry.setClaims(investors[0], "0x0", toBytes32("0x1"), {
          from: masterManager,
        });
        const tx = await euroToken.deposit(investors[0], initialBalance, {
          from: depositManager,
        });
        expectDepositEvent(tx, investors[0], initialBalance);
        expectTransferEvent(tx, ZERO_ADDRESS, investors[0], initialBalance);
        const totalSupply = await euroToken.totalSupply.call();
        expect(totalSupply).to.be.bignumber.eq(initialBalance);
        const balance = await euroToken.balanceOf(investors[0]);
        expect(balance).to.be.bignumber.eq(initialBalance);
      });

      it("should overflow totalSupply on deposit", async () => {
        const initialBalance = new web3.BigNumber(2).pow(256).sub(1);
        // deposit only to KYC investors
        await identityRegistry.setClaims(investors[0], "0x0", toBytes32("0x1"), {
          from: masterManager,
        });
        await euroToken.deposit(investors[0], initialBalance, {
          from: depositManager,
        });
        await identityRegistry.setClaims(investors[1], "0x0", toBytes32("0x1"), {
          from: masterManager,
        });
        await expect(
          euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          }),
        ).to.be.rejectedWith(EvmError);
      });

      it("should reject deposit not from deposit manager", async () => {
        const initialBalance = etherToWei(820938);
        await tokenController.setAllowedTransferTo(investors[0], true, {
          from: eurtLegalManager,
        });
        await expect(
          euroToken.deposit(investors[0], initialBalance, { from: gasExchange }),
        ).to.be.rejectedWith(EvmError);
      });

      it("should reject deposit to address 0", async () => {
        const initialBalance = etherToWei(19821);
        await tokenController.setAllowedTransferTo(ZERO_ADDRESS, true, {
          from: eurtLegalManager,
        });
        await expect(
          euroToken.deposit(ZERO_ADDRESS, initialBalance, {
            from: depositManager,
          }),
        ).to.be.rejectedWith(EvmError);
      });

      async function transferViaGasExchange(from, to, amount, initialBalance) {
        const hasKyc = toBytes32("0x1");
        await identityRegistry.setMultipleClaims([from, to], ["0x0", "0x0"], [hasKyc, hasKyc], {
          from: masterManager,
        });
        await euroToken.deposit(from, initialBalance, {
          from: depositManager,
        });
        await euroToken.deposit(to, initialBalance, {
          from: depositManager,
        });
        await euroToken.approve(gasExchange, amount, { from });
        // no special permissions for investors needed, just the gasExchange
        await tokenController.setAllowedTransferFrom(gasExchange, true, {
          from: eurtLegalManager,
        });

        await euroToken.transferFrom(from, to, amount, { from: gasExchange });
      }

      it("should transfer between investors via gasExchange with minimum permissions", async () => {
        const initialBalance = etherToWei(83781221);
        await transferViaGasExchange(investors[0], investors[1], initialBalance, initialBalance);
        const afterBalance = await euroToken.balanceOf.call(investors[1]);
        expect(afterBalance).to.be.bignumber.eq(initialBalance.mul(2));
      });

      it("should transfer between investor and ETO", async () => {
        const initialBalance = etherToWei(183781221);
        // deposit only to KYC investors
        await identityRegistry.setClaims(investors[0], "0x0", toBytes32("0x1"), {
          from: masterManager,
        });
        await euroToken.deposit(investors[0], initialBalance, {
          from: depositManager,
        });
        // white list investor[1] address as ETO
        const etoAddress = investors[1];
        await universe.setCollectionInterface(
          knownInterfaces.commitmentInterface,
          etoAddress,
          true,
          { from: masterManager },
        );
        await euroToken.transfer(etoAddress, initialBalance, {
          from: investors[0],
        });
        const afterBalance = await euroToken.balanceOf.call(investors[1]);
        expect(afterBalance).to.be.bignumber.eq(initialBalance);
      });

      it("should not transfer from not allowed", async () => {
        await expect(
          euroToken.transfer(investors[1], 0, { from: investors[0] }),
        ).to.be.rejectedWith(EvmError);
      });

      it("should not decrease allowance for gasExchange when <= amount", async () => {
        await transferViaGasExchange(
          investors[0],
          investors[1],
          maxSimpleExchangeAllowanceEurUlps,
          minDepositAmountEurUlps,
        );
        expect(await euroToken.allowance(investors[0], gasExchange)).to.be.bignumber.eq(
          maxSimpleExchangeAllowanceEurUlps,
        );
      });

      it("should decrease allowance for gasExchange when > amount", async () => {
        await transferViaGasExchange(
          investors[0],
          investors[1],
          maxSimpleExchangeAllowanceEurUlps.add(1),
          minDepositAmountEurUlps,
        );
        expect(await euroToken.allowance(investors[0], gasExchange)).to.be.bignumber.eq(0);
      });

      it("should disallow deposit for non KYC or not explicit");
      it("should disallow withdraw for non KYC or not explicit");
      it("should change token controller"); // simulate changing to permit all Test controller
      it("should reject on change token controller from invalid account");
      it("should destroy tokens");
      it("should reject destroy not from legal rep");
      it("should reject destroy below balance");
    });

    describe("euro token controller emulating ICBM Euro Token", () => {
      let tokenController;

      beforeEach(async () => {
        [euroToken, tokenController] = await deployEuroTokenUniverse(
          universe,
          masterManager,
          eurtLegalManager,
          depositManager,
          0,
          0,
          0,
        );
      });

      describe("IBasicToken tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;

        beforeEach(async () => {
          await tokenController.setAllowedTransferFrom(investors[1], true, {
            from: eurtLegalManager,
          });
          await tokenController.setAllowedTransferTo(investors[1], true, {
            from: eurtLegalManager,
          });
          await tokenController.setAllowedTransferTo(investors[2], true, {
            from: eurtLegalManager,
          });
          await tokenController.setAllowedTransferTo(0x0, true, {
            from: eurtLegalManager,
          });
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        basicTokenTests(getToken, investors[1], investors[2], initialBalance);
      });

      describe("IERC20Allowance tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;

        beforeEach(async () => {
          await tokenController.setAllowedTransferTo(investors[1], true, {
            from: eurtLegalManager,
          });
          // receiving investor to receive
          await tokenController.setAllowedTransferTo(investors[2], true, {
            from: eurtLegalManager,
          });
          // gasExchange permission to send
          await tokenController.setAllowedTransferFrom(gasExchange, true, {
            from: eurtLegalManager,
          });
          await tokenController.setAllowedTransferTo(0x0, true, {
            from: eurtLegalManager,
          });
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        standardTokenTests(getToken, investors[1], investors[2], gasExchange, initialBalance);
      });

      describe("IERC677Token tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;
        let erc667cb;
        const getTestErc667cb = () => erc667cb;

        beforeEach(async () => {
          erc667cb = await deployTestErc677Callback();
          await tokenController.setAllowedTransferTo(investors[1], true, {
            from: eurtLegalManager,
          });
          // gasExchange (which is receiver) permission to send
          await tokenController.setAllowedTransferFrom(erc667cb.address, true, {
            from: eurtLegalManager,
          });
          // receiver permission to receive
          await tokenController.setAllowedTransferTo(erc667cb.address, true, {
            from: eurtLegalManager,
          });
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        erc677TokenTests(getToken, getTestErc667cb, investors[1], initialBalance);
      });

      describe("IERC223Token tests", () => {
        const initialBalance = etherToWei(3.98172);
        const getToken = () => euroToken;
        let erc223cb;
        const getTestErc223cb = () => erc223cb;

        beforeEach(async () => {
          erc223cb = await deployTestErc223Callback();
          await tokenController.setAllowedTransferTo(investors[1], true, {
            from: eurtLegalManager,
          });
          await tokenController.setAllowedTransferTo(investors[2], true, {
            from: eurtLegalManager,
          });
          // gasExchange (which is receiver) permission to send
          await tokenController.setAllowedTransferFrom(investors[1], true, {
            from: eurtLegalManager,
          });
          // receiver permission to receive
          await tokenController.setAllowedTransferTo(erc223cb.address, true, {
            from: eurtLegalManager,
          });
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        erc223TokenTests(getToken, getTestErc223cb, investors[1], investors[2], initialBalance);
      });

      describe("withdrawal tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;

        beforeEach(async () => {
          await tokenController.setAllowedTransferTo(investors[0], true, {
            from: eurtLegalManager,
          });
          await tokenController.setAllowedTransferFrom(investors[0], true, {
            from: eurtLegalManager,
          });
          await euroToken.deposit(investors[0], initialBalance, {
            from: depositManager,
          });
        });

        testWithdrawal(getToken, investors[0], initialBalance);
      });
    });

    describe("pass through controller", () => {
      beforeEach(async () => {
        const controller = await TestEuroTokenControllerPassThrough.new();
        euroToken = await EuroToken.new(accessControl.address, controller.address);
      });

      describe("IBasicToken tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;

        beforeEach(async () => {
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        basicTokenTests(getToken, investors[1], investors[2], initialBalance);
      });

      describe("IERC20Allowance tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;

        beforeEach(async () => {
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        standardTokenTests(getToken, investors[1], investors[2], gasExchange, initialBalance);
      });

      describe("IERC677Token tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;
        let erc667cb;
        const getTestErc667cb = () => erc667cb;

        beforeEach(async () => {
          erc667cb = await deployTestErc677Callback();
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        erc677TokenTests(getToken, getTestErc667cb, investors[1], initialBalance);
      });

      describe("IERC223Token tests", () => {
        const initialBalance = etherToWei(3.98172);
        const getToken = () => euroToken;
        let erc223cb;
        const getTestErc223cb = () => erc223cb;

        beforeEach(async () => {
          erc223cb = await deployTestErc223Callback();
          await euroToken.deposit(investors[1], initialBalance, {
            from: depositManager,
          });
        });

        erc223TokenTests(getToken, getTestErc223cb, investors[1], investors[2], initialBalance);
      });

      describe("withdrawal tests", () => {
        const initialBalance = etherToWei(1.19827398791827);
        const getToken = () => euroToken;

        beforeEach(async () => {
          await euroToken.deposit(investors[0], initialBalance, {
            from: depositManager,
          });
        });

        testWithdrawal(getToken, investors[0], initialBalance);
      });
    });
  },
);
