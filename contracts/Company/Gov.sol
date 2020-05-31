pragma solidity 0.4.26;

import "../Universe.sol";
import "../Math.sol";
import "../VotingCenter/IVotingCenter.sol";
import "../VotingCenter/VotingProposal.sol";
import "./IEquityToken.sol";
import "../Deprecations/IEquityToken_v0.sol";
import "./ITokenholderRights.sol";
import "../ETO/IETOCommitment.sol";


library Gov {

    ////////////////////////
    // Constants
    ////////////////////////

    // no access to constants from library
    // Voting Center keccak256("IVotingCenter")
    bytes4 internal constant KNOWN_INTERFACE_VOTING_CENTER = 0xff5dbb18;

    // allows to change known interfaces in universe kecckak256("UniverseManager")
    bytes32 internal constant ROLE_UNIVERSE_MANAGER = 0xe8d8f8f9ea4b19a5a4368dbdace17ad71a69aadeb6250e54c7b4c7b446301738;

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

    // governance actions available in setup state
    enum SetupAction {
        // no on-chain action on resolution, default bylaw with voting initative
        None,
        // start new token offering
        RegisterOffer,
        // for example off-chain investment (agreement url, new number of shares, new shareholder rights, new valuation eur, new authorized capital)
        AmendGovernance
    }

    // general governance actions
    /// @dev must start with SetupAction
    enum Action {
        None,
        RegisterOffer,
        AmendGovernance,
        // no on-chain action on resolution, restricted act bylaw
        RestrictedNone,
        // general information from the company
        CompanyNone,
        // token holder resolution without on-chain action, with voting initative
        THRNone,
        // blocks transfers
        StopToken,
        // enables transfers
        ContinueToken,
        // requires change of control resolution/dissolution to be in executing state
        // on entering executing state will stop token
        // will be completed on payout of certain amount of nEUR
        CloseToken,
        OrdinaryPayout, // any scheduled or expected payout initiated by company legal rep
        ExtraordinaryPayout, // a payout that requires resolution to pass
        ChangeTokenController, // (new token controller)
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
        CancelResolution
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
        // represented off-chain by company
        CompanyLegalRep,
        // represented off-chain by nominee
        Nominee
    }

    // 56 bit length
    struct ActionBylaw {
        // permission level (any token holder, company legal rep, nominee, company or legal rep, token holders, share holders, parent resolution)
        ActionEscalation escalationLevel;
        // voting period in seconds
        uint8 votingPeriodDays;
        // voting rule for shareholders is always prorata to voting capital
        // voting quorum percent, equals minimal voting power cast to total voting power for vote to count (50 for 50%)
        uint8 votingQuorumPercent;
        // absolute majority percent, more than this % of votes cast is required for resolution to pass (50 for 50%)
        uint8 votingMajorityPercent;
        // majority voting power - specific voting power required to pass
        // if not 0 voting quorum and majority will be ignored
        uint8 absoluteMajorityPercent;
        // voting rule for token holders
        // absolute majority (veto power) or prorata
        TokenVotingRule votingRule;
        // off chain rep of the voting (none, nominee, company legal rep)
        ActionLegalRep votingLegalRepresentative;
        // initiator of the voting
        ActionLegalRep votingInitiator;
        // resolution initiative for token holders
        bool withTokenholderResolutionInitiative;
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
        uint8 action; // 8-bit
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
        State  _state;

        // resolutions being executed
        mapping (bytes32 => ResolutionExecution) _resolutions;
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
        ITokenholderRights _tokenholderRights;
        // nominee address
        address _nominee;
        // quantum in which token may be created and destroyed, typically tokens per share
        uint256 _quantumUlps;
        // total voting power expressed in tokens, typically computed from shared capital
        uint256 _totalVotingPower;
    }

    ///////////////////////////
    // Delegate Library Methods
    ///////////////////////////

    // used by governance engine to advance resolution from New -> Escalating -> Executing state
    function startResolutionExecution(
        GovernanceStorage storage g,
        TokenStorage storage t,
        bytes32 resolutionId,
        uint8 action,
        bytes payload
    )
        public
        returns (ExecutionState prevState, ExecutionState nextState)
    {
        // executor checks resolutionId state
        ResolutionExecution storage e = g._resolutions[resolutionId];
        prevState = e.state;
        require(prevState == ExecutionState.New || prevState == ExecutionState.Escalating);

        // save new state which may be Executing or Escalating
        if (prevState == ExecutionState.New) {
            // try to escalate to execution state
            if (g._state == State.Setup) {
                // in setup we suport a subset of Actions
                nextState = escalateNewResolutionInSetup(g, SetupAction(action));
            } else {
                nextState = escalateNewResolution(g, t, resolutionId, action, payload);
            }
            // if New is returned, voting will be in campaign state and must be escalated further
            // for resolution to be created
            if (nextState == ExecutionState.New) {
                return;
            }
            // escalator may deny access to action
            require(nextState != ExecutionState.Rejected, "NF_GOV_EXEC_ACCESS_DENIED");
            // save new execution
            e.action = action;
            e.state = nextState;
            e.startedAt = uint32(now);
            // use calldata as promise
            e.promise = keccak256(payload);
            // we should use tx.hash as resolutionId, it's however not available in EVM
            // that could give us access to msg.data at all times making subsequenct calls to
            // push execution forward easier
            g._resolutionIds.push(resolutionId);
        } else {
            // must be escalating: check voting results in voting center
            IVotingCenter vc = getVotingCenter(g.UNIVERSE);
            ActionBylaw memory bylaw = deserializeBylaw(t._tokenholderRights.getBylaw(action));
            nextState = evaluateProposal(vc, resolutionId, bylaw);
            // write executing/rejected state
            e.state = nextState;
            if (nextState == ExecutionState.Rejected) {
                // emit event in caller
                e.finishedAt = uint32(now);
            }
        }
    }

    function hasProposalPassed(TokenStorage storage t, IVotingCenter vc, bytes32 resolutionId)
        public
        constant
        returns (ExecutionState state)
    {
        (uint8 s,,,,,,,uint256 action,,,) = vc.timedProposal(resolutionId);
        ActionBylaw memory bylaw = deserializeBylaw(t._tokenholderRights.getBylaw(uint8(action)));
        require(s == uint8(VotingProposal.State.Final), "NF_GOV_VOTING_NOT_FINAL");
        return hasProposalPassed(vc, resolutionId, bylaw);
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
        require(nomineOffering == nomineeToken, "NF_NDT_NOMINEE_MISMATCH");
        // require terms set and legalRep match
        require(tokenOffering.etoTerms() != address(0), "NF_NDT_NO_TERMS");
        require(tokenOffering.companyLegalRep() == company, "NF_NDT_COMPANY_MISMATCH");
        // secondary offering must be on the same token
        require(token == address(0) || equityToken == token, "NF_NDT_FUNDRAISE_NOT_SAME_TOKEN");
    }

    function installTokenFromETO(TokenStorage storage t, IETOCommitment tokenOffering)
        public
    {
        // get token data and put into the storage
        IEquityToken equityToken = tokenOffering.equityToken();
        ITokenholderRights tokenholderRights = tokenOffering.etoTerms().TOKENHOLDER_RIGHTS();
        bool transferable = tokenOffering.etoTerms().ENABLE_TRANSFERS_ON_SUCCESS();

        setToken(t, equityToken, TokenType.Equity, TokenState.Open, tokenholderRights, transferable);
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
            for { let i := 0 } lt(i, 7) { i := add(i, 1) }
                // store a byte 32 - i into 32 byte offset with number i, starting from decodedBylaw
                // mind that uint56 is internal Solidity construct, it occupies whole word (see `byte`)
                { mstore(add(decodedBylaw, mul(32,i)), byte(add(25, i), bylaw)) }
            // 6th element contains 3 flags encoded that describe voting rights
            let vrules :=  mload(add(decodedBylaw, 192))
            // set voting initator
            mstore(add(decodedBylaw, 224), div(and(vrules, 0x38), 8))
            // set initiative flag
            mstore(add(decodedBylaw, 256), div(and(vrules, 0x40), 64))
            // set voting legal rep
            mstore(add(decodedBylaw, 192), and(vrules, 7))
        }
    }

    function setToken(
        TokenStorage storage t,
        IControlledToken token,
        TokenType tokenType,
        TokenState state,
        ITokenholderRights rights,
        bool transfersEnabled
    )
        internal
    {
        t._type = tokenType;
        t._state = state;
        t._transferable = transfersEnabled;
        t._token = token;
        t._tokenholderRights = rights;

        if (tokenType == TokenType.Equity) {
            setAdditionalEquityTokenData(t, IEquityToken(token));
        }
    }

    function setAdditionalEquityTokenData(TokenStorage storage t, IEquityToken token)
        internal
    {
        t._nominee = getNominee(token);
        t._quantumUlps = token.tokensPerShare();
    }

    function setEquityTokenTotalVotingPower(TokenStorage storage t, IEquityToken token, uint256 shareCapital)
        internal
    {
        (,uint256 version) = token.contractId();
        if (version > 0) {
            t._totalVotingPower = t._quantumUlps * shareCapital / token.shareNominalValueUlps();
        } else {
            t._totalVotingPower = t._quantumUlps * shareCapital / IEquityToken_v0(token).shareNominalValueEurUlps();
        }
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

    function getActionLegalRep(ActionLegalRep rep, address company, address nominee)
        private
        pure
        returns (address)
    {
        if (rep == ActionLegalRep.CompanyLegalRep) {
            return company;
        } else if (rep == ActionLegalRep.Nominee) {
            return nominee;
        }
        return address(0);
    }

    function requiresVoting(ActionEscalation escalationLevel)
        private
        pure
        returns (bool)
    {
        return escalationLevel == ActionEscalation.SHR || escalationLevel == ActionEscalation.THR;
    }

    // figure out what right initator has for given escalation level in bylaw of particular action
    function getNonVotingBylawEscalation(
        ActionEscalation escalationLevel,
        address initiator,
        IControlledToken token,
        address company,
        address nominee
    )
        private
        constant
        returns (ExecutionState s)
    {
        if (escalationLevel == ActionEscalation.Anyone) {
            s = ExecutionState.Executing;
        } else if (escalationLevel == ActionEscalation.TokenHolder) {
            // must be a relevant token holder
            s = isTokenHolder(token, initiator) ? ExecutionState.Executing : ExecutionState.Rejected;
        } else if (escalationLevel == ActionEscalation.CompanyLegalRep) {
            s = initiator == company ? ExecutionState.Executing : ExecutionState.Rejected;
        } else if (escalationLevel == ActionEscalation.Nominee) {
            // for tokens without nominee this will be always rejected
            s = initiator == nominee ? ExecutionState.Executing : ExecutionState.Rejected;
        } else if (escalationLevel == ActionEscalation.CompanyOrNominee) {
            s = initiator == company ? ExecutionState.Executing : ExecutionState.Rejected;
            if (s == ExecutionState.Rejected) {
                s = initiator == nominee ? ExecutionState.Executing : ExecutionState.Rejected;
            }
        } else {
            revert();
        }
    }

    function getVotingBylawEscalation(
        TokenVotingRule votingRule,
        ActionLegalRep votingInitiator,
        address initiator,
        IControlledToken token,
        address company,
        address nominee,
        bool tokenholderInitiative
    )
        private
        constant
        returns (ExecutionState s)
    {
        address expectedInitator = getActionLegalRep(votingInitiator, company, nominee);

        if (votingRule == TokenVotingRule.NoVotingRights) {
            // if token holders do not have voting rights, voting initator may execute action
            s = initiator == expectedInitator ? ExecutionState.Executing : ExecutionState.Rejected;
        } else {
            require(address(token) != address(0), "NF_GOV_NO_GOVERNANCE_TOKEN");
            if (initiator == expectedInitator) {
                // voting initator may start voting
                s = ExecutionState.Escalating;
            } else {
                // token holders have resolution initative
                if (tokenholderInitiative && isTokenHolder(token, initiator)) {
                    // return New to indicate Campaign voting
                    s = ExecutionState.New;
                } else {
                    s = ExecutionState.Rejected;
                }
            }
        }
    }

    function escalateNewResolutionInSetup(GovernanceStorage storage g, SetupAction action)
        private
        returns (ExecutionState)
    {
        address companyLegalRep = g.COMPANY_LEGAL_REPRESENTATIVE;
        // may be called only in New state
        if (action == SetupAction.RegisterOffer && (msg.sender == companyLegalRep || isUniverseManager(g.UNIVERSE, msg.sender))) {
            // anyone can register a legitimate offering in setup state
            return ExecutionState.Executing;
        } else if (action == SetupAction.AmendGovernance && msg.sender == companyLegalRep) {
            // company can start company governance with ISHA
            return ExecutionState.Executing;
        }
        // any other action type will be rejected
        return ExecutionState.Rejected;
    }

    // defines permission escalation for resolution. based on resolution state, action and current shareholder rights
    // allows, escalates or denies execution.
    function escalateNewResolution(
        GovernanceStorage storage g,
        TokenStorage storage t,
        bytes32 resolutionId,
        uint8 action,
        bytes payload
    )
        private
        returns (ExecutionState s)
    {
        // may be called only in New state
        ActionBylaw memory bylaw = deserializeBylaw(t._tokenholderRights.getBylaw(action));
        IVotingCenter vc;
        if (requiresVoting(bylaw.escalationLevel)) {
            // check if voting in voting center even if New state to handle voting in Campaign state
            if (bylaw.withTokenholderResolutionInitiative) {
                // if voting is finalized evaluate results against bylaw
                vc = getVotingCenter(g.UNIVERSE);
                if (vc.hasProposal(resolutionId)) {
                    return evaluateProposal(vc, resolutionId, bylaw);
                }
            }
            // there's no voting going on - do usual escalation
            s = getVotingBylawEscalation(
                bylaw.votingRule,
                bylaw.votingInitiator,
                msg.sender,
                t._token,
                g.COMPANY_LEGAL_REPRESENTATIVE,
                t._nominee,
                bylaw.withTokenholderResolutionInitiative
            );
            address votingLegalRep;
            if (s == ExecutionState.Escalating) {
                // start voting in public phase
                vc = getVotingCenter(g.UNIVERSE);
                votingLegalRep = getActionLegalRep(bylaw.votingLegalRepresentative, g.COMPANY_LEGAL_REPRESENTATIVE, t._nominee);
                openProposal(
                    t,
                    vc,
                    resolutionId,
                    action,
                    payload,
                    votingLegalRep,
                    bylaw
                );
            }
            if (s == ExecutionState.New) {
                // start voting in campaign state
                vc = getVotingCenter(g.UNIVERSE);
                votingLegalRep = getActionLegalRep(bylaw.votingLegalRepresentative, g.COMPANY_LEGAL_REPRESENTATIVE, t._nominee);
                openCampaignProposal(
                    t,
                    vc,
                    resolutionId,
                    action,
                    payload,
                    votingLegalRep,
                    bylaw
                );
            }

        } else {
            s = getNonVotingBylawEscalation(
                bylaw.escalationLevel,
                msg.sender,
                t._token,
                g.COMPANY_LEGAL_REPRESENTATIVE,
                t._nominee
            );
        }
    }

    function openProposal(
        TokenStorage storage t,
        IVotingCenter vc,
        bytes32 resolutionId,
        uint8 action,
        bytes payload,
        address votingLegalRep,
        ActionBylaw memory bylaw
    )
        private
    {
        vc.addProposal(
            resolutionId,
            t._token,
            0,
            0,
            bylaw.votingPeriodDays * 1 days,
            votingLegalRep,
            votingLegalRep != address(0) ? uint32(bylaw.votingPeriodDays * 1 days) : 0,
            votingLegalRep != address(0) ? t._totalVotingPower : 0,
            uint256(action),
            payload,
            false
        );
    }

    function openCampaignProposal(
        TokenStorage storage t,
        IVotingCenter vc,
        bytes32 resolutionId,
        uint8 action,
        bytes payload,
        address votingLegalRep,
        ActionBylaw memory bylaw
    )
        private
    {
        vc.addProposal(
            resolutionId,
            t._token,
            bylaw.votingPeriodDays * 1 days,
            votingInitativeThresholdFrac(bylaw),
            2 * bylaw.votingPeriodDays * 1 days,
            votingLegalRep,
            votingLegalRep != address(0) ? uint32(bylaw.votingPeriodDays * 1 days) : 0,
            votingLegalRep != address(0) ? t._totalVotingPower : 0,
            uint256(action),
            payload,
            false
        );
    }

    function evaluateProposal(IVotingCenter vc, bytes32 resolutionId, ActionBylaw memory bylaw)
        private
        constant
        returns (ExecutionState state)
    {
        (
            uint8 s,
            uint256 inFavor,
            uint256 against,
            ,
            ,
            ,
            ,
            uint256 campaignQuorumTokenAmount,
            ,
        ) = vc.tally(resolutionId);

        if (s == uint8(VotingProposal.State.Campaigning)) {
            // still new
            return ExecutionState.New;
        } else if (s == uint8(VotingProposal.State.Final)) {
            // make sure that campaign quorum was crossed
            if (campaignQuorumTokenAmount > 0 && campaignQuorumTokenAmount > inFavor + against) {
                return ExecutionState.Rejected;
            }
            // in final state use tally to check if proposal passed
            return hasProposalPassed(vc, resolutionId, bylaw);
        } else {
            return ExecutionState.Escalating;
        }
    }

    function hasProposalPassed(IVotingCenter vc, bytes32 resolutionId, ActionBylaw memory bylaw)
        private
        constant
        returns (ExecutionState state)
    {
        // we call tally again because of stack too deep which could not be avoided
        // without making structure of calls worse (at least for now)
        (
            ,
            uint256 inFavor,
            uint256 against,
            uint256 offchainInFavor,
            uint256 offchainAgainst,
            uint256 tokenVotingPower,
            uint256 totalVotingPower,
            ,
            ,
        ) = vc.tally(resolutionId);
        return hasProposalPassed(inFavor, against, offchainInFavor, offchainAgainst, tokenVotingPower, totalVotingPower, bylaw);
    }

    function hasProposalPassed(
        uint256 inFavor,
        uint256 against,
        uint256 offchainInFavor,
        uint256 offchainAgainst,
        uint256 tokenVotingPower,
        uint256 totalVotingPower,
        ActionBylaw memory bylaw
    )
        internal
        pure
        returns (ExecutionState state)
    {
        uint256 pro;
        uint256 contra;

        // assign token voting according to voting rule
        if (bylaw.votingRule == TokenVotingRule.Positive) {
            // absolute majority of token voting power must be no, otherwise whole token voting power yes
            if (2 * against > tokenVotingPower) {
                contra = tokenVotingPower;
            } else {
                pro = tokenVotingPower;
            }
        } else if (bylaw.votingRule == TokenVotingRule.Negative) {
            // absolute majority of token voting power must be yes, otherwise whole token voting power no
            if (2 * inFavor > tokenVotingPower) {
                pro = tokenVotingPower;
            } else {
                contra = tokenVotingPower;
            }
        } else if (bylaw.votingRule == TokenVotingRule.Prorata) {
            // classical tally
            pro = inFavor;
            contra = against;
        }
        // absolute majority procedure
        if (bylaw.absoluteMajorityPercent > 0) {
            uint256 absoluteMajorityFrac = percentToFrac(bylaw.absoluteMajorityPercent);
            if (Math.mul(pro + offchainInFavor, 10**18) / totalVotingPower > absoluteMajorityFrac) {
                return ExecutionState.Executing;
            } else {
                return ExecutionState.Rejected;
            }
        }

        // quorum + majority procedure
        uint256 quorumFrac = percentToFrac(bylaw.votingQuorumPercent);
        uint256 totalPowerCast = pro + contra + offchainInFavor + offchainAgainst;
        /// must have quorum at minimum
        if (Math.mul(totalPowerCast, 10**18) / totalVotingPower >= quorumFrac) {
            uint256 majorityFrac = percentToFrac(bylaw.votingMajorityPercent);
            // must have more than majority (simple majority)
            if (Math.mul(pro + offchainInFavor, 10**18) / totalPowerCast > majorityFrac) {
                return ExecutionState.Executing;
            } else {
                return ExecutionState.Rejected;
            }
        } else {
            return ExecutionState.Rejected;
        }
    }

    function campaignQuorumPassed(IVotingCenter vc, bytes32 resolutionId, uint256 actualVotingPower)
        private
        constant
        returns (bool)
    {
        (,,,,,uint256 campaignQuorumTokenAmount,,,,,) = vc.proposal(resolutionId);
        return actualVotingPower >= campaignQuorumTokenAmount;
    }

    /// @notice converts percent encoded as integer binary without any scale into
    ///         standard decimal fraction
    function percentToFrac(uint8 percent)
        private
        pure
        returns (uint256)
    {
        // 100% is Q18
        return 10**16 * uint256(percent);
    }

    /// @notice computes minimum absolute majority to pass decision which is simple majority of the quorum
    function votingInitativeThresholdFrac(ActionBylaw memory bylaw)
        private
        pure
        returns (uint256)
    {
        // TODO: tokenholder voting initative should be part of the bylaw, in case of absoluteMajorityPercent present
        // value of 0 will be returned (providing votingQuorumPercent and votingMajorityPercent are 0) and campaign will fail
        // as we go from uint8 this will never overflow
        return percentToFrac(bylaw.votingQuorumPercent) * percentToFrac(bylaw.votingMajorityPercent) / 10**18;
    }

    function getVotingCenter(Universe u)
        private
        constant
        returns (IVotingCenter)
    {
        return IVotingCenter(u.getSingleton(KNOWN_INTERFACE_VOTING_CENTER));
    }

    function isUniverseManager(Universe u, address sender)
        private
        returns (bool)
    {
        return u.accessPolicy().allowed(sender, ROLE_UNIVERSE_MANAGER, address(u), msg.sig);
    }

}
