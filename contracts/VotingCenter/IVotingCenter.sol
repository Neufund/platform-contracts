pragma solidity 0.4.26;

import "../Standards/ITokenSnapshots.sol";
import "../Standards/IContractId.sol";

// standard methods of VotingCenter contract that governs voting procedures on the whole platform
contract IVotingCenter is IContractId {

    /// @dev Creates a proposal, uniquely identifiable by its assigned proposalId
    /// @param proposalId unique identifier of the proposal, e.g. ipfs-hash of info
    /// @param token a token where balances give voting power to holders
    /// @param campaignDuration duration (s) in which proposal has to gather enough votes to be made public (see campaignQuorum)
    /// @param campaignQuorumFraction fraction (10**18 = 1) of token holders who have to support a proposal in order for it to be trigger an event
    /// @param votingPeriod total duration (s) in which the proposal can be voted on by tokenholders after it was created
    /// @param votingLegalRep a legal representative for the vote, which may provide off-chain voting results
    /// @param offchainVotePeriod duration (s) after voting is ended when voting legal rep may provide results
    /// @param offchainVotingPower voting power (tokens) held offchain and provided by legal rep at the end of voting
    /// @param action initiator defined action code on which voting happens
    /// @param actionPayload initiator defined action payload on which voting happens
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
        public;

    /// @dev increase the voting power on a given proposal by the token balance of the sender
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param proposalId of the proposal to be voted on
    /// @param voteInFavor if true, voting power goes for proposal, if false - against
    function vote(bytes32 proposalId, bool voteInFavor)
        public;

    /// @notice add off-chain votes, inFavor + against may not cross the offchainVotingPower, but may be less
    ///         to reflect abstaining from vote
    /// @param inFavor voting power (expressed in tokens) being in favor of the proposal
    /// @param against voting power (expressed in tokens) being against the proposal
    /// @param documentUri official document with final voting results
    function addOffchainVote(bytes32 proposalId, uint256 inFavor, uint256 against, string documentUri)
        public;


    /// @notice Returns the current tally of a proposal. Only Final proposal have immutable tally
    /// @return the voting power on a finished proposal and the total voting power
    /// @dev please again note that VotingCenter does not say if voting passed in favor or against. it just carries on
    ///      the voting and it's up to initiator to say what is the outcome, see IProposalObserver
    function tally(bytes32 proposalId)
        public
        constant
        returns(
            uint8 s,
            uint256 inFavor,
            uint256 against,
            uint256 offchainInFavor,
            uint256 offchainAgainst,
            uint256 tokenVotingPower,
            uint256 totalVotingPower,
            uint256 campaignQuorumTokenAmount,
            address initiator,
            bool hasObserverInterface
        );

    /// @notice obtains proposal after internal state is updated due to time
    /// @dev    this is the getter you should use
    function timedProposal(bytes32 proposalId)
        public
        constant
        returns (
            uint8 s,
            address token,
            uint256 snapshotId,
            address initiator,
            address votingLegalRep,
            uint256 campaignQuorumTokenAmount,
            uint256 offchainVotingPower,
            uint256 action,
            bytes actionPayload,
            bool enableObserver,
            uint32[5] deadlines
        );

    /// @notice obtains proposal state without time transitions
    /// @dev    used mostly to detect propositions requiring timed transitions
    function proposal(bytes32 proposalId)
        public
        constant
        returns (
            uint8 s,
            address token,
            uint256 snapshotId,
            address initiator,
            address votingLegalRep,
            uint256 campaignQuorumTokenAmount,
            uint256 offchainVotingPower,
            uint256 action,
            bytes actionPayload,
            bool enableObserver,
            uint32[5] deadlines
        );

    /// @notice tells if voter cast a vote for particular proposal
    function isVoteCast(bytes32 proposalId, address voter)
        public
        constant
        returns (bool);

    /// @notice tells if proposal with given id was opened
    function hasProposal(bytes32 proposalId)
        public
        constant
        returns (bool);

}
