pragma solidity 0.4.26;


contract GovernanceTypes {

    ////////////////////////
    // Types
    ////////////////////////

    enum VotingRule {
        // nominee has no voting rights
        NoVotingRights,
        // nominee votes yes if token holders do not say otherwise
        Positive,
        // nominee votes against if token holders do not say otherwise
        Negative,
        // nominee passes the vote as is giving yes/no split
        Proportional
    }

    // defines state machine of the token controller which goes from I to T without loops
    enum GovState {
        Setup, // Initial state
        Offering, // primary token offering in progress
        Funded, // token offering succeeded, execution of shareholder rights possible
        Closing, // company is being closed
        Closed, // terminal state, company closed
        Migrating, // contract is being migrated to new implementation
        Migrated // terminal state, contract migrated
    }

    enum Action {
        None, // no on-chain action on resolution
        StopToken, // blocks transfers
        ContinueToken, // enables transfers
        CloseToken, // any liquidation: dissolution, tag, drag, exit (settlement time, amount eur, amount eth)
        Payout, // any dividend payout (amount eur, amount eth)
        RegisterOffer, // start new token offering
        ChangeTokenController, // (new token controller)
        AmendISHA, // for example off-chain investment (agreement url, new number of shares, new shareholder rights, new valuation eur, new authorized capital)
        IssueTokensForExistingShares, // (number of converted shares, allocation (address => balance))
        ChangeNominee,
        Downround, // results in issuance of new equity token and disbursing it to current token holders
        EstablishAuthorizedCapital, // results in new amount of authorized capital
        // results with establishing authorized capital (optional), new ESOP contract address with ESOP params and assigning authorized capital to pools
        // existing authorized capital pool can be assigned then voting is not required
        // same ESOP can be established - then pool will be increased
        EstablishESOP,
        CancelResolution // a resolution that cancels another resolution, like calling off dividend payout or company closing
    }

    enum TokenType {
        Equity, // equity token
        Safe // SAFE-based convertible note
    }

    enum TokenState {
        Open, // token is open and may be transferred if controller permits
        Closing, // token is being closed or converted, transfers are disabled
        Closed // token is irreversibly closed and all rights are migrated or void
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}
}
