pragma solidity 0.4.24;

import "../Universe.sol";
import "../Agreement.sol";
import "../Reclaimable.sol";

import "./IEquityTokenController.sol";
import "./IEquityToken.sol";


/*contract ShareholderResolution {
    // state machine like ETO
    // Setup -> Voting -> Signing -> Protest -> (Yes/No/Protested)
    // executes methods on Company on Yes if outcome defined
}*/

/// @title executes shareholder rigths directly by Nominee
/// several simplifications apply:
///  - there is just one (primary) offering. no more offerings may be executed
///  - token holder votes are not tallied, nominee votes instead
/*
contract NomineeDirectTokenController is {

    // defines state machine of the shareholder resolution
    enum ResolutionState {
        VotingOpen,
        VotingClosed,
        ExecutionPending,
        Executed
    }

    struct Resolution {
        // see enum above
        uint8 state;
        // voting starting block
        uint32 startedTimestamp;
        // results of tokenholders voting
        bool tokensVoteResult;
        // result of company-wide voting tally
        bool finalVoteResult;

        // voting deadline in days
        uint8 VOTING_DURATION_DAYS;
        // default voting rule
        bool IS_POSITIVE_VOTING_RULE;
        // says if resolution has on-chain consequences that will be automatically executed
        uint8 ON_CHAIN_EXECUTION;


        // we ignore quorum in this simple contract
        // uint256 quorumFrac;
        // snaphshotId of snapshot token which will be used to tally
        // uint256 equityTokenSnapshotId;
        // where the document with resolution resides. keccak() is resolution id
        string resolutionDocUrl;
        // RLP encoded payload
        bytes rlpPayload;
    }





    //
    // Implements IEquityTokenController (Token Callable)
    //

    function onCloseToken(address sender)
        public
        constant
        returns (bool)
    {
        // all the pending proceeds were paid
        bool noPendingProceeds = _pendingProceedsEurUlps == 0 && _pendingProceedsEth == 0;
        // resolution had to pass and timeout didn't expire
        uint256 t = block.timestamp;
        bool pendingClosing = _closingResolution != bytes(0) && t < _closingDeadline;

        return noPendingProceeds && pendingClosing;
    }

    //
    // Implements IEquityTokenController (management functions)
    //

    function startResolution(string resolutionUri, ResolutionOnChainAction action, bytes payload)
        public
        onlyState(GovState.Funded)
        onlyCompany
    {
        // todo: check overflows on limited size of voting struct
        // payload must be valid for all types of actions, including possible overflows
        validatePayload(action, payload);
        // initialize

        emit
    }

    // in this simple contract Nominee votes in name of token holders. remove in full implementation
    function nomineeVote(bytes32 resolutionId, bool vote)
        public
        onlyNominee
    {
        closeTokenVoting(resolutionId);
        // must have voting rights
        require(_shareholderRights.GENERAL_VOTING_RULE != VotingRule.NoVotingRights);
        _resolutions[resolutionId].tokensVote = vote;

        // transition state immediately
        resolutionTransitionsTo(_resolutions[resolutionId], ResolutionState.VotingOpen, ResolutionState.VotingClosed);
    }

    // this will count token votes and update state
    function closeTokenVoting(bytes32 resolutionId)
        public
        onlyState(GovState.Funded)
        withResolutionStateTransition(resolutionId);
        withResolutionState(resolutionId, ResolutionState.VotingClosed);
    {
        // no need to do anything
    }

    // company presents final results, official document is optional
    function finalizeResolution(bool finalVote)
        public
        onlyCompany
        onlyState(GovState.Funded)
        withResolutionStateTransition(resolutionId);
        withResolutionStates(resolutionId, ResolutionState.VotingClosed)
    {

    }

    // company presents final results, official document is optional
    function finalizeResolution(bool finalVote)
        public
        onlyCompany
        onlyState(GovState.Funded)
        withResolutionStateTransition(resolutionId);
        withResolutionStates(resolutionId, ResolutionState.ExecutionPending, ResolutionState.Executed)
    {

    }

    // faction of company equity token holders have, important for voting
    function tokenShareholdingFrac()
        public
        onlyState(GovState.Funded)
        constant
        returns (uint256)
    {

    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Internal Interface
    //

    function mRegisterTokenOffering(IETOCommitment etoCommitment, IEquityToken equityToken)
        internal
    {
        // this is simple controller that can do offering only once
        require(ETO_COMMITMENT == address(0), "NDT_ONE_OFFER");

        ETO_COMMITMENT = eto;
        EQUITY_TOKEN = et;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function advanceResolutionTimedState(uint256 resolutionId)
        private
    {
        uint256 t = block.timestamp;
        ShareholderResolution storage resolution = _resolutions[resolutionId];
        ResolutionState state = ResolutionState(resolution.state);
        if (state == ResolutionState.VotingOpen && t >= resolution.started + resolution.VOTING_DURATION_DAYS * 1 days) {
            resolutionTransitionsTo(resolution, GovState.VotingClosed);
        }
        if (state == ResolutionState.VotingClosed && t >= resolution.started + resolution.RESOLUTION_DURATION_DAYS * 1 days) {
            resolutionTransitionsTo(resolution, GovState.ExecutionPending);
        }
        // this state transitions immediately
        if (state == GovState.ExecutionPending) {
            resolutionTransitionsTo(resolution, GovState.Executed);
        }
    }

    function resolutionTransitionsTo(ShareholderResolution storage resolution, ResolutionState state, ResolutionState newState)
        private
    {
        require(isValidResolutionTransition(state, newState));
        if (newState == GovState.VotingClosed) {
            emit LogShareholderResolutionTokensVoted(resolutionId, tokenShareholdingFrac(), vote);
        }
        if (newState = GovState.ExecutionPending) {
            ResolutionOnChainAction action = ResolutionOnChainAction(resolution.ON_CHAIN_ACTION);
            if (action != ResolutionOnChainAction.None) {
                executeResolution(resolution, action)
            }
        }
        // change state
        _resolutions[resolutionId].resolutionState = uint(newState);
    }


    // implement simple state machine (Setup, PrimaryOffering, Funded, Closed)
    // is every EquityToken controller!
    // uint256 totalShares;
    // ShareholderRigths SHAREHOLDER_RIGHTS
    // amendAgreement(new links, new ShareholderRigths) onlyResolution
    // EquityToken[] - list of emitted equity tokens
    // ETO[] - list of ETOs that generated tokens
    // register_resolution(type, bytes payload) onlyCompanyRep onlyNominee
    // pay_dividend(amount) onlyCompanyRep
    // enableTrading(token, bool) onlyResolution
    // increaseShares(amount) onlyResolution
    // decreaseShares(amount) onlyResolution
    // downround(token, amount) onlyNominee -> to distribute downround shares to investors of particular token
    // damages(token, amount) onlyNominee -> to distribure damages (tokens or money)
    // exit(amount, timeout) onlyResolution
    // tag(amount, timeout) onlyResolution
    // eto(ETOCommitment, EquityToken) -> when passed, registers new token and new ETO as pending
    // register_token(ETOCommitment, EquityToken) onlyETO -> on successful ETO, ETO will call Company contract to add itself, calls amendAgreement
    // first_eto(ETOCommitment, EquityToken) onlyCompany
    // register_report(ipfs_hash) -> information rights
    // issueTokens onlyETO
}
*/
