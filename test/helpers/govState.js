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

export const GovTokenVotingRule = {
  NoVotingRights: 0,
  Positive: 1,
  Negative: 2,
  Prorata: 3,
};

export function hasVotingRights(vr) {
  // make it work with bignumber
  if (vr.eq) {
    return !vr.eq(GovTokenVotingRule.NoVotingRights);
  }
  return vr !== GovTokenVotingRule.NoVotingRights;
}

// Needs to match GovernanceTypes:Action

const actionList = [
  "None",
  "RegisterOffer",
  "AmendGovernance",
  "RestrictedNone",
  "CompanyNone",
  "THRNone",
  "StopToken",
  "ContinueToken",
  "CloseToken",
  "OrdinaryPayout",
  "ExtraordinaryPayout",
  "ChangeTokenController",
  "IssueTokensForExistingShares",
  "IssueSharesForExistingTokens",
  "ChangeNominee",
  "AntiDilutionProtection",
  "EstablishAuthorizedCapital",
  "EstablishESOP",
  "ConvertESOP",
  "ChangeOfControl",
  "DissolveCompany",
  "TagAlong",
  "AnnualGeneralMeeting",
  "AmendSharesAndValuation",
  "AmendValuation",
  "CancelResolution",
];

export const GovAction = actionList.reduce((obj, cur, i) => {
  // eslint-disable-next-line
  obj[cur] = i;
  return obj;
}, {});

// permissions required to execute an action
export const GovActionEscalation = {
  // anyone can execute
  Anyone: 0,
  // token holder can execute
  TokenHolder: 1,
  // company legal rep
  CompanyLegalRep: 2,
  Nominee: 3,
  CompanyOrNominee: 4,
  // requires escalation to all tokenholders
  THR: 5,
  // requires escalation to all shareholders
  SHR: 6,
  // requires parent resolution to be completed
  ParentResolution: 7,
};

export function isVotingEscalation(e) {
  // make it work with bignumber
  if (e.eq) {
    return e.eq(GovActionEscalation.SHR) || e.eq(GovActionEscalation.THR);
  }
  return e === GovActionEscalation.SHR || e === GovActionEscalation.THR;
}

// legal representative of an action
export const GovActionLegalRep = {
  // trustless action
  None: 0,
  CompanyLegalRep: 1,
  Nominee: 2,
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
  None: 0,
  Equity: 1,
  Safe: 2,
};

export const GovTokenState = {
  Open: 0,
  Closing: 1,
  Closed: 2,
};
