pragma solidity 0.4.26;

import "../../Math.sol";
import "../../Standards/ITokenSnapshots.sol";
import "./IVotingObserver.sol";


library VotingProposal {
    ////////////////////////
    // Constants
    ////////////////////////

    uint256 private constant STATES_COUNT = 5;

    ////////////////////////
    // Types
    ////////////////////////

    enum State {
        // Initial state where voting owner can build quorum for public visibility
        Campaigning,
        // has passed campaign-quorum in time, voting publicly announced
        Public,
        // reveal state where meta-transactions are gathered
        Reveal,
        // For votings that have off-chain counterpart, this is the time to upload the tally
        Tally,
        // Vote count will not change and tally is available, terminal state
        Final
    }

    /// @dev note that voting power is always expressed in tokens of the associated snapshot token
    ///     and reflect decimals of the token. voting power of 1 token with 18 decimals is Q18
    struct Proposal {
        // voting power comes from here
        ITokenSnapshots token;
        // balances at this snapshot count
        uint256 snapshotId;
        // on-chain tally
        uint256 inFavor;
        uint256 against;
        // off-chain tally
        uint256 offchainInFavor;
        uint256 offchainAgainst;

        // quorum needed to reach public phase
        uint256 campaignQuorumTokenAmount;

        // off-chain voting power
        uint256 offchainVotingPower;

        // voting initiator
        IVotingObserver initiator;
        // voting legal representative
        address votingLegalRep;

        // proposal action as set by initiator
        uint256 action;
        // on chain proposal action payload
        bytes actionPayload;

        // when states end, indexed by state, keep it word aligned
        uint32[STATES_COUNT] deadlines;

        // current state of the voting
        State state;

        // observer function requested to owner?
        bool observing;

        // you can vote only once
        mapping (address => bool) hasVoted;
    }

    /////////////////////////
    // Events
    ////////////////////////

    event LogProposalStateTransition(
        bytes32 indexed proposalId,
        address initiator,
        address votingLegalRep,
        address token,
        State oldState,
        State newState
    );

    /////////////////////////
    // Internal Lib Functions
    ////////////////////////

    function isVotingOpen(VotingProposal.Proposal storage p)
        internal
        constant
        returns (bool)
    {
        return p.state == State.Campaigning || p.state == State.Public;
    }

    function isRelayOpen(VotingProposal.Proposal storage p)
        internal
        constant
        returns (bool)
    {
        return isVotingOpen(p) || p.state == State.Reveal;
    }

    function initialize(
        Proposal storage p,
        bytes32 proposalId,
        ITokenSnapshots token,
        uint256 snapshotId,
        uint32 campaignDuration,
        uint256 campaignQuorumFraction,
        uint32 votingPeriod,
        address votingLegalRep,
        uint32 offchainVotePeriod,
        uint256 offchainVotingPower,
        uint256 action,
        bool enableObserver
    )
        internal
    {
        uint256 totalTokenVotes = token.totalSupplyAt(snapshotId);
        require(totalTokenVotes > 0, "NF_VC_EMPTY_TOKEN");

        // set initial deadlines
        uint32[STATES_COUNT] memory deadlines;
        uint32 t = uint32(now);
        deadlines[0] = t;
        deadlines[1] = t + campaignDuration;
        // no reveal now
        deadlines[2] = deadlines[3] = t + votingPeriod;
        deadlines[4] = deadlines[3] + offchainVotePeriod;

        // can't use struct constructor because it goes through memory
        // p is already allocated storage slot
        p.token = token;
        p.snapshotId = snapshotId;
        p.observing = enableObserver;
        p.campaignQuorumTokenAmount = Math.decimalFraction(totalTokenVotes, campaignQuorumFraction);
        p.initiator = IVotingObserver(msg.sender);
        p.votingLegalRep = votingLegalRep;
        p.offchainVotingPower = offchainVotingPower;
        p.deadlines = deadlines;
        p.state = State.Campaigning;
        p.action = action;

        // advance campaigning state to public if quorum not specified
        // that will also emit event if such transition happen
        advanceLogicState(p, proposalId);
    }

    // @dev don't use `else if` and keep sorted by time and call `state()`
    //     or else multiple transitions won't cascade properly.
    function advanceTimedState(Proposal storage p, bytes32 proposalId)
        internal
    {
        uint32 t = uint32(now);
        // campaign timeout to final
        if (p.state == State.Campaigning && t >= p.deadlines[uint32(State.Public)]) {
            transitionTo(p, proposalId, State.Final);
        }
        // other states go one by one, terminal state stops
        while(p.state != State.Final && t >= p.deadlines[uint32(p.state) + 1]) {
            transitionTo(p, proposalId, State(uint8(p.state) + 1));
        }
    }

    // @notice transitions due to business logic
    // @dev called after logic
    function advanceLogicState(Proposal storage p, bytes32 proposalId)
        internal
    {
        // State state = p.state;
        // if crossed campaign quorum
        if (p.state == State.Campaigning && p.inFavor + p.against >= p.campaignQuorumTokenAmount) {
            // go to public state
            transitionTo(p, proposalId, State.Public);
        }
        // if off-chain tally done
        if (p.state == State.Tally && p.offchainAgainst + p.offchainInFavor > 0) {
            // finalize
            transitionTo(p, proposalId, State.Final);
        }
    }

    /// @notice executes transition state function
    function transitionTo(Proposal storage p, bytes32 proposalId, State newState)
        private
    {
        State oldState = p.state;
        // get deadline for old state and check the delta for other states
        uint32 delta;
        uint32 deadline = p.deadlines[uint256(oldState) + 1];
        // if transition came before deadline, count time from timestamp, if after always count from deadline
        if (uint32(now) < deadline) {
            delta = deadline - uint32(now);
        }
        if (delta > 0) {
            // shift dealines for other states
            uint32[STATES_COUNT] memory newDeadlines = p.deadlines;
            for (uint256 ii = uint256(oldState) + 1; ii < STATES_COUNT; ii += 1) {
                newDeadlines[ii] -= delta;
            }
            p.deadlines = newDeadlines;
        }
        // write storage
        p.state = newState;

        // do not emit events and observer if campaigning failed
        if (oldState == State.Campaigning && newState == State.Final) {
            return;
        }

        emit LogProposalStateTransition(proposalId, p.initiator, p.votingLegalRep, p.token, oldState, newState);
        if (p.observing) {
            // call observer on best-effort. ignore errors
            bytes4 sel = p.initiator.onProposalStateTransition.selector;
            (address(p.initiator)).call(
                abi.encodeWithSelector(sel, proposalId, oldState, newState)
                );
        }
    }
}
