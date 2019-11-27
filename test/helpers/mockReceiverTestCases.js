import { expect } from "chai";
import { promisify } from "./evmCommands";
import roles from "./roles";
import { deployUniverse, deployAccessControl, deployNeumarkUniverse } from "./deployContracts";

const EtherToken = artifacts.require("EtherToken");
const TestSender = artifacts.require("TestSender");

export function mockReceiverTests(getReceiver, account1) {
  const data = "!79bc68b14fe3225ab8fe3278b412b93956d49c2dN";
  const amount = 8;

  // Unit tests
  it("should have a ERC223 token callback function", async () => {
    await getReceiver().tokenFallback(account1, amount, data);
    // assert that fallback was called on contract
    const fallbackFrom = await getReceiver().from.call();
    expect(fallbackFrom).to.eq(account1);
    const fallbackAmount = await getReceiver().amount.call();
    expect(fallbackAmount).to.be.bignumber.eq(amount);
    const fallbackDataKeccak = await getReceiver().dataKeccak();
    expect(fallbackDataKeccak).to.eq(web3.sha3(data));
  });

  it("should have the ERC233 legacy callback function", async () => {
    await getReceiver().onTokenTransfer(account1, amount, data);
    // assert that fallback was called on contract
    const fallbackFrom = await getReceiver().from.call();
    expect(fallbackFrom).to.eq(account1);
    const fallbackAmount = await getReceiver().amount.call();
    expect(fallbackAmount).to.be.bignumber.eq(amount);
    const fallbackDataKeccak = await getReceiver().dataKeccak();
    expect(fallbackDataKeccak).to.eq(web3.sha3(data));
  });

  it("both token fallbacks can be manually disabled", async () => {
    await getReceiver().setERC223Acceptance(false);
    await expect(getReceiver().tokenFallback(account1, amount, data)).to.be.rejectedWith(
      "Token fallback is not enabled",
    );
    await expect(getReceiver().onTokenTransfer(account1, amount, data)).to.be.rejectedWith(
      "Legacy token fallback is not enabled",
    );
  });

  // // integration tests
  it("should accept being sent ether", async () => {
    const ETH_AMOUNT = 10000;
    await getReceiver().send(ETH_AMOUNT, { from: account1 });
    const balance = await promisify(web3.eth.getBalance)(getReceiver().address);
    expect(balance).to.be.bignumber.eq(ETH_AMOUNT);
  });

  it("should accept ether being sent via another contract", async () => {
    // fund another contract with ether
    const ETH_AMOUNT = 10000;
    const testsender = await TestSender.new();
    await testsender.send(ETH_AMOUNT, { from: account1 });

    // have that contract send ether to the receiver
    await testsender.sendAllEther(getReceiver().address);

    const receiverBalance = await promisify(web3.eth.getBalance)(getReceiver().address);
    expect(receiverBalance).to.be.bignumber.eq(ETH_AMOUNT);
    const senderBalance = await promisify(web3.eth.getBalance)(testsender.address);
    expect(senderBalance).to.be.bignumber.eq(0);
  });

  it("should accept Neumark (ERC223 Legacy Fallback)", async () => {
    // create neumark
    const universeParams = await deployUniverse(account1, account1);
    const neumark = await deployNeumarkUniverse(universeParams[0], account1);

    const initialBalance = await neumark.balanceOf(getReceiver().address);
    const amountToSend = 1000;

    // issue neumark and send to receiving contract
    await neumark.issueForEuro(amountToSend);
    await neumark.distribute(getReceiver().address, amountToSend);

    const finalBalance = await neumark.balanceOf.call(getReceiver().address);
    expect(finalBalance).to.be.bignumber.eq(initialBalance.add(amountToSend));
  });

  it("should accept EtherToken (ERC223 Fallback)", async () => {
    // deploy etherToken
    const rbap = await deployAccessControl([{ subject: account1, role: roles.reclaimer }]);
    const etherToken = await EtherToken.new(rbap.address);

    // make the etherToken call the fallback function
    const initialEtherBalanceSender = await promisify(web3.eth.getBalance)(account1);
    const initialBalance = await etherToken.balanceOf(getReceiver().address);
    const amountToTransfer = 1000000;
    const amountToDeposit = 1000000;
    assert(initialEtherBalanceSender > amountToTransfer + amountToDeposit);

    await etherToken.depositAndTransfer(getReceiver().address, amountToTransfer, 0, {
      from: account1,
      value: amountToTransfer + amountToDeposit,
    });

    // verify deposit & token transfer
    const receiverBalance = await etherToken.balanceOf(getReceiver().address);
    expect(receiverBalance).to.be.bignumber.eq(initialBalance.add(amountToTransfer));

    const senderBalance = await etherToken.balanceOf(account1);
    expect(senderBalance).to.be.bignumber.eq(amountToDeposit);
  });
}
