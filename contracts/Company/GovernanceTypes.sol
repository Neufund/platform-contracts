pragma solidity 0.4.26;


contract GovernanceTypes {

    ////////////////////////
    // Constants
    ////////////////////////

    // number of actions declared by Action enum
    uint256 internal constant TOTAL_ACTIONS = 24;

    ////////////////////////
    // Types
    ////////////////////////

    enum TokenVotingRule {
        // nominee has no voting rights
        NoVotingRights,
        // nominee votes yes if token holders do not say otherwise
        Positive,
        // nominee votes against if token holders do not say otherwise
        Negative,
        // nominee passes the vote pro rata with share capital of token holders voting yes/no
        Prorata
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
        None, // no on-chain action on resolution, default bylaw
        RestrictedNone, // no on-chain action on resolution, restricted act bylaw
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
        // results in issuance of new equity token and disbursing it to current token holders
        // new sharews must be transferred to nominee
        // additional conditions must apply in execution function for anti dilution to happen
        AntiDilutionProtection,
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
        // changes valuation, keeping number of shares
        AmendValuation,
        CancelResolution // a resolution that cancels another resolution, like calling off dividend payout or company closing
    }

    // permissions required to execute an action
    enum ActionEscalation {
        // anyone can execute
        Anyone,
        // token holder can execute
        TokenHolder,
        // company legal rep
        CompanyLegalRep,
        Nominee,
        CompanyOrNominee,
        // requires escalation to all tokenholders
        THR,
        // requires escalation to all shareholders
        SHR,
        // requires parent resolution to be completed
        ParentResolution
    }

    // legal representative of an action
    enum ActionLegalRep {
        // trustless action
        None,
        CompanyLegalRep,
        Nominee
    }

    // 56 bit length
    struct ActionBylaw {
        // permission level (any token holder, company legal rep, nominee, company or legal rep, token holders, share holders, parent resolution)
        ActionEscalation escalationLevel;
        // voting period in seconds
        uint8 votingPeriodDays;
        // voting quorum percent, inclusive (50 for 50%)
        uint8 votingQuorumPercent;
        // voting majority percent, inclusive (50 for 50%)
        uint8 votingMajorityPercent;
        // majority voting power - specific voting power required to pass
        // if not 0 voting quorum and majority will be ignored
        uint8 votingPowerPercent;
        // voting rule for token holders
        TokenVotingRule votingRule;
        // off chain rep of the voting (none, nominee, company legal rep)
        ActionLegalRep votingLegalRepresentative;
        // voting rule for shareholders is always prorata to voting capital
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
        // payload that is free to use and will be migrated with resolution
        bytes32 payload;
        // next WORD
        // initial action being executed
        Action action; // 8-bit
        // state of the execution
        ExecutionState state; // 8-bit
        // resolution started
        uint32 startedAt; // 32-bit
        // resolution finished
        uint32 finishedAt; // 32-bit
        // resolution deadline
        uint32 cancelAt; // 32-bit
        // execution next step
        uint8 nextStep; // 8-bit
        // reserved

        // resolution deadline
        // child executions
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor () internal {}

    ////////////////////////
    // Internal Methods
    ////////////////////////

    function deserializeBylaw(uint56 bylaw)
        internal
        pure
        returns (ActionBylaw memory decodedBylaw)
    {
        // up to solidity 0.4.26 struct memory layout is unpacked, where every element
        // of the struct occupies at least single word, also verified with v 0.6
        // so struct memory layout seems pretty stable, anyway we run a few tests on it
        assembly {
            // from 0 to 7
            for { let i := 0 } lt(i, 8) { i := add(i, 1) }
                // store a byte 32 - i into 32 byte offset with number i, starting from decodedBylaw
                // mind that uint56 is internal Solidity construct, it occupies whole word (see `byte`)
                { mstore(add(decodedBylaw, mul(32,i)), byte(add(25, i), bylaw)) }
        }
    }
}
