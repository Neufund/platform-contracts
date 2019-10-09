pragma solidity 0.4.26;

import "./ISnapshotableToken.sol";
/* import "../../Math.sol"; */

/// Contract to allow weighted voting based on a snapshotable token (with relayed, batched voting)
contract SimpleVote {

    ////////////////////////
    // Types
    ////////////////////////
    struct Proposal {
        uint256 inFavor;
        uint256 against;
        uint256 endTime;
        address owner;
        uint256 snapshotId;
        mapping (address => bool) hasVoted;
    }

    /////////////////////////
    // Immutable state
    ////////////////////////
    ISnapshotableToken public TOKEN;
    // % of tokens to participate in a voting to make it valid
    uint256 public QUORUM = 40;
    uint256 public VOTING_PERIOD;

    /////////////////////////
    // Mutable state
    ////////////////////////
    mapping (uint256 => Proposal) private _proposals;
    mapping (address => bool) private _hasActiveProposal;
    uint256 private _nextProposalId;

    /////////////////////////
    // Events
    ////////////////////////
    event LogNewProposal(address indexed owner, uint256 indexed proposalId, uint256 snapshotId, uint256 endTime);
    event LogProposalResult(uint256 indexed proposalId, bool hasPassed, uint256 inFavor, uint256 against);

    ////////////////////////
    // Constructor
    ////////////////////////

    /// @param token which balances are used for voting
    /// @param votingPeriodInDays amount of days that each vote will take
    constructor(
        ISnapshotableToken token,
        uint256 votingPeriodInDays
    )
        public
    {
        VOTING_PERIOD = votingPeriodInDays * 1 days;
        TOKEN = token;
    }

    /////////////////////////
    // Public functions
    ////////////////////////

    /// @dev Creates a proposal, uniquely identifiable by its assigned proposalId
    function addProposal() public {
        require(!_hasActiveProposal[msg.sender], "Only one active proposal per address");

        uint256 sId = TOKEN.currentSnapshotId();
        // advance snapShotID, so that any subsequent trades will be in the non-finalized snapshot
        TOKEN.createSnapshot();

        _proposals[_nextProposalId++] = Proposal({
            inFavor: 0,
            against:0,
            endTime: now + VOTING_PERIOD,
            owner: msg.sender,
            snapshotId: sId
        });

        _hasActiveProposal[msg.sender] = true;

        emit LogNewProposal(msg.sender, _nextProposalId - 1, sId, now + VOTING_PERIOD);
    }

    /// @dev increase the votecount on a given proposal by the token balance of the sender
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param proposalId of the proposal to be voted on
    /// @param voteInFavor of the desired proposal
    function vote(uint256 proposalId, bool voteInFavor) public {
        incrementVote(proposalId, voteInFavor, msg.sender);
    }

    /// @dev same as vote, only for a relayed vote. Will throw if provided signature (v,r,s) does not match
    ///  the address of the voter
    /// @param voter address whose token balance should be used as voting weight
    function relayedVote(
        uint256 proposalId,
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
        uint256[] proposalIndices,
        bool[] votePreferences,
        address[] voters,
        bytes32[] r,
        bytes32[] s,
        uint8[] v
    )
        public
    {
        require(
            proposalIndices.length == votePreferences.length &&
            votePreferences.length == voters.length &&
            voters.length == r.length &&
            r.length == s.length &&
            s.length == v.length,
            "Invalid voting arguments"
        );
        for (uint i = 0; i < voters.length; i++) {
            relayedVote(
                proposalIndices[i],
                votePreferences[i],
                voters[i],
                r[i],
                s[i],
                v[i]
            );
        }
    }

    /// @return whether the vote on a proposal has passed, if false this could be because it was rejected or
    ///   because the quorum was not reached.
    /// @dev throws if vote is still ongoing or proposal does not exist. Also deletes the proposalData to free up gas.
    //     Therefore subsequent attempts to call this function will throw too
    function getResult(uint256 proposalId) public {
        require(proposalId < _nextProposalId, "Invalid proposal ID");
        Proposal storage p = _proposals[proposalId];
        require(p.owner != address(0), "Proposal was already deleted");
        require(p.endTime < now, "Voting period is not over");

        uint256 minParticipation = TOKEN.totalSupplyAt(p.snapshotId) * 40 / 100;
        bool passedQuorum = p.inFavor + p.against > minParticipation;
        bool hasPassed = passedQuorum && p.inFavor > p.against;
        _hasActiveProposal[_proposals[proposalId].owner] = false;

        emit LogProposalResult(proposalId, hasPassed, p.inFavor, p.against);

        delete _proposals[proposalId];
    }

    /// @dev increase the votecount on a given proposal by the token balance of a given address,
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param proposalId of the proposal to be voted on
    /// @param voteInFavor of the desired proposal
    /// @param voter address whose tokenBalance is to be used as voting-weight
    function incrementVote(uint256 proposalId, bool voteInFavor, address voter) internal {
        require(proposalId < _nextProposalId, "Invalid proposal ID");
        Proposal storage p = _proposals[proposalId];
        require(p.endTime > now, "Voting period is over");
        require(!p.hasVoted[voter], "Address has already voted");
        uint256 weight = TOKEN.balanceOfAt(voter, p.snapshotId);
        require(weight > 0, "Token balance at proposal time is zero");

        if (voteInFavor) {
            p.inFavor += weight;
        } else {
            p.against += weight;
        }
        p.hasVoted[voter] = true;
    }


}
