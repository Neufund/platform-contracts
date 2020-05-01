pragma solidity 0.4.26;

import "../Universe.sol";
import "../Math.sol";
import "./IEquityToken.sol";
import "./EquityTokenholderRights.sol";
import "../ETO/IETOCommitment.sol";


library Gov {

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
    enum State {
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
        ExtraordinaryPayout, // a payout that requires resolution to pass
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
        // a resolution that cancels another resolution, like calling off dividend payout or company closing
        CancelResolution,
        // general information from the company
        CompanyNone
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
        None, // there's no goverance token
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
    // Storages
    ////////////////////////

    // governance engine storage
    struct GovernanceStorage {
        // a root of trust contract
        Universe UNIVERSE;
        // company representative address
        address COMPANY_LEGAL_REPRESENTATIVE;

        // controller lifecycle state
        Gov.State  _state;

        // resolutions being executed
        mapping (bytes32 => Gov.ResolutionExecution) _resolutions;
        bytes32[]  _resolutionIds;
    }

    // single token storage
    struct TokenStorage {
        // type of a token
        TokenType _type;
        // state of a token
        TokenState _state;
        // is token transferable
        bool _transferable;
        // address of a token
        IControlledToken _token;
        // set of equity token rights associated with the token
        EquityTokenholderRights _tokenholderRights;
        // nominee address
        address _nominee;
        // quantum in which token may be created and destoryed
        uint256 _quantumUlps;
    }

    ///////////////////////////
    // Delegate Library Methods
    ///////////////////////////

    // used by governance engine to advance resolution from New -> Escalating -> Executing state
    function startResolutionExecution(
        GovernanceStorage storage g,
        TokenStorage storage t,
        bytes32 resolutionId,
        Gov.Action action,
        bytes32 promise
    )
        public
        returns (Gov.ExecutionState prevState, Gov.ExecutionState nextState)
    {
        // executor checks resolutionId state
        Gov.ResolutionExecution storage e = g._resolutions[resolutionId];
        prevState = e.state;
        require(prevState == Gov.ExecutionState.New || prevState == Gov.ExecutionState.Escalating);

        // save new state which may be Executing or Escalating
        if (prevState == Gov.ExecutionState.New) {
            // try to escalate to execution state
            nextState = permissionEscalator(g, t, action);
            // if New is returned, voting will be in campaign state and must be escalated further
            // for resolution to be created
            // TODO: implement special escalator to test this
            if (nextState == Gov.ExecutionState.New) {
                return;
            }
            // escalator may deny access to action
            require(nextState != Gov.ExecutionState.Rejected, "NF_GOV_EXEC_ACCESS_DENIED");
            // save new execution
            e.action = action;
            e.state = nextState;
            e.startedAt = uint32(now);
            // use calldata as promise
            e.promise = promise;
            // we should use tx.hash as resolutionId, it's however not available in EVM
            // that could give us access to msg.data at all times making subsequenct calls to
            // push execution forward easier
            g._resolutionIds.push(resolutionId);
        } else {
            // TODO: check voting center and check voting result
            nextState = prevState;
        }
    }

    // validates new offering that starts in token offering module
    function validateNewOffering(address company, IControlledToken token, IETOCommitment tokenOffering)
        public
        constant
    {
        IEquityToken equityToken = tokenOffering.equityToken();
        // require nominee match and agreement signature
        (address nomineeToken,,,) = equityToken.currentAgreement();
        // require token controller match
        require(equityToken.tokenController() == address(this));
        // require nominee and agreement match
        (address nomineOffering,,,) = tokenOffering.currentAgreement();
        require(nomineOffering == nomineeToken);
        // require terms set and legalRep match
        require(tokenOffering.etoTerms() != address(0));
        require(tokenOffering.companyLegalRep() == company);
        // secondary offering must be on the same token
        require(token == address(0) || equityToken == token, "NF_NDT_FUNDRAISE_NOT_SAME_TOKEN");
    }

    function installTokenFromETO(TokenStorage storage t, IETOCommitment tokenOffering)
        public
    {
        // get token data and put into the storage
        IEquityToken equityToken = tokenOffering.equityToken();
        EquityTokenholderRights tokenholderRights = tokenOffering.etoTerms().TOKENHOLDER_RIGHTS();
        bool transferable = tokenOffering.etoTerms().ENABLE_TRANSFERS_ON_SUCCESS();

        t._type = TokenType.Equity;
        t._state = TokenState.Open;
        t._transferable = transferable;
        t._token = IControlledToken(equityToken);
        t._tokenholderRights = tokenholderRights;

        setAdditionalEquityTokenData(t, equityToken);
    }

    function calculateNewValuationAndInstallToken(TokenStorage storage t, IETOCommitment tokenOffering)
        public
        returns (
            uint256 newShares,
            uint256 authorizedCapitalUlps,
            uint256 increasedShareCapital,
            uint256 increasedValuationEurUlps,
            string ISHAUrl
        )
    {
        installTokenFromETO(t, tokenOffering);
        return calculateNewValuation(tokenOffering);
    }

    //////////////////////////////
    // Internal Library Methods
    //////////////////////////////

    function isGeneralAction(Action a)
        internal
        pure
        returns (bool)
    {
        return a == Gov.Action.None || a == Gov.Action.RestrictedNone || a == Gov.Action.AnnualGeneralMeeting || a == Gov.Action.CompanyNone;
    }

    function promiseForSelector(bytes4 selector)
        internal
        pure
        returns (bytes32)
    {
        // replace selector and return keccak
        bytes memory calldata = msg.data;
        assembly {
            // patch calldata with the selector
            mstore8(add(calldata, 32), byte(0, selector))
            mstore8(add(calldata, 33), byte(1, selector))
            mstore8(add(calldata, 34), byte(2, selector))
            mstore8(add(calldata, 35), byte(3, selector))
        }
        return keccak256(calldata);
    }

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

    function setAdditionalEquityTokenData(TokenStorage storage t, IEquityToken token)
        internal
    {
        address nominee = getNominee(token);
        // todo: compute quantum
        uint256 quantum = 0;

        t._nominee = nominee;
        t._quantumUlps = quantum;
    }

    ////////////////////////
    // Private Methods
    ////////////////////////

    function calculateNewValuation(IETOCommitment tokenOffering)
        private
        constant
        returns (
            uint256 newShares,
            uint256 authorizedCapitalUlps,
            uint256 increasedShareCapital,
            uint256 increasedValuationEurUlps,
            string ISHAUrl
        )
    {
        // get ISHA amendment
        ETOTerms etoTerms = tokenOffering.etoTerms();
        // execute pending resolutions on completed ETO
        (newShares, increasedShareCapital,,,,,,) = tokenOffering.contributionSummary();
        // compute increased share capital (in ISHA currency!)
        increasedShareCapital = etoTerms.EXISTING_SHARE_CAPITAL() + increasedShareCapital;
        // use full price of a share as a marginal price from which to compute valuation
        uint256 marginalSharePrice = etoTerms.TOKEN_TERMS().SHARE_PRICE_EUR_ULPS();
        // compute new valuation by having market price for a single unit of ISHA currency
        // (share_price_eur / share_nominal_value_curr) * increased_share_capital_curr
        uint256 shareNominalValueUlps = etoTerms.TOKEN_TERMS().SHARE_NOMINAL_VALUE_ULPS();
        increasedValuationEurUlps = Math.proportion(marginalSharePrice, increasedShareCapital, shareNominalValueUlps);
        ISHAUrl = tokenOffering.signedInvestmentAgreementUrl();
        authorizedCapitalUlps = etoTerms.AUTHORIZED_CAPITAL();
    }

    function isTokenHolder(IControlledToken token, address owner)
        private
        constant
        returns (bool)
    {
        return token.balanceOf(owner) > 0;
    }

    function getNominee(IEquityToken token)
        private
        constant
        returns (address)
    {
        // return zero address for nominee if token does not exist
        return token == address(0) ? address(0) : token.nominee();
    }

    function getActionLegalRep(Gov.ActionLegalRep rep, address company, address nominee)
        private
        pure
        returns (address)
    {
        if (rep == Gov.ActionLegalRep.CompanyLegalRep) {
            return company;
        } else if (rep == Gov.ActionLegalRep.Nominee) {
            return nominee;
        }
        revert();
    }

    // figure out what right initator has for given escalation level in bylaw of particular action
    function getBylawEscalation(
        Gov.ActionEscalation escalationLevel,
        Gov.ActionLegalRep rep,
        address initiator,
        IControlledToken token,
        address company,
        address nominee
    )
        private
        constant
        returns (Gov.ExecutionState s)
    {
        if (escalationLevel == Gov.ActionEscalation.Anyone) {
            s = Gov.ExecutionState.Executing;
        } else if (escalationLevel == Gov.ActionEscalation.TokenHolder) {
            // must be a relevant token holder
            s = isTokenHolder(token, initiator) ? Gov.ExecutionState.Executing : Gov.ExecutionState.Rejected;
        } else if (escalationLevel == Gov.ActionEscalation.CompanyLegalRep) {
            s = initiator == company ? Gov.ExecutionState.Executing : Gov.ExecutionState.Rejected;
        } else if (escalationLevel == Gov.ActionEscalation.Nominee) {
            // TODO: for tokens without nominee fallback to THR
            s = initiator == nominee ? Gov.ExecutionState.Executing : Gov.ExecutionState.Rejected;
        } else if (escalationLevel == Gov.ActionEscalation.CompanyOrNominee) {
            s = initiator == company ? Gov.ExecutionState.Executing : Gov.ExecutionState.Rejected;
            if (s == Gov.ExecutionState.Rejected) {
                s = initiator == nominee ? Gov.ExecutionState.Executing : Gov.ExecutionState.Rejected;
            }
        } else {
            // for THR or SHR only legal rep can put into escalation mode
            // for generic resolutions (None) - there's special escalator where token holders can execute
            s = initiator == getActionLegalRep(rep, company, nominee) ? Gov.ExecutionState.Escalating : Gov.ExecutionState.Rejected;
        }
    }


    // defines permission escalation for resolution. based on resolution state, action and current shareholder rights
    // allows, escalates or denies execution.
    function permissionEscalator(
        GovernanceStorage storage g,
        TokenStorage storage t,
        Gov.Action action
    )
        private
        constant
        returns (Gov.ExecutionState s)
    {
        // may be called only in New state
        if (g._state == Gov.State.Setup) {
            if (action == Gov.Action.RegisterOffer) {
                // anyone can register a legitimate offering in setup state
                s = Gov.ExecutionState.Executing;
            } else if (action == Gov.Action.AmendISHA && msg.sender == g.COMPANY_LEGAL_REPRESENTATIVE) {
                // company can start company governance with ISHA
                s = Gov.ExecutionState.Executing;
            } else {
                s = Gov.ExecutionState.Rejected;
            }
        } else {
            // check if voting in voting center even if New state to handle voting in Campaign state
            // if voting is finalized evaluate results against ActionGovernance for action
            // return Rejected if failed, executed if passed, Escalation if ongoing
            Gov.ActionBylaw memory bylaw = deserializeBylaw(t._tokenholderRights.getBylaw(action));
            s = getBylawEscalation(
                bylaw.escalationLevel,
                bylaw.votingLegalRepresentative,
                msg.sender,
                t._token,
                g.COMPANY_LEGAL_REPRESENTATIVE,
                t._nominee
            );
            if (s == Gov.ExecutionState.Escalating) {
                // 1. start voting is campaign mode if msg.sender is equity token holder
                //   (permission escalation into campaign state of voting so voting is not yet official)
                // 2. start voting offically if msg.sender is company or token holder with N% stake
                // 3. for some action legal rep can start without escalation
                return;
            }
        }
    }
}
