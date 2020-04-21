import { expect } from "chai";
import EvmError from "./EVMThrow";

const TestTokenControllerPassThrough = artifacts.require("TestTokenControllerPassThrough");

export function testChangeTokenController(token, controller, admin, anyone) {
  it("should change token controller when change enabled", async () => {
    const newController = await TestTokenControllerPassThrough.new();
    await controller().setAllowChangeTokenController(true);

    await token().changeTokenController(newController.address, { from: admin });

    expect(await token().tokenController()).to.eq(newController.address);
  });

  it("rejects change token controller when change disabled", async () => {
    const newController = await TestTokenControllerPassThrough.new();
    await controller().setAllowChangeTokenController(false);

    await expect(token().changeTokenController(newController.address, { from: admin })).to.revert;
  });

  it("should allow granular change controller permissions", async () => {
    const newController = await TestTokenControllerPassThrough.new();
    await controller().setAllowChangeTokenController(false);
    // enable newController to be changed to
    await controller().setAllowedAddress(newController.address, 1);
    await expect(token().changeTokenController(admin, { from: admin })).to.revert;
    await token().changeTokenController(newController.address, { from: admin });

    // set back to old controller
    await token().changeTokenController(controller().address, { from: admin });

    // enable admin to be able to change controller
    await controller().setAllowedAddress(newController.address, 0);
    await controller().setAllowedAddress(admin, 1);
    await expect(token().changeTokenController(newController.address, { from: anyone })).to.revert;
    await token().changeTokenController(newController.address, { from: admin });
  });
}

