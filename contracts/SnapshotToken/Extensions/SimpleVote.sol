pragma solidity 0.4.26;

contract SimpleVote {

    ////////////////////////
    // Types
    ////////////////////////


    struct Proposal {
        uint inFavor;
        uint against;
        uint endTime;
        // address owner;
        mapping (address => bool) hasVoted;
    }

    /////////////////////////
    // Immutable state
    ////////////////////////
    uint internal constant VOTING_PERIOD = 3 days;

    /////////////////////////
    // Mutable state
    ////////////////////////
    Proposal[] private _proposals;

    // mapping (address => bool) private _hasActiveProposal;

    /////////////////////////
    // Events
    ////////////////////////

    event LogNewProposal(address indexed owner, uint indexed proposalIndex, uint endTime);
    event LogProposalResult(uint indexed proposalIndex, bool hasPassed);

    /////////////////////////
    // Public functions
    ////////////////////////

    /// creates a proposal that will end VOTING_PERIOD days from now
    function addProposal() public {
        // TODO require msg.sender to not have a proposed something already
        _proposals.push(
            Proposal({
                inFavor: 0,
                against:0,
                endTime: now + VOTING_PERIOD
                // owner: msg.sender
            })
        );
        // _hasActiveProposal[msg.sender] = true;
        emit LogNewProposal(msg.sender, _proposals.length - 1, now + VOTING_PERIOD);

    }

    // vote on a proposal, throws if proposal does not exist or the vote on it has ended already
    /// @param proposalIndex of the proposal to be voted on
    /// @param voteInFavor the desired vote
    function vote(uint proposalIndex, bool voteInFavor) public {
        require(proposalIndex < _proposals.length, "Invalid proposal index");
        Proposal storage p = _proposals[proposalIndex];
        require(p.endTime > now, "Voting period is over");
        require(!p.hasVoted[msg.sender]);
        if (voteInFavor) {
            p.inFavor++;
        } else {
            p.against++;
        }
        p.hasVoted[msg.sender] = true;
    }

    /// @returns whether the vote on a proposal has passed, throws if vote is still ongoing or proposal does not exist
    function getResult(uint proposalIndex) public view returns(bool hasPassed) {
        require(proposalIndex < _proposals.length, "Invalid proposal index");
        Proposal storage p = _proposals[proposalIndex];
        require(p.endTime > now, "Voting period is not over");
        hasPassed = p.inFavor > p.against;
        // _hasActiveProposal[_proposals[proposalIndex].owner] = false;
        emit LogProposalResult(proposalIndex, hasPassed);
    }



    }
}
