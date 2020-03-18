pragma solidity 0.4.26;

import "../../SnapshotToken/Extensions/ISnapshotableToken.sol";
import "../../Math.sol";

/// Contract to allow weighted voting based on a snapshotable token (with relayed, batched voting)
contract VotingCenter is Math{

    ////////////////////////
    // Types
    ////////////////////////
    enum ProposalState {
        Campaigning,  // Initial state
        TimedOut, // has not reached public phase
        Public,  // has passed campaign-quorum in time
        Final  // the total required amount of votes was in favor
    }

    struct Proposal {
        uint256 campaignEndTime;
        uint256 campaignQuorumTokenAmount;
        uint256 endTime;
        uint256 offchainVoteEndTime;
        uint256 inFavor;
        uint256 against;
        address owner;
        uint256 snapshotId;
        uint256 offchainVotesAsTokens;
        bool offchainVoteTallied;
        ProposalState state;
        mapping (address => bool) hasVoted;
    }

    /////////////////////////
    // Immutable state
    ////////////////////////
    // TODO register with universe
    ISnapshotableToken public TOKEN;

    /////////////////////////
    // Mutable state
    ////////////////////////
    mapping (bytes32 => Proposal) private _proposals;
    mapping (address => bool) private _hasActiveProposal;

    /////////////////////////
    // Events
    ////////////////////////
    event LogNewProposal(address indexed owner, bytes32 indexed proposalId, uint256 snapshotId, uint256 endTime);
    event LogReachedCampaignQuorum(bytes32 indexed proposalId);
    event LogProposalResult(bytes32 indexed proposalId, bool valid, uint256 inFavor, uint256 against, uint total);

    ////////////////////////
    // Constructor
    ////////////////////////

    /// @param token which balances are used for voting
    constructor(ISnapshotableToken token) public {
        require(token != address(0), "Invalid Token");
        TOKEN = token;
        // TODO get controller from universe
    }

    /////////////////////////
    // Public functions
    ////////////////////////

    /// @dev Creates a proposal, uniquely identifiable by its assigned proposalId
    /// @param proposalId unique identifier of the proposal, e.g. ipfs-hash of info
    /// @param campaignDurationInDays amount of days proposal has to gather enough votes to be made public (see campaignQuorum)
    /// @param campaignQuorumFraction fraction (10**18 = 1) of token holders who have to support a proposal in order for it to be trigger an event
    /// @param votingPeriodInDays total amount of days the proposal can be voted on by tokenholders after it was created
    /// @param offchainVoteFraction the percentage of all votes held offchain as a decimal fraction (<10**18)
    /// (offchainWeight the percentage of all votes held offchain as decimalFraction
    function addProposal(
        bytes32 proposalId,
        uint256 campaignDurationInDays,
        uint256 campaignQuorumFraction,
        uint256 votingPeriodInDays,
        uint256 offchainVotePeriodInDays,
        uint256 offchainVoteFraction
    )
        public
    {
        require(_proposals[proposalId].endTime == 0, "Proposal must have a unique proposalId");
        require(!_hasActiveProposal[msg.sender], "Only one active proposal per address");
        require(campaignDurationInDays >= 1, "There must be at least one day for campaigning");
        require(campaignQuorumFraction < 10**18, "Quorum for campaing must be nonzero and less than 100");
        require(votingPeriodInDays * 1 days >= 10 days, "Voting period must be at least ten days");
        require(votingPeriodInDays - campaignDurationInDays >= 7, "There must be at least one week for public voting");
        require(
            (offchainVotePeriodInDays >= 7 && offchainVoteFraction > 0) ||
            (offchainVoteFraction == 0 && offchainVotePeriodInDays == 0),
            "OffchainVotePeriod must be at least a week"
        );
        require(offchainVoteFraction <= 10**18, "Offchain votes too powerful");

        uint256 sId = TOKEN.currentSnapshotId();
        // advance snapShotID, so that any subsequent trades will be in the non-finalized snapshot
        TOKEN.createSnapshot();
        uint256 totalTokenVotes = TOKEN.totalSupplyAt(sId);

        _proposals[proposalId] = Proposal({
            campaignEndTime: now + campaignDurationInDays * 1 days,
            campaignQuorumTokenAmount: decimalFraction(totalTokenVotes, campaignQuorumFraction),
            endTime: now + votingPeriodInDays * 1 days,
            offchainVoteEndTime: now + (votingPeriodInDays + offchainVotePeriodInDays) * 1 days,
            inFavor: 0,
            owner: msg.sender,
            against:0,
            snapshotId: sId,
            offchainVotesAsTokens: proportion(totalTokenVotes, offchainVoteFraction, 10**18 - offchainVoteFraction),
            offchainVoteTallied: offchainVoteFraction == 0,
            state: ProposalState.Campaigning
        });

        _hasActiveProposal[msg.sender] = true;

        emit LogNewProposal(msg.sender, proposalId, sId, now + votingPeriodInDays * 1 days);
    }

    /// @notice simple getter function
    function proposal(bytes32 proposalId)
        public
        view
        returns (
            uint256 campaignEndTime,
            uint256 campaignQuorumTokenAmount,
            uint256 endTime,
            uint256 offchainVoteEndTime,
            uint256 inFavor,
            uint256 against,
            address owner,
            uint256 snapshotId,
            uint256 offchainVotesAsTokens,
            bool offchainVoteTallied,
            ProposalState state
            )
    {
        require(_proposals[proposalId].endTime > 0, "Invalid proposalId");
        Proposal storage p = _proposals[proposalId];
        campaignEndTime = p.campaignEndTime;
        campaignQuorumTokenAmount = p.campaignQuorumTokenAmount;
        endTime = p.endTime;
        offchainVoteEndTime = p.offchainVoteEndTime;
        inFavor = p.inFavor;
        against = p.against;
        owner = p.owner;
        snapshotId = p.snapshotId;
        offchainVotesAsTokens = p.offchainVotesAsTokens;
        offchainVoteTallied = p.offchainVoteTallied;
        state = p.state;
    }


    /// @dev increase the votecount on a given proposal by the token balance of the sender
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param proposalId of the proposal to be voted on
    /// @param voteInFavor of the desired proposal
    function vote(bytes32 proposalId, bool voteInFavor) public {
        incrementVote(proposalId, voteInFavor, msg.sender);
    }

    // TODO function addOffchainVote(bytes32, proposalId, uint weightInFavorFraction, uint weightAgainstFraction) public {
    // TODO add access protection
    // NOTE for now its the weight in tokens
    /// @notice add off-chain votes, weight parameters must add up to totalAmount of offchainVotes
    /// @param weightInFavor decimalFraction (10**18 = 1) of offchainVotes being in favor of the proposal
    /// @param weightAgainst decimalFraction of offchainVotes being against the proposal
    function addOffchainVote(bytes32 proposalId, uint weightInFavor, uint weightAgainst) public {
        require(_proposals[proposalId].endTime > 0, "Invalid proposalId");
        Proposal storage p = _proposals[proposalId];
        require(!p.offchainVoteTallied, "Offchain votes already taken into account");
        require(now < p.campaignEndTime || p.state == ProposalState.Public, "Proposal has not passed campaign state");
        require(now < p.offchainVoteEndTime, "Offchain-vote period is over");
        // TODO require weight is correct
        require(weightInFavor + weightAgainst <= 10**18, "Too much weight");

        p.inFavor += decimalFraction(p.offchainVotesAsTokens, weightInFavor);
        p.against += decimalFraction(p.offchainVotesAsTokens, weightAgainst);

        // automatically advance to campaign or call getResult to finalize the vote
        p.offchainVoteTallied = true;
        if (p.state == ProposalState.Campaigning && p.inFavor >= p.campaignQuorumTokenAmount) {
            p.state = ProposalState.Public;
            emit LogReachedCampaignQuorum(proposalId);
        }
        if (now > p.endTime) {
            finalizeProposal(proposalId);
        }
    }

    /// @dev same as vote, only for a relayed vote. Will throw if provided signature (v,r,s) does not match
    ///  the address of the voter
    /// @param voter address whose token balance should be used as voting weight
    function relayedVote(
        bytes32 proposalId,
        bool voteInFavor,
        address voter,
        bytes32 r,
        bytes32 s,
        uint8 v
    )
        public
    {
        // check that message signature matches the voter address
        // solium-disable indentation
        require(ecrecover(
            keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(byte(0), this, proposalId, voteInFavor)))),
            v, r, s) == voter,
        "Incorrect order signature");
        // solium-enable indentation

        incrementVote(proposalId, voteInFavor, voter);
    }

    function batchRelayedVotes(
        bytes32[] proposalIds,
        bool[] votePreferences,
        address[] voters,
        bytes32[] r,
        bytes32[] s,
        uint8[] v
    )
        public
    {
        require(
            proposalIds.length == votePreferences.length &&
            votePreferences.length == voters.length &&
            voters.length == r.length &&
            r.length == s.length &&
            s.length == v.length,
            "Invalid voting arguments"
        );
        for (uint i = 0; i < voters.length; i++) {
            relayedVote(
                proposalIds[i],
                votePreferences[i],
                voters[i],
                r[i],
                s[i],
                v[i]
            );
        }
    }

    /// @notice Returns the final outcome of a proposal that is finalized or can no longer accept any new votes
    /// (timed-out proposals need to be finalized first)
    /// @return the Votecount on a finished proposal and the total amount of eligible votes
    /// @dev throws if proposal does not exist, public vote is still ongoing, offchainVotes could still be submitted or it has failed
    /// during campaign and has not been finalized
    function getOutcome(bytes32 proposalId) public view returns(uint, uint, uint) {
        require(_proposals[proposalId].endTime > 0, "Invalid proposalId");
        Proposal storage p = _proposals[proposalId];
        require(
            p.state == ProposalState.Final || p.state == ProposalState.TimedOut ||
            (now > p.endTime && (p.offchainVoteTallied || now > p.offchainVoteEndTime)),
            "Vote is ongoing"
        );
        // TODO unless the offchain weight is less than max(inFavor, against)

        return (p.inFavor, p.against, TOKEN.totalSupplyAt(p.snapshotId) + p.offchainVotesAsTokens);
    }

    /// @notice log the result of the vote, set the state of the proposal to Final/TimedOut
    /// and unblock creator of proposal to be able to create another one
    function finalizeProposal(bytes32 proposalId) public {
        require(_proposals[proposalId].endTime > 0, "Invalid proposalId");
        Proposal storage p = _proposals[proposalId];
        require(p.state != ProposalState.Final || p.state != ProposalState.TimedOut, "Is already in finalized state");
        require(
            // all voting done OR has failed during campaign
            (now > p.endTime && (p.offchainVoteTallied || now > p.offchainVoteEndTime) ||
            (now > p.campaignEndTime && p.state == ProposalState.Campaigning)),
            "End conditions for vote not fulfilled"
        );

        p.state = p.state == ProposalState.Campaigning ? ProposalState.TimedOut : ProposalState.Final;
        _hasActiveProposal[p.owner] = false;
        uint256 total = TOKEN.totalSupplyAt(p.snapshotId) + p.offchainVotesAsTokens;
        emit LogProposalResult(proposalId, p.state == ProposalState.Final, p.inFavor, p.against, total);
    }

    // function hasPassed(bytes32 proposalId) public pure returns(bool hasPassed){
    //     require(_proposals[proposalId].endTime > 0, "Invalid proposalId");
    //     return _proposals[proposalId].state == ProposalState.Passed;
    // }

    /// @dev increase the votecount on a given proposal by the token balance of a given address,
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param proposalId of the proposal to be voted on
    /// @param voteInFavor of the desired proposal
    /// @param voter address whose tokenBalance is to be used as voting-weight
    function incrementVote(bytes32 proposalId, bool voteInFavor, address voter) internal {
        require(_proposals[proposalId].endTime > 0, "Invalid proposalId");
        Proposal storage p = _proposals[proposalId];
        require(now < p.campaignEndTime || p.state == ProposalState.Public, "Proposal has not passed campaign state");
        require(now < p.endTime, "Public voting period is over");
        require(!p.hasVoted[voter], "Address has already voted");
        uint256 weight = TOKEN.balanceOfAt(voter, p.snapshotId);
        require(weight > 0, "Token balance at proposal time is zero");

        if (voteInFavor) {
            p.inFavor += weight;
            if (p.state == ProposalState.Campaigning && p.inFavor >= p.campaignQuorumTokenAmount) {
                p.state = ProposalState.Public;
                emit LogReachedCampaignQuorum(proposalId);
            }
        } else {
            p.against += weight;
        }
        p.hasVoted[voter] = true;
    }

    
}