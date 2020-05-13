pragma solidity 0.4.26;

import "../VotingCenter/IVotingObserver.sol";
import "../VotingCenter/IVotingCenter.sol";
import "../VotingCenter/VotingProposal.sol";


contract TestVotingObserver is IVotingObserver {

    /////////////////////////
    // Immutable State
    ////////////////////////

    IVotingCenter private VOTING_CENTER;

    /////////////////////////
    // Mutable State
    ////////////////////////

    bool private _isFailing;

    /////////////////////////
    // Events
    ////////////////////////

    event LogTestProposalTransition(
        bytes32 proposalId,
        uint8 oldState,
        uint8 newState
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IVotingCenter votingCenter) public {
        VOTING_CENTER = votingCenter;
    }

    /////////////////////////
    // Public functions
    ////////////////////////

    //
    // Implements IVotingObserver
    //

    function onProposalStateTransition(
        bytes32 proposalId,
        uint8 oldState,
        uint8 newState)
        public
    {
        // fail on demand
        require(!_isFailing);
        // otherwise emit confirmation event
        emit LogTestProposalTransition(proposalId, oldState, newState);
    }

    function votingResult(address /*votingCenter*/, bytes32 proposalId)
        public
        constant
        returns (bool)
    {
        (
            uint8 s,
            uint256 inFavor,
            uint256 against,
            uint256 offchainInFavor,
            uint256 offchainAgainst,
            uint256 totalVotingPower,,) = VOTING_CENTER.tally(proposalId);
        require(s == uint8(VotingProposal.State.Final), "NF_TEST_NOT_FINAL");
        // quorum 50%, round down on division
        if (Math.mul(inFavor + against + offchainInFavor + offchainAgainst, 10**18) / totalVotingPower >= 5*10**17) {
            // majority 50% voting
            return inFavor + offchainInFavor > against + offchainAgainst;
        }
        return false;
    }

    //
    // Mock Methods
    //

    function _failCallback(bool isFailing) public {
        _isFailing = isFailing;
    }

    function addProposal(
        bytes32 proposalId,
        ITokenSnapshots token,
        uint32 campaignDuration,
        uint256 campaignQuorumFraction,
        uint32 votingPeriod,
        address votingLegalRep,
        uint32 offchainVotePeriod,
        uint256 offchainVotingPower,
        uint256 action,
        bytes actionPayload,
        bool enableObserver
    )
        public
    {
        VOTING_CENTER.addProposal(
            proposalId,
            token,
            campaignDuration,
            campaignQuorumFraction,
            votingPeriod,
            votingLegalRep,
            offchainVotePeriod,
            offchainVotingPower,
            action,
            actionPayload,
            enableObserver
        );
    }
}
