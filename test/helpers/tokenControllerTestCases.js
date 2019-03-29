import { BigNumber } from "./bignumber";
import { expect } from "chai";
import EvmError from "./EVMThrow";

const TestTokenControllerPassThrough = artifacts.require("TestTokenControllerPassThrough");

export function testChangeTokenController(token, controller) {
  it("should change token controller when change enabled", async () => {
    const newController = await TestTokenControllerPassThrough.new();
    await controller().setAllowChangeTokenController(true);

    await token().changeTokenController(newController.address);

    expect(await token().tokenController()).to.eq(newController.address);
  });

  it("rejects change token controller when change disabled", async () => {
    const newController = await TestTokenControllerPassThrough.new();
    await controller().setAllowChangeTokenController(false);

    await expect(token().changeTokenController(newController.address)).to.revert;
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

  it("should generate token if allowed", async () => {
    await controller().setAllowOnGenerateTokens(true);
    await generate(1000, holder1);
  });

  it("rejects generate token if disallowed", async () => {
    await controller().setAllowOnGenerateTokens(false);
    await expect(generate(1000, holder1)).to.be.rejectedWith(EvmError);
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

  it("should force transfer via allowance override", async () => {
    const amount = new BigNumber(1);
    await generate(amount, holder1);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(0);
    await controller().setAllowanceOverride(holder1, broker, amount);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(amount);
    await token().transferFrom(holder1, holder2, amount, { from: broker });
    // forced allowance is not decreased
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(amount);
    // only when reset by controller
    await controller().setAllowanceOverride(holder1, broker, new BigNumber(0));
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(0);
    expect(await token().balanceOf(holder2)).to.be.bignumber.eq(amount);
  });

  it("rejects approval when allowance override", async () => {
    const amount = new BigNumber(1);
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
    const amount = new BigNumber(1);
    await controller().setAllowanceOverride(holder1, broker, amount);
    await expect(token().approve(broker, 0, { from: holder1 })).to.be.rejectedWith(EvmError);
  });

  it("should shadow existing allowance when there's override", async () => {
    await token().approve(broker, 2, { from: holder1 });
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(2);
    const amount = new BigNumber(1);
    await controller().setAllowanceOverride(holder1, broker, amount);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(amount);
    await controller().setAllowanceOverride(holder1, broker, 0);
    expect(await token().allowance(holder1, broker)).to.be.bignumber.eq(2);
  });
}
