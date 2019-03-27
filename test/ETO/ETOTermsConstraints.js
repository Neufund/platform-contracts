import { expect } from "chai";

const ETOTermsConstraints = artifacts.require("ETOTermsConstraints");

const DEFAULT_ARGUMENTS = [true, true, 1, 20, 5, 40, "some name", 1, 1, 1, 1];

contract("ETOTermsContraints", () => {
  it("should deploy and retain all values submitted", async () => {
    const constraints = await ETOTermsConstraints.new(...DEFAULT_ARGUMENTS);
    expect(await constraints.CAN_SET_TRANSFERABILITY()).to.eq(true);
    expect(await constraints.HAS_NOMINEE()).to.eq(true);
    expect(await constraints.MIN_TICKET_SIZE_EUR_ULPS()).to.be.bignumber.eq(1);
    expect(await constraints.MAX_TICKET_SIZE_EUR_ULPS()).to.be.bignumber.eq(20);
    expect(await constraints.MIN_INVESTMENT_AMOUNT_EUR_ULPS()).to.be.bignumber.eq(5);
    expect(await constraints.MAX_INVESTMENT_AMOUNT_EUR_ULPS()).to.be.bignumber.eq(40);
    expect(await constraints.OFFERING_DOCUMENT_TYPE()).to.be.bignumber.eq(1);
    expect(await constraints.OFFERING_DOCUMENT_SUB_TYPE()).to.be.bignumber.eq(1);
    expect(await constraints.JURISDICTION()).to.be.bignumber.eq(1);
    expect(await constraints.ASSET_TYPE()).to.be.bignumber.eq(1);
    expect(await constraints.NAME()).to.eq("some name");
  });

  it("should enforce maxticketsize larger than minticket size", async () => {
    const args = [...DEFAULT_ARGUMENTS];
    args[2] = 10;
    args[3] = 5;
    await expect(ETOTermsConstraints.new(...args)).to.revert;
  });

  it("should enforce maxinvestmentsize larger than mininvestmentsize", async () => {
    const args = [...DEFAULT_ARGUMENTS];
    args[4] = 100;
    args[5] = 50;
    await expect(ETOTermsConstraints.new(...args)).to.revert;
  });

  it("should enforce maxinvestmentsize to be larger than minticketsize", async () => {
    const args = [...DEFAULT_ARGUMENTS];
    args[2] = 100;
    args[3] = 200;
    args[5] = 50;
    await expect(ETOTermsConstraints.new(...args)).to.revert;
  });

  it("should enforce maxticketsize to be larger than 0", async () => {
    const args = [...DEFAULT_ARGUMENTS];
    args[2] = 0;
    args[3] = 0;
    await expect(ETOTermsConstraints.new(...args)).to.revert;
  });

  it("should enforce maxinvestmentsize to be larger than 0", async () => {
    const args = [...DEFAULT_ARGUMENTS];
    args[4] = 0;
    args[5] = 0;
    await expect(ETOTermsConstraints.new(...args)).to.revert;
  });
});
