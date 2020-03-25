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

export const GovAction = {
  None: 0, // no on-chain action on resolution
  StopToken: 1, // blocks transfers
  ContinueToken: 2, // enables transfers
  CloseToken: 3, // any liquidation: dissolution, tag, drag, exit (settlement time, amount eur, amount eth)
  Payout: 4, // any dividend payout (amount eur, amount eth)
  RegisterOffer: 5, // start new token offering
  ChangeTokenController: 6, // (new token controller)
  AmendISHA: 7, // for example off-chain investment (agreement url, new number of shares, new shareholder rights, new valuation eur)
  IssueTokensForExistingShares: 8, // (number of converted shares, allocation (address => balance))
  ChangeNominee: 9,
  Downround: 10,
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