export function testTokenController(
  token,
  controller,
  holder1,
  holder2,
  broker,
  generate,
  destroy,
) {
  it("should transfer when transfers enabled", async () => {
    await generate(1000, holder1);
    await controller().setAllowOnTransfer(true);
    await token().transfer(holder2, 10, { from: holder1 });

    expect(await token().balanceOf(holder2)).to.be.bignumber.eq(10);
    expect(await token().balanceOf(holder1)).to.be.bignumber.eq(990);
    expect(await token().totalSupply()).to.be.bignumber.eq(1000);
  });

  it("should allow approved transfer from when transfers enabled", async () => {
    await generate(1000, holder1);
    await controller().setAllowOnTransfer(true);
    expect(await token().balanceOf(holder1)).to.be.bignumber.eq(1000);
    await token().approve(broker, 10, { from: holder1 });
    await token().transferFrom(holder1, holder2, 10, { from: broker });

    expect(await token().balanceOf(holder2)).to.be.bignumber.eq(10);
    expect(await token().balanceOf(holder1)).to.be.bignumber.eq(990);
    expect(await token().totalSupply()).to.be.bignumber.eq(1000);
  });

  it("should allow erc223 transfer when transfers enabled", async () => {
    await generate(1000, holder1);
    await controller().setAllowOnTransfer(true);

    const data = "!79bc68b14fe3225ab8fe3278b412b93956d49c2dN";
    await token().transfer["address,uint256,bytes"](holder2, 10, data, { from: holder1 });

    expect(await token().balanceOf(holder2)).to.be.bignumber.eq(10);
    expect(await token().balanceOf(holder1)).to.be.bignumber.eq(990);
    expect(await token().totalSupply()).to.be.bignumber.eq(1000);
  });

  it("should reject transfer when transfer disabled", async () => {
    await generate(1000, holder1);
    await controller().setAllowOnTransfer(false);

    await expect(token().transfer(holder2, 10, { from: holder1 })).to.revert;
  });

  it("should allow granular transfer permissions", async () => {
    await generate(1000, holder1);
    await generate(1000, holder2);
    // disable generic transfer permission
    await controller().setAllowOnTransfer(false);
    // enable for holder1 from and to with amount 17
    await controller().setAllowedAddress(holder1, 17);
    await token().transfer(holder2, 17, { from: holder1 });
    await token().transfer(holder1, 17, { from: holder2 });

    await expect(token().transfer(holder2, 10, { from: holder1 })).to.revert;
    await expect(token().transfer(holder1, 10, { from: holder2 })).to.revert;
    await expect(token().transfer(broker, 17, { from: holder2 })).to.revert;

    // also brokerage should work
    await controller().setAllowedAddress(holder1, 0);
    await controller().setAllowedAddress(broker, 22);
    await token().approve(broker, 88, { from: holder2 });
    await token().transferFrom(holder2, holder1, 22, { from: broker });

    await expect(token().transferFrom(holder2, holder1, 11, { from: broker })).to.revert;
  });

  it("should reject approved transfer when transfers disabled", async () => {
    await generate(1000, holder1);
    await controller().setAllowOnTransfer(false);
    await token().approve(broker, 10, { from: holder1 });
    await expect(token().transferFrom(holder1, holder2, 10, { from: broker })).to.be.revert;
  });

  it("should block erc223 transfer when transfers disabled", async () => {
    await generate(1000, holder1);
    await controller().setAllowOnTransfer(false);

    const data = "!79bc68b14fe3225ab8fe3278b412b93956d49c2dN";
    await expect(token().transfer["address,uint256,bytes"](holder2, 10, data, { from: holder1 })).to
      .revert;
  });

  it("should approve when approve enabled", async () => {
    await controller().setAllowApprove(true);
    await token().approve(broker, 18281, { from: holder1 });
  });

  it("should reject approve when approve disabled", async () => {
    await controller().setAllowApprove(false);
    await expect(token().approve(broker, 18281, { from: holder1 })).to.be.rejectedWith(EvmError);
  });

  it("should allow granular approve permissions", async () => {
    await controller().setAllowApprove(false);
    // enable for holder1 to approve or be approved for amount 17
    await controller().setAllowedAddress(holder1, 17);
    await token().approve(broker, 17, { from: holder1 });
    await token().approve(holder1, 17, { from: holder2 });

    await expect(token().approve(broker, 18, { from: holder1 })).to.revert;
    await expect(token().approve(holder1, 18, { from: holder2 })).to.revert;
  });

  it("should generate token if allowed", async () => {
    await controller().setAllowOnGenerateTokens(true);
    await generate(1000, holder1);
  });

  it("rejects generate token if disallowed", async () => {
    await controller().setAllowOnGenerateTokens(false);
    await expect(generate(1000, holder1)).to.be.rejectedWith(EvmError);
  });

  it("should allow granular generate permissions", async () => {
    await controller().setAllowOnGenerateTokens(false);
    // enable for holder1 to be generator for amount 17
    await controller().setAllowedAddress(holder1, 17);
    await controller().swapOwnerSender(true);
    // will check holder1 as a sender
    await generate(17, holder1);
    await expect(generate(99, holder1)).to.revert;
    await expect(generate(17, holder2)).to.revert;

    // enable for holder1 to be issued tokens for amount 17
    await controller().swapOwnerSender(false);
    await generate(17, holder1);
    await expect(generate(99, holder1)).to.revert;
    await expect(generate(17, holder2)).to.revert;
  });

  it("should destroy tokens if allowed", async () => {
    await generate(1000, holder1);
    await controller().setAllowDestroyTokens(true);
    await destroy(1000, holder1);
  });

  it("reject destroy tokens if not allowed", async () => {
    await generate(1000, holder1);
    await controller().setAllowDestroyTokens(false);
    await expect(destroy(1000, holder1)).to.be.rejectedWith(EvmError);
  });

  it("should allow granular destroy permissions", async () => {
    await generate(1000, holder1);
    await controller().setAllowDestroyTokens(false);
    // enable for holder1 to be generator for amount 17
    await controller().setAllowedAddress(holder1, 17);
    await controller().swapOwnerSender(true);
    // will check holder1 as a sender
    await destroy(17, holder1);
    await expect(destroy(99, holder1)).to.revert;
    await expect(destroy(17, holder2)).to.revert;

    // enable for holder1 to be issued tokens for amount 17
    await controller().swapOwnerSender(false);
    await destroy(17, holder1);
    await expect(destroy(99, holder1)).to.revert;
    await expect(destroy(17, holder2)).to.revert;
  });

  it("should force transfer via allowance override", async () => {
    const amount = new web3.BigNumber(1);
    await generate(amount, holder1);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(0);
    await controller().setAllowanceOverride(holder1, broker, amount);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(amount);
    await token().transferFrom(holder1, holder2, amount, { from: broker });
    // forced allowance is not decreased
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(amount);
    // only when reset by controller
    await controller().setAllowanceOverride(holder1, broker, new web3.BigNumber(0));
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(0);
    expect(await token().balanceOf(holder2)).to.be.bignumber.eq(amount);
  });

  it("rejects approval when allowance override", async () => {
    const amount = new web3.BigNumber(1);
    await controller().setAllowanceOverride(holder1, broker, amount);
    // different amount
    await expect(token().approve(broker, 2, { from: holder1 })).to.be.rejectedWith(EvmError);
    // same amount
    await expect(token().approve(broker, amount, { from: holder1 })).to.be.rejectedWith(EvmError);
    await controller().setAllowanceOverride(holder1, broker, 0);
    await token().approve(broker, 2, { from: holder1 });
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(2);
    await generate(2, holder1);
    await token().transferFrom(holder1, holder2, 2, { from: broker });
  });

  it("rejects allowance reset when there's override", async () => {
    const amount = new web3.BigNumber(1);
    await controller().setAllowanceOverride(holder1, broker, amount);
    await expect(token().approve(broker, 0, { from: holder1 })).to.be.rejectedWith(EvmError);
  });

  it("should shadow existing allowance when there's override", async () => {
    await token().approve(broker, 2, { from: holder1 });
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(2);
    const amount = new web3.BigNumber(1);
    await controller().setAllowanceOverride(holder1, broker, amount);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(amount);
    await controller().setAllowanceOverride(holder1, broker, 0);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(2);
  });
}
