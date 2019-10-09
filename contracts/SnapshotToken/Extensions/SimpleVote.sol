pragma solidity 0.4.26;

import "./ISnapshotableToken.sol";
/* import "../../Math.sol"; */

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
    uint256 private VOTING_PERIOD;
    ISnapshotableToken private TOKEN;
    // % of tokens to participate in a voting to make it valid
    uint256 QUORUM = 40;

    /////////////////////////
    // Mutable state
    ////////////////////////
    Proposal[] private _proposals;
    mapping (address => bool) private _hasActiveProposal;

    /////////////////////////
    // Events
    ////////////////////////
    event LogNewProposal(address indexed owner, uint256 indexed proposalIndex, uint256 snapshotId, uint256 endTime);
    event LogProposalResult(uint256 indexed proposalIndex, bool hasPassed, uint256 inFavor, uint256 against);

    ////////////////////////
    // Constructor
    ////////////////////////

    /// @param votingPeriodInDays amount of days that each vote will take
    /// @param token which balances are used for voting
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

    /// @dev Creates a proposal that will end VOTING_PERIOD days from now
    function addProposal() public {
        require(!_hasActiveProposal[msg.sender]);

        uint256 sId = TOKEN.currentSnapshotId();
        // advance snapShotID, so that any subsequent trades will be in the non-finalized snapshot
        TOKEN.createSnapshot();

        _proposals.push(
            Proposal({
                inFavor: 0,
                against:0,
                endTime: now + VOTING_PERIOD,
                owner: msg.sender,
                snapshotId: sId
            })
        );
        _hasActiveProposal[msg.sender] = true;

        emit LogNewProposal(msg.sender, _proposals.length - 1, sId, now + VOTING_PERIOD);

    }

    /// @dev increase the votecount on a given proposal by the token balance of the sender
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param proposalIndex of the proposal to be voted on
    /// @param voteInFavor of the desired proposal
    function vote(uint256 proposalIndex, bool voteInFavor) public {
        incrementVote(proposalIndex, voteInFavor, msg.sender);
    }

    /// @dev same as vote, only for a relayed vote. Will throw if provided signature (v,r,s) does not match
    ///  the address of the voter
    /// @param voter address whose token balance should be used as voting weight
    function relayedVote(
        uint256 proposalIndex,
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
                keccak256(abi.encodePacked(byte(0), this, proposalIndex, voteInFavor)))),
            v, r, s) == voter,
        "incorrect order signature");
        // solium-enable indentation

        incrementVote(proposalIndex, voteInFavor, voter);
    }

    /// @return whether the vote on a proposal has passed, if false this could be because it was rejected or
    ///   because the quorum was not reached.
    /// @dev throws if vote is still ongoing or proposal does not exist
    function getResult(uint256 proposalIndex) public {
        require(proposalIndex < _proposals.length, "Invalid proposal index");
        Proposal storage p = _proposals[proposalIndex];
        require(p.endTime < now, "Voting period is not over");

        uint256 minParticipation = TOKEN.totalSupplyAt(p.snapshotId) * 40 / 100;
        bool passedQuorum = p.inFavor + p.against > minParticipation;
        bool hasPassed = passedQuorum && p.inFavor > p.against;
        _hasActiveProposal[_proposals[proposalIndex].owner] = false;

        emit LogProposalResult(proposalIndex, hasPassed, p.inFavor, p.against);
    }

    /// @dev increase the votecount on a given proposal by the token balance of a given address,
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param proposalIndex of the proposal to be voted on
    /// @param voteInFavor of the desired proposal
    /// @param voter address whose tokenBalance is to be used as voting-weight
    function incrementVote(uint256 proposalIndex, bool voteInFavor, address voter) internal {
        require(proposalIndex < _proposals.length, "Invalid proposal index");
        Proposal storage p = _proposals[proposalIndex];
        require(p.endTime > now, "Voting period is over");
        require(!p.hasVoted[voter]);
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
