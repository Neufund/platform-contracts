// Needs to match contracts/Company/IControllerGovernance:GovState
export const GovState = {
  Setup: 0,
  Offering: 1,
  Funded: 2,
  Closing: 3,
  Closed: 4,
  Migrated: 5,
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
