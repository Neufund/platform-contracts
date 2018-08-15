// Needs to match contracts/ETO/IETOCommitmentStates:State
export const CommitmentState = {
  Setup: 0,
  Whitelist: 1,
  Public: 2,
  Signing: 3,
  Claim: 4,
  Payout: 5,
  Refund: 6,
};

export const CommitmentStateRev = Object.keys(CommitmentState).reduce(
  (obj, x) => Object.assign(obj, { [CommitmentState[x]]: x }),
  {},
);
