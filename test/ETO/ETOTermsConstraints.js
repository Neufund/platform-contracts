import { expect } from "chai";
import { deployETOTermsConstraints } from "../helpers/deployTerms";
import { Q18 } from "../helpers/constants";

const ETOTermsConstraints = artifacts.require("ETOTermsConstraints");

contract("ETOTermsContraints", () => {
  it("should deploy default args", async () => {
    await deployETOTermsConstraints(ETOTermsConstraints);
  });

  it("should deploy and retain all values submitted", async () => {
    const [constraints, terms] = await deployETOTermsConstraints(ETOTermsConstraints, {
      MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(2),
      MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(50),
    });
    expect(await constraints.CAN_SET_TRANSFERABILITY()).to.eq(terms.CAN_SET_TRANSFERABILITY);
    expect(await constraints.HAS_NOMINEE()).to.eq(terms.HAS_NOMINEE);
    expect(await constraints.MIN_TICKET_SIZE_EUR_ULPS()).to.be.bignumber.eq(
      terms.MIN_TICKET_SIZE_EUR_ULPS,
    );
    expect(await constraints.MAX_TICKET_SIZE_EUR_ULPS()).to.be.bignumber.eq(
      terms.MAX_TICKET_SIZE_EUR_ULPS,
    );
    expect(await constraints.MIN_INVESTMENT_AMOUNT_EUR_ULPS()).to.be.bignumber.eq(
      terms.MIN_INVESTMENT_AMOUNT_EUR_ULPS,
    );
    expect(await constraints.MAX_INVESTMENT_AMOUNT_EUR_ULPS()).to.be.bignumber.eq(
      terms.MAX_INVESTMENT_AMOUNT_EUR_ULPS,
    );
    expect(await constraints.OFFERING_DOCUMENT_TYPE()).to.be.bignumber.eq(
      terms.OFFERING_DOCUMENT_TYPE,
    );
    expect(await constraints.OFFERING_DOCUMENT_SUB_TYPE()).to.be.bignumber.eq(
      terms.OFFERING_DOCUMENT_SUB_TYPE,
    );
    expect(await constraints.JURISDICTION()).to.equal(terms.JURISDICTION);
    expect(await constraints.ASSET_TYPE()).to.be.bignumber.eq(terms.ASSET_TYPE);
    expect(await constraints.NAME()).to.eq(terms.NAME);
  });

  it("should enforce maxticketsize larger than minticket size", async () => {
    const args = {
      MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(10),
      MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(2),
    };
    await expect(deployETOTermsConstraints(ETOTermsConstraints, args)).to.revert;
  });

  it("should enforce maxinvestmentsize larger than mininvestmentsize", async () => {
    const args = {
      MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(1000),
      MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(500),
    };
    await expect(deployETOTermsConstraints(ETOTermsConstraints, args)).to.revert;
  });

  it("should enforce maxinvestmentsize to be larger than minticketsize", async () => {
    const args = {
      MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(200),
      MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(200),
      MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
      MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(200).sub(1),
    };
    await expect(deployETOTermsConstraints(ETOTermsConstraints, args)).to.revert;
  });

  it("should interpret 0 on maxticketsize to be unlimited", async () => {
    const args = {
      MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(500),
      MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(0),
    };
    await deployETOTermsConstraints(ETOTermsConstraints, args);
  });

  it("should interpret 0 on maxinvestmentsize as unlimited", async () => {
    let args = {
      MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(500),
      MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
    };
    await deployETOTermsConstraints(ETOTermsConstraints, args);

    args = {
      MIN_TICKET_SIZE_EUR_ULPS: Q18.mul(200),
      MAX_TICKET_SIZE_EUR_ULPS: Q18.mul(200),
      MIN_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0),
      MAX_INVESTMENT_AMOUNT_EUR_ULPS: Q18.mul(0), // 0 will work here too
    };
    await deployETOTermsConstraints(ETOTermsConstraints, args);
  });

  it("should not allow VMAs to be transferable", async () => {
    const args = {
      ASSET_TYPE: Q18.mul(1), // This is now a WMA
      CAN_SET_TRANSFERABILITY: true,
    };
    await expect(deployETOTermsConstraints(ETOTermsConstraints, args)).to.revert;
  });
});
