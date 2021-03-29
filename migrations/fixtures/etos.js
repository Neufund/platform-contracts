const {
  defEtoTerms,
  hnwiEtoDeSecurityTerms,
  retailEtoDeVmaTerms,
  miniEtoLiTerms,
  miniEtoLiNominalValueTerms,
  hnwiEtoLiSecurityTerms,
  retailSMEEtoLi,
} = require("./eto_terms");
const CommitmentState = require("../../test/helpers/commitmentState").CommitmentState;

const getFixtureAccounts = require("./accounts").getFixtureAccounts;

const fas = getFixtureAccounts();

export const etoFixtures = {
  ETONoStartDate: {
    state: null,
    issuer: fas.ISSUER_SETUP_NO_ST,
    terms: hnwiEtoLiSecurityTerms,
  },

  ETOInSetupState: {
    state: CommitmentState.Setup,
    issuer: fas.ISSUER_SETUP,
    terms: defEtoTerms,
  },

  ETOInWhitelistState: {
    state: CommitmentState.Whitelist,
    issuer: fas.ISSUER_WHITELIST,
    terms: hnwiEtoDeSecurityTerms,
  },

  ETOInPublicState: {
    state: CommitmentState.Public,
    issuer: fas.ISSUER_PUBLIC,
    terms: miniEtoLiTerms,
  },

  ETOInSigningState: {
    state: CommitmentState.Signing,
    issuer: fas.ISSUER_SIGNING,
    terms: retailSMEEtoLi,
  },

  ETOInClaimState: {
    state: CommitmentState.Claim,
    issuer: fas.ISSUER_CLAIMS,
    terms: miniEtoLiNominalValueTerms,
  },

  ETOInPayoutState: {
    state: CommitmentState.Payout,
    issuer: fas.ISSUER_PAYOUT,
    terms: retailEtoDeVmaTerms,
  },

  ETOInPayoutStateWithExitContract: {
    state: CommitmentState.Payout,
    issuer: fas.ISSUER_EXIT,
    terms: retailEtoDeVmaTerms,
    hasExitContract: true
  },

  ETOInRefundState: {
    state: CommitmentState.Refund,
    issuer: fas.ISSUER_REFUND,
    terms: defEtoTerms,
  },

};
