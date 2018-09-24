import { expect } from "chai";
import { deployUniverse } from "../helpers/deployContracts";
import { contractId } from "../helpers/constants";
import { prettyPrintGasCost } from "../helpers/gasUtils";
import { GovState } from "../helpers/govState";

const PlaceholderEquityTokenController = artifacts.require("PlaceholderEquityTokenController");

contract("PlaceholderEquityTokenController", ([_, admin, company]) => {
  let universe;
  // let accessPolicy;
  let tokenController;

  beforeEach(async () => {
    [universe] = await deployUniverse(admin, admin);
    tokenController = await PlaceholderEquityTokenController.new(universe.address, company);
  });

  it("should deploy and check initial state", async () => {
    await prettyPrintGasCost("PlaceholderEquityTokenController deploy", tokenController);
    expect(await tokenController.state()).to.be.bignumber.eq(GovState.Setup);
    const shareholderInfo = await tokenController.shareholderInformation();
    for (const v of shareholderInfo) {
      expect(v).to.be.bignumber.eq(0);
    }
    const capTable = await tokenController.capTable();
    expect(capTable[0].length).to.eq(0);
    expect(capTable[1].length).to.eq(0);
    expect(capTable[2].length).to.eq(0);
    expect((await tokenController.contractId())[0]).to.eq(
      contractId("PlaceholderEquityTokenController"),
    );
  });

  // startResolution, executeResolution, closeCompany, cancelCompanyClosing
  it("reverts on voting rights");
  // tokenFallback is used to pay dividend in full implementation
  it("reverts on tokenFallback");
  it("should migrate token controller");
  it("rejects migrating token controller not by company");
  it("rejects migrating token controller in wrong states");
  // we let migrate multiple times in case first one goes wrong
  it("should migrate token controller twice");
  it("should execute general information rights");
  it("rejects amend Agreement (ISHA) by company");
  it("should return true onApprove");
  it("should return false hasPermanentAllowance");
  it("should return false on changing nominee");
  // negative and positive cases in test below
  it("should allow generating tokens only by registered ETO in Offering state");
  // negative and positive cases in test below
  it("should allow destroying tokens only by registered ETO in Offering state");
  it("should not allow closing token");
  it("should allow changing token controller");

  // a set of IETOCommitmentObserver tests where mocked IETOCommitment impl. will be required
  // for each test all state data should be obtained from the contract and compared to what we want
  it("should register ETO start");
  it("rejects register ETO start from ETO not in universe");

  // approval sets equity token in cap table, sets Agreement to ISHA, sets general company information, moves state to Funded
  it("should approve ETO and execute transfer rights");
  it("rejects approve ETO from ETO not registered before");
  it("rejects approve ETO from registered ETO that was removed from universe");
  it("should fail ETO - refund");
  it("rejects fail ETO from ETO not registered before");
  it("should allow generating equity tokens via ETO contract");
  it("should allow destroying equity tokens via ETO contract");
  it("should set transfers on approval according to ShareholderRights of ETOTerms");
  // there are many rejection cases: like not from registered ETO, not from ETO, from other ETO in universe but not registered, from registered ETO but in Offering state
  it(
    "should allow transfer if transfers disabled only from registered ETO and only in Offering state",
  );

  // a set of tests vs EquityToken
  // first -> run a full test suite for tokens as in EquityToken.js for Placeholder controller with enabled transfers.
  it("rejects transfer if disallowed");
  it("rejects transferFrom is disallowed");
  it("rejects closing token");
  it("rejects nominee change");
  it("should change token controller if old controller properly migrated");
});
