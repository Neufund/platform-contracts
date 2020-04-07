import { soliditySha3 } from "web3-utils";

// Needs to match contracts/Company/IControllerGovernance:GovState
export const GovState = {
  Setup: 0,
  Offering: 1,
  Funded: 2,
  Closing: 3,
  Closed: 4,
  Migrating: 5,
  Migrated: 6,
};

// Needs to match GovernanceTypes:Action
export const GovAction = {
  None: 0,
  StopToken: 1,
  ContinueToken: 2,
  CloseToken: 3,
  OrdinaryPayout: 4,
  ExtraodindaryPayout: 5,
  RegisterOffer: 6,
  ChangeTokenController: 7,
  AmendISHA: 8,
  IssueTokensForExistingShares: 9,
  IssueSharesForExistingTokens: 10,
  ChangeNominee: 11,
  Downround: 12,
  EstablishAuthorizedCapital: 13,
  EstablishESOP: 14,
  ConvertESOP: 15,
  ChangeOfControl: 16,
  DissolveCompany: 17,
  TagAlong: 18,
  AnnualGeneralMeeting: 19,
  AmendSharesAndValuation: 20,
  CancelResolution: 21,
};

export const GovExecutionState = {
  New: 0,
  // permissions are being escalated ie. voting in progress
  Escalating: 1,
  // permission escalation failed
  Rejected: 2,
  // resolution in progress
  Executing: 3,
  // resolution was cancelled ie. due to timeout
  Cancelled: 4,
  // resolution execution failed ie. ETO refunded
  Failed: 5,
  // resolution execution OK
  Completed: 6,
};

export const GovTokenType = {
  Equity: 0,
  Safe: 1,
};

export const GovTokenState = {
  Open: 0,
  Closing: 1,
  Closed: 2,
};

export function isTerminalExecutionState(s) {
  return (
    [
      GovExecutionState.Rejected,
      GovExecutionState.Cancelled,
      GovExecutionState.Failed,
      GovExecutionState.Completed,
    ].findIndex(v => v === s) >= 0
  );
}

export function getCommitmentResolutionId(addr) {
  return soliditySha3({ type: "address", value: addr });
}
