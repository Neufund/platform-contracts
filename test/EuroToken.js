import { expect } from "chai";
import { prettyPrintGasCost } from "./helpers/gasUtils";
import {
  basicTokenTests,
  standardTokenTests,
  erc677TokenTests,
  deployTestErc677Callback,
  deployTestErc223Callback,
  expectTransferEvent,
  expectTransferEventAtIndex,
  testWithdrawal,
  erc223TokenTests,
} from "./helpers/tokenTestCases";
import { eventValue, eventValueAtIndex } from "./helpers/events";
import { etherToWei } from "./helpers/unitConverter";
import { knownInterfaces } from "./helpers/knownInterfaces";
import EvmError from "./helpers/EVMThrow";
import {
  deployUniverse,
  deployIdentityRegistry,
  deployEuroTokenUniverse,
} from "./helpers/deployContracts";
import { identityClaims } from "./helpers/identityClaims";
import { ZERO_ADDRESS, toBytes32, Q18 } from "./helpers/constants";

const EuroToken = artifacts.require("EuroToken");
const TestEuroTokenControllerPassThrough = artifacts.require("TestEuroTokenControllerPassThrough");

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
      [universe, accessControl] = await deployUniverse(masterManager, masterManager);
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

      function expectDepositEventAtIndex(tx, index, owner, amount) {
        const event = eventValueAtIndex(tx, index, "LogDeposit");
        expect(event).to.exist;
        expect(event.args.to).to.eq(owner);
        expect(event.args.amount).to.be.bignumber.eq(amount);
      }

      function expectDestroyEvent(tx, owner, by, amount) {
        const event = eventValue(tx, "LogDestroy");
        expect(event).to.exist;
        expect(event.args.from).to.eq(owner);
        expect(event.args.by).to.eq(by);
        expect(event.args.amount).to.be.bignumber.eq(amount);
      }

      it("should deploy", async () => {
        await prettyPrintGasCost("EuroToken deploy", euroToken);
        expect(await euroToken.tokenController()).to.be.eq(tokenController.address);
      });

      it("should deposit", async () => {
        const initialBalance = minDepositAmountEurUlps.add(119827398791827);
        // deposit only to KYC investors
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );
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

      it("should reject too low deposit", async () => {
        const initialBalance = minDepositAmountEurUlps.minus(1);

        // deposit only to KYC investors
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );

        await expect(
          euroToken.deposit(investors[0], initialBalance, {
            from: depositManager,
          }),
        ).to.revert;
      });

      it("should deposit many", async () => {
        const initialBalance1 = minDepositAmountEurUlps.add(1);
        const initialBalance2 = minDepositAmountEurUlps.add(2);
        const initialBalance3 = minDepositAmountEurUlps.add(3);
        const total = minDepositAmountEurUlps.mul(3).add(6);
        await identityRegistry.setMultipleClaims(
          investors.slice(0, 3),
          [
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
          ],
          [
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
          ],
          {
            from: masterManager,
          },
        );
        const tx = await euroToken.depositMany(
          investors.slice(0, 3),
          [initialBalance1, initialBalance2, initialBalance3],
          {
            from: depositManager,
          },
        );
        expectDepositEventAtIndex(tx, 0, investors[0], initialBalance1);
        expectDepositEventAtIndex(tx, 1, investors[1], initialBalance2);
        expectDepositEventAtIndex(tx, 2, investors[2], initialBalance3);
        expectTransferEventAtIndex(tx, 0, ZERO_ADDRESS, investors[0], initialBalance1);
        expectTransferEventAtIndex(tx, 1, ZERO_ADDRESS, investors[1], initialBalance2);
        expectTransferEventAtIndex(tx, 2, ZERO_ADDRESS, investors[2], initialBalance3);

        const totalSupply = await euroToken.totalSupply.call();
        expect(totalSupply).to.be.bignumber.eq(total);

        let balance = await euroToken.balanceOf(investors[0]);
        expect(balance).to.be.bignumber.eq(initialBalance1);
        balance = await euroToken.balanceOf(investors[1]);
        expect(balance).to.be.bignumber.eq(initialBalance2);
        balance = await euroToken.balanceOf(investors[2]);
        expect(balance).to.be.bignumber.eq(initialBalance3);
      });

      it("should fail deposit many if one investor has no kyc", async () => {
        const initialBalance1 = minDepositAmountEurUlps.add(1);
        const initialBalance2 = minDepositAmountEurUlps.add(2);
        const initialBalance3 = minDepositAmountEurUlps.add(3);
        await identityRegistry.setMultipleClaims(
          investors.slice(0, 3),
          [
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
          ],
          [
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
          ],
          {
            from: masterManager,
          },
        );
        await expect(
          euroToken.depositMany(
            investors.slice(0, 3),
            [initialBalance1, initialBalance2, initialBalance3],
            {
              from: depositManager,
            },
          ),
        ).to.revert;
      });

      it("should fail deposit many if array lengths don't match", async () => {
        const initialBalance1 = minDepositAmountEurUlps.add(1);
        const initialBalance2 = minDepositAmountEurUlps.add(2);
        const initialBalance3 = minDepositAmountEurUlps.add(3);
        await identityRegistry.setMultipleClaims(
          investors.slice(0, 3),
          [
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
          ],
          [
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
          ],
          {
            from: masterManager,
          },
        );
        await expect(
          euroToken.depositMany(
            investors.slice(0, 2),
            [initialBalance1, initialBalance2, initialBalance3],
            {
              from: depositManager,
            },
          ),
        ).to.revert;
      });

      it("should fail deposit many if sender is not manager", async () => {
        const initialBalance1 = minDepositAmountEurUlps.add(1);
        const initialBalance2 = minDepositAmountEurUlps.add(2);
        const initialBalance3 = minDepositAmountEurUlps.add(3);
        await identityRegistry.setMultipleClaims(
          investors.slice(0, 3),
          [
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
          ],
          [
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
          ],
          {
            from: masterManager,
          },
        );
        await expect(
          euroToken.depositMany(
            investors.slice(0, 3),
            [initialBalance1, initialBalance2, initialBalance3],
            {
              from: gasExchange,
            },
          ),
        ).to.revert;
      });

      it("should fail deposit many if one amount is too low", async () => {
        const initialBalance1 = minDepositAmountEurUlps.sub(2);
        const initialBalance2 = minDepositAmountEurUlps.add(2);
        const initialBalance3 = minDepositAmountEurUlps.add(3);
        await identityRegistry.setMultipleClaims(
          investors.slice(0, 3),
          [
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
            toBytes32(identityClaims.isNone),
          ],
          [
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
            toBytes32(identityClaims.isVerified),
          ],
          {
            from: masterManager,
          },
        );
        await expect(
          euroToken.depositMany(
            investors.slice(0, 3),
            [initialBalance1, initialBalance2, initialBalance3],
            {
              from: depositManager,
            },
          ),
        ).to.revert;
      });

      it("should overflow totalSupply on deposit", async () => {
        const initialBalance = new web3.BigNumber(2).pow(256).sub(1);
        // deposit only to KYC investors
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );
        await euroToken.deposit(investors[0], initialBalance, {
          from: depositManager,
        });
        await identityRegistry.setClaims(
          investors[1],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );
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

      async function prepTransferViaGasExchange(from, to, amount, initialBalance) {
        const isVerified = toBytes32(identityClaims.isVerified);
        await identityRegistry.setMultipleClaims(
          [from, to],
          ["0x0", "0x0"],
          [isVerified, isVerified],
          {
            from: masterManager,
          },
        );
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
      }

      it("should transfer between investors via gasExchange with minimum permissions", async () => {
        const initialBalance = etherToWei(83781221);
        await prepTransferViaGasExchange(
          investors[0],
          investors[1],
          initialBalance,
          initialBalance,
        );
        await euroToken.transferFrom(investors[0], investors[1], initialBalance, {
          from: gasExchange,
        });
        const afterBalance = await euroToken.balanceOf.call(investors[1]);
        expect(afterBalance).to.be.bignumber.eq(initialBalance.mul(2));
      });

      it("should reject transfer by gas exchange if account frozen", async () => {
        const initialBalance = etherToWei(83781221);
        await prepTransferViaGasExchange(
          investors[0],
          investors[1],
          initialBalance,
          initialBalance,
        );
        // freeze account (comment this line for the test to fail)
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isVerified),
          toBytes32(identityClaims.isVerified | identityClaims.isAccountFrozen),
          {
            from: masterManager,
          },
        );
        await expect(
          euroToken.transferFrom(investors[0], investors[1], initialBalance, { from: gasExchange }),
        ).to.be.rejectedWith(EvmError);
      });

      it("should reject transfer by broker if broker is not explicit from", async () => {
        const initialBalance = etherToWei(83781221);
        await prepTransferViaGasExchange(
          investors[0],
          investors[1],
          initialBalance,
          initialBalance,
        );
        // comment this line for test to fails
        await tokenController.setAllowedTransferFrom(gasExchange, false, {
          from: eurtLegalManager,
        });
        await expect(
          euroToken.transferFrom(investors[0], investors[1], initialBalance, { from: gasExchange }),
        ).to.be.rejectedWith(EvmError);
      });

      async function prepareETOTransfer(investor, etoAddress, initialBalance) {
        // deposit only to KYC investors
        await identityRegistry.setClaims(
          investor,
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );
        await euroToken.deposit(investor, initialBalance, {
          from: depositManager,
        });

        await universe.setCollectionInterface(
          knownInterfaces.commitmentInterface,
          etoAddress,
          true,
          { from: masterManager },
        );
      }

      it("should transfer between investor and ETO", async () => {
        const initialBalance = etherToWei(183781221);
        // white list investor[1] address as ETO
        const etoAddress = investors[1];
        await prepareETOTransfer(investors[0], etoAddress, initialBalance);
        await euroToken.transfer(etoAddress, initialBalance, {
          from: investors[0],
        });
        const afterBalance = await euroToken.balanceOf.call(investors[1]);
        expect(afterBalance).to.be.bignumber.eq(initialBalance);
      });

      it("should reject transfer between investor and ETO if account frozen", async () => {
        const initialBalance = etherToWei(183781221);
        // white list investor[1] address as ETO
        const etoAddress = investors[1];
        await prepareETOTransfer(investors[0], etoAddress, initialBalance);
        // freeze account (comment this line for the test to fail)
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isVerified),
          toBytes32(identityClaims.isVerified | identityClaims.isAccountFrozen),
          {
            from: masterManager,
          },
        );
        await expect(
          euroToken.transfer(etoAddress, initialBalance, {
            from: investors[0],
          }),
        ).to.be.rejectedWith(EvmError);
      });

      it("should not transfer from not allowed", async () => {
        await expect(
          euroToken.transfer(investors[1], 0, { from: investors[0] }),
        ).to.be.rejectedWith(EvmError);
      });

      it("should not decrease allowance for gasExchange when <= amount", async () => {
        const exchangeAmount = maxSimpleExchangeAllowanceEurUlps;
        await prepTransferViaGasExchange(
          investors[0],
          investors[1],
          exchangeAmount,
          minDepositAmountEurUlps,
        );
        await euroToken.transferFrom(investors[0], investors[1], exchangeAmount, {
          from: gasExchange,
        });
        expect(await euroToken.allowance(investors[0], gasExchange)).to.be.bignumber.eq(
          exchangeAmount,
        );
      });

      it("should decrease allowance for gasExchange when > amount", async () => {
        const exchangeAmount = maxSimpleExchangeAllowanceEurUlps.add(1);
        await prepTransferViaGasExchange(
          investors[0],
          investors[1],
          exchangeAmount,
          minDepositAmountEurUlps,
        );
        await euroToken.transferFrom(investors[0], investors[1], exchangeAmount, {
          from: gasExchange,
        });
        expect(await euroToken.allowance(investors[0], gasExchange)).to.be.bignumber.eq(0);
      });

      it("should disallow deposit for non KYC or not explicit", async () => {
        const balance = etherToWei(minDepositAmountEurUlps.add(1.19827398791827));

        // set some claim which is -not verified-
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.hasBankAccount),
          {
            from: masterManager,
          },
        );

        // deposit should faile here
        await expect(
          euroToken.deposit(investors[0], balance, {
            from: depositManager,
          }),
        ).to.revert;
      });

      it("should disallow withdraw for non KYC, non bank account or with forzen account or not explicit", async () => {
        const balance = etherToWei(minDepositAmountEurUlps);

        // make verified
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );

        // deposit should work
        await euroToken.deposit(investors[0], balance, {
          from: depositManager,
        });

        // also add bank account
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isVerified),
          toBytes32(identityClaims.isVerified | identityClaims.hasBankAccount),
          {
            from: masterManager,
          },
        );
        // withdraw should work now
        await euroToken.withdraw(etherToWei(minWithdrawAmountEurUlps), {
          from: investors[0],
        });

        // without verification no withdrawal
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isVerified | identityClaims.hasBankAccount),
          toBytes32(identityClaims.hasBankAccount),
          {
            from: masterManager,
          },
        );

        // now withdrawal will fail
        await expect(
          euroToken.withdraw(etherToWei(minWithdrawAmountEurUlps), {
            from: investors[0],
          }),
        ).to.revert;

        // without bank account no withdrawal
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.hasBankAccount),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );

        // now withdrawal will fail
        await expect(
          euroToken.withdraw(etherToWei(minWithdrawAmountEurUlps), {
            from: investors[0],
          }),
        ).to.revert;

        // without bank account no withdrawal
        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isVerified),
          toBytes32(
            identityClaims.isVerified |
              identityClaims.hasBankAccount |
              identityClaims.isAccountFrozen,
          ),
          {
            from: masterManager,
          },
        );

        // now withdrawal will fail
        await expect(
          euroToken.withdraw(etherToWei(minWithdrawAmountEurUlps), {
            from: investors[0],
          }),
        ).to.revert;
      });

      it("should change token controller", async () => {
        const balance = etherToWei(minDepositAmountEurUlps.add(1.19827398791827));

        // deposit to first investor should not work, she is not verifed
        await expect(
          euroToken.deposit(investors[0], balance, {
            from: depositManager,
          }),
        ).to.revert;

        // switch controller
        const controller = await TestEuroTokenControllerPassThrough.new();
        await euroToken.changeTokenController(controller.address, {
          from: eurtLegalManager,
        });

        // verify that the new controller works by making a deposit just like that
        await euroToken.deposit(investors[0], balance, {
          from: depositManager,
        });
        const fetchedBalance = await euroToken.balanceOf(investors[0]);
        expect(fetchedBalance).to.be.bignumber.eq(balance);
      });

      it("should reject on change token controller from invalid account", async () => {
        // switch controller
        const controller = await TestEuroTokenControllerPassThrough.new();
        await expect(
          euroToken.changeTokenController(controller.address, {
            from: investors[0],
          }),
        ).to.revert;
      });

      it("should destroy tokens", async () => {
        const initialBalance = etherToWei(minDepositAmountEurUlps.add(1.19827398791827));
        const destroyAmount = etherToWei(minDepositAmountEurUlps.add(0.19827398791827));
        const expectedFinalBalance = etherToWei(1);

        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );

        // deposit here
        await euroToken.deposit(investors[0], initialBalance, {
          from: depositManager,
        });
        const balance = await euroToken.balanceOf(investors[0]);
        expect(balance).to.be.bignumber.eq(initialBalance);

        const tx = await euroToken.destroy(investors[0], destroyAmount, {
          from: eurtLegalManager,
        });

        // check events
        expectTransferEvent(tx, investors[0], ZERO_ADDRESS, destroyAmount);
        expectDestroyEvent(tx, investors[0], eurtLegalManager, destroyAmount);

        const finalBalance = await euroToken.balanceOf(investors[0]);
        expect(finalBalance).to.be.bignumber.eq(expectedFinalBalance);
      });

      it("should reject destroy not from legal rep", async () => {
        const balance = etherToWei(minDepositAmountEurUlps.add(1.19827398791827));

        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );

        // deposit here
        await euroToken.deposit(investors[0], balance, {
          from: depositManager,
        });

        // investor 2 may not destroy any tokens!
        await expect(
          euroToken.destroy(investors[0], balance, {
            from: investors[1],
          }),
        ).to.revert;
      });

      it("should reject destroy below balance", async () => {
        const initialBalance = etherToWei(minDepositAmountEurUlps.add(1));
        const largerThanInitialBalance = etherToWei(minDepositAmountEurUlps.add(10));

        await identityRegistry.setClaims(
          investors[0],
          toBytes32(identityClaims.isNone),
          toBytes32(identityClaims.isVerified),
          {
            from: masterManager,
          },
        );

        // deposit here
        await euroToken.deposit(investors[0], initialBalance, {
          from: depositManager,
        });

        // destroying more should not work
        await expect(
          euroToken.destroy(investors[0], largerThanInitialBalance, {
            from: eurtLegalManager,
          }),
        ).to.revert;
      });
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
