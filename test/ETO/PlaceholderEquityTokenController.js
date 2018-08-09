// import { expect } from "chai";

contract("PlaceholderEquityTokenController", ([_]) => {
  it("should deploy and check initial state");
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
  // for each test all state data should be obtained from the contract and compated to what we want
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

  // a set of tests vs EquityToken
  // first -> run a full test suite for tokens as in EquityToken.js for Placeholder controller with enabled transfers.
  it("rejects transfer if disallowed");
  it("rejects transferFrom is disallowed");
  it("rejects closing token");
  it("rejects nominee change");
  it("should change token controller if old controller properly migrated");
});
