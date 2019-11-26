import { expect } from "chai";
import { ZERO_ADDRESS } from "./constants";


export function mockReceiverTests(
  getReceiver,
  account1
) {
  let receiver;
  const data = "!79bc68b14fe3225ab8fe3278b412b93956d49c2dN";
  const amount = 8;

  // Unit tests
  it("should have a ERC223 token callback function", async () => {
    await getReceiver().tokenFallback(
      account1,
      amount,
      data
    );
    // assert that fallback was called on contract
    const fallbackFrom = await getReceiver().from.call();
    expect(fallbackFrom).to.eq(account1);
    const fallbackAmount = await getReceiver().amount.call();
    expect(fallbackAmount).to.be.bignumber.eq(amount);
    const fallbackDataKeccak = await getReceiver().dataKeccak();
    expect(fallbackDataKeccak).to.eq(web3.sha3(data));
  });

  it("should have the ERC233 legacy callback function", async () => {
    await getReceiver().onTokenTransfer(
      account1,
      amount,
      data
    );
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
    await expect(
      getReceiver().tokenFallback(account1, amount, data)
    ).to.be.rejectedWith("Token fallback is not enabled");
    await expect(
      getReceiver().onTokenTransfer(account1, amount, data)
    ).to.be.rejectedWith("Legacy token fallback is not enabled");
  });

  // integration tests
  it("should accept ether sent by another contract", async () => {});
  it("should accept Neumark", async () => {});
  it("should accept EtherToken", async () => {});
}
