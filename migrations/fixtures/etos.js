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
  null: ["ETONoStartDate", fas.ISSUER_SETUP_NO_ST, hnwiEtoLiSecurityTerms],
  [CommitmentState.Setup]: ["ETOInSetupState", fas.ISSUER_SETUP, defEtoTerms],
  [CommitmentState.Whitelist]: [
    "ETOInWhitelistState",
    fas.ISSUER_WHITELIST,
    hnwiEtoDeSecurityTerms,
  ],
  [CommitmentState.Public]: ["ETOInPublicState", fas.ISSUER_PUBLIC, miniEtoLiTerms],
  [CommitmentState.Signing]: ["ETOInSigningState", fas.ISSUER_SIGNING, retailSMEEtoLi],
  [CommitmentState.Claim]: ["ETOInClaimState", fas.ISSUER_CLAIMS, miniEtoLiNominalValueTerms],
  [CommitmentState.Payout]: ["ETOInPayoutState", fas.ISSUER_PAYOUT, retailEtoDeVmaTerms],
  [CommitmentState.Refund]: ["ETOInRefundState", fas.ISSUER_REFUND, defEtoTerms],
};
