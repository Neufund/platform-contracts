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
        // requires change of control resolution/dissolution to be in executing state
        // on entering executing state will stop token
        // will be completed on payout of certain amount of nEUR
        CloseToken,
        OrdinaryPayout, // any scheduled or expected payout initiated by company legal rep
        ExtraodindaryPayout, // a payout that requires resolution to pass
        RegisterOffer, // start new token offering
        ChangeTokenController, // (new token controller)
        AmendISHA, // for example off-chain investment (agreement url, new number of shares, new shareholder rights, new valuation eur, new authorized capital)
        // allocates tokens against shares that are transferred to nominee
        // requires SHR
        IssueTokensForExistingShares,
        // transfers shares to particular investors, destroying equity tokens
        // requires SHR
        IssueSharesForExistingTokens,
        ChangeNominee,
        Downround, // results in issuance of new equity token and disbursing it to current token holders
        EstablishAuthorizedCapital, // results in new amount of authorized capital
        // requires new ESOP contract address with ESOP params and assigning authorized capital to pools
        // existing authorized capital pool can be assigned then voting is not required
        // same ESOP can be established - then pool will be increased
        EstablishESOP,
        // converts ESOP into equity token or an internal 'payout token', completed only when conversion is over
        ConvertESOP,
        // any change of control event, will result in company closing
        // will create child resolutions for all tokens to be closed and ESOP to be converted
        // drag along is mandatory, we do not support governance without it
        ChangeOfControl,
        // same as above, will close company when it's dissolved
        DissolveCompany,
        TagAlong, // equity token holders vote on tag along
        // voting on yearly report, also Nominee may attend the meeting off-chain
        AnnualGeneralMeeting,
        // changes valuation and number of shares, initiated by company legal rep
        // for example when note is converted after offering or when company wants to announce new official valuation
        AmendSharesAndValuation,
        CancelResolution // a resolution that cancels another resolution, like calling off dividend payout or company closing
    }

    struct ActionGovernance {
        // permission level (any token holder, company legal rep, nominee, company or legal rep, token holders, share holders, parent resolution)
        uint8 escalationLevel;
        // voting period in seconds
        uint32 votingPeriod;
        // voting quorum fraction scaled to 32bits
        uint32 votingQuorum32Frac;
        // voting majority fraction scaled to 32 bits
        uint32 votingMajority32Frac;
        // majority voting power - specific voting power required to pass
        // if not 0 voting quorum and majority will be ignored
        uint32 votingPower32Frac;
        // voting rule for token holders
        VotingRule votingRule;
        // off chain rep of the voting (none, nominee, company legal rep)
        uint8 votingLegalRepresentative;
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

    enum ExecutionState {
        New,
        // permissions are being escalated ie. voting in progress
        Escalating,
        // permission escalation failed
        Rejected,
        // resolution in progress
        Executing,
        // resolution was cancelled ie. due to timeout
        Cancelled,
        // resolution execution failed ie. ETO refunded
        Failed,
        // resolution execution OK
        Completed
    }

    struct ResolutionExecution {
        // payload promise
        bytes32 promise; // 256 bits
        // next WORD
        // failed code which is keccak of revert code from validator
        bytes32 failedCode;
        // next WORD
        // initial action being executed
        Action action; // 8-bit
        // state of the execution
        ExecutionState state; // 8-bit
        // resolution started
        uint32 startedAt; // 32-bit
        // resolution finished
        uint32 finishedAt; // 32-bit
        // reserved

        // resolution deadline
        // child executions
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}
}
