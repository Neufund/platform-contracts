pragma solidity 0.4.26;

import "./IVotingCenter.sol";
import "./IVotingController.sol";
import "./VotingProposal.sol";

/// Contract to allow voting based on a snapshotable token (with relayed, batched voting)
contract VotingCenter is IVotingCenter {

    using VotingProposal for VotingProposal.Proposal;

    /////////////////////////
    // Modifiers
    ////////////////////////

    // @dev This modifier needs to be applied to all external non-constant functions.
    //  this modifier goes _before_ other state modifiers like `onlyState`.
    //  after function body execution state may transition again in `advanceLogicState`
    modifier withStateTransition(bytes32 proposalId) {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);
        // switch state due to time
        VotingProposal.advanceTimedState(p, proposalId);
        // execute function body
        _;
        // switch state due to business logic
        VotingProposal.advanceLogicState(p, proposalId);
    }

    // @dev This modifier needs to be applied to all external non-constant functions.
    //  this modifier goes _before_ other state modifiers like `onlyState`.
    //  note that this function actually modifies state so it will generate warnings
    //  and is incompatible with STATICCALL
    modifier withTimedTransition(bytes32 proposalId) {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);
        // switch state due to time
        VotingProposal.advanceTimedState(p, proposalId);
        // execute function body
        _;
    }

    modifier withVotingOpen(bytes32 proposalId) {
        VotingProposal.Proposal storage p = _proposals[proposalId];
        require(VotingProposal.isVotingOpen(p), "NV_VC_VOTING_CLOSED");
        _;
    }

    modifier withRelayingOpen(bytes32 proposalId) {
        VotingProposal.Proposal storage p = _proposals[proposalId];
        require(VotingProposal.isRelayOpen(p), "NV_VC_VOTING_CLOSED");
        _;
    }

    modifier onlyTally(bytes32 proposalId) {
        VotingProposal.Proposal storage p = _proposals[proposalId];
        require(p.state == VotingProposal.State.Tally, "NV_VC_NOT_TALLYING");
        _;
    }

    /////////////////////////
    // Mutable state
    ////////////////////////

    mapping (bytes32 => VotingProposal.Proposal) private _proposals;
    IVotingController private _votingController;


    /////////////////////////
    // Events
    ////////////////////////

    // must be in sync with library event, events cannot be shared
    event LogProposalStateTransition(
        bytes32 indexed proposalId,
        address initiator,
        address votingLegalRep,
        address token,
        VotingProposal.State oldState,
        VotingProposal.State newState
    );

    // logged when voter casts a vote
    event LogVoteCast(
        bytes32 indexed proposalId,
        address initiator,
        address token,
        address voter,
        bool voteInFavor,
        uint256 power
    );

    // logged when proposal legal rep provides off-chain voting results
    event LogOffChainProposalResult(
        bytes32 indexed proposalId,
        address initiator,
        address token,
        address votingLegalRep,
        uint256 inFavor,
        uint256 against,
        string documentUri
    );

    // logged when controller changed
    event LogChangeVotingController(
        address oldController,
        address newController,
        address by
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IVotingController controller) public {
        _votingController = controller;
    }

    /////////////////////////
    // Public functions
    ////////////////////////

    //
    // IVotingCenter implementation
    //

    function addProposal(
        bytes32 proposalId,
        ITokenSnapshots token,
        uint32 campaignDuration,
        uint256 campaignQuorumFraction,
        uint32 votingPeriod,
        address votingLegalRep,
        uint32 offchainVotePeriod,
        uint256 totalVotingPower,
        uint256 action,
        bytes actionPayload,
        bool enableObserver
    )
        public
    {
        require(token != address(0));
        VotingProposal.Proposal storage p = _proposals[proposalId];

        require(p.token == address(0), "NF_VC_P_ID_NON_UNIQ");
        // campaign duration must be less or eq total voting period
        require(campaignDuration <= votingPeriod, "NF_VC_CAMPAIGN_OVR_TOTAL");
        require(campaignQuorumFraction <= 10**18, "NF_VC_INVALID_CAMPAIGN_Q");
        require(
            campaignQuorumFraction == 0 && campaignDuration == 0 ||
            campaignQuorumFraction > 0 && campaignDuration > 0,
            "NF_VC_CAMP_INCONSISTENT"
        );
        require(
            offchainVotePeriod > 0 && totalVotingPower > 0 && votingLegalRep != address(0) ||
            offchainVotePeriod == 0 && totalVotingPower == 0 && votingLegalRep == address(0),
            "NF_VC_TALLY_INCONSISTENT"
        );

        // take sealed snapshot
        uint256 sId = token.currentSnapshotId() - 1;

        p.initialize(
            proposalId,
            token,
            sId,
            campaignDuration,
            campaignQuorumFraction,
            votingPeriod,
            votingLegalRep,
            offchainVotePeriod,
            totalVotingPower,
            action,
            enableObserver
        );
        // we should do it in initialize bo stack is too small
        p.actionPayload = actionPayload;
        // call controller now when proposal is available via proposal method
        require(_votingController.onAddProposal(proposalId, msg.sender, token), "NF_VC_CTR_ADD_REJECTED");
    }

    function vote(bytes32 proposalId, bool voteInFavor)
        public
        withStateTransition(proposalId)
        withVotingOpen(proposalId)
    {
        VotingProposal.Proposal storage p = _proposals[proposalId];
        require(p.hasVoted[msg.sender] == VotingProposal.TriState.Abstain, "NF_VC_ALREADY_VOTED");
        castVote(p, proposalId, voteInFavor, msg.sender);
    }

    function addOffchainVote(bytes32 proposalId, uint256 inFavor, uint256 against, string documentUri)
        public
        withStateTransition(proposalId)
        onlyTally(proposalId)
    {
        VotingProposal.Proposal storage p = _proposals[proposalId];
        require(msg.sender == p.votingLegalRep, "NF_VC_ONLY_VOTING_LEGAL_REP");
        // may not cross offchainVotingPower
        require(inFavor + against <= p.offchainVotingPower, "NF_VC_EXCEEDS_OFFLINE_V_POWER");
        require(inFavor + against > 0, "NF_VC_NO_OFF_EMPTY_VOTE");

        p.offchainInFavor = inFavor;
        p.offchainAgainst = against;

        emit LogOffChainProposalResult(proposalId, p.initiator, p.token, msg.sender, inFavor, against, documentUri);
    }

    function tally(bytes32 proposalId)
        public
        constant
        withTimedTransition(proposalId)
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
        )
    {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);

        s = uint8(p.state);
        inFavor = p.inFavor;
        against = p.against;
        offchainInFavor = p.offchainInFavor;
        offchainAgainst = p.offchainAgainst;
        initiator = p.initiator;
        hasObserverInterface = p.observing;
        tokenVotingPower = p.token.totalSupplyAt(p.snapshotId);
        totalVotingPower = tokenVotingPower + p.offchainVotingPower;
        campaignQuorumTokenAmount = p.campaignQuorumTokenAmount;
    }

    function timedProposal(bytes32 proposalId)
        public
        withTimedTransition(proposalId)
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
        )
    {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);

        s = uint8(p.state);
        token = p.token;
        snapshotId = p.snapshotId;
        enableObserver = p.observing;
        campaignQuorumTokenAmount = p.campaignQuorumTokenAmount;
        initiator = p.initiator;
        votingLegalRep = p.votingLegalRep;
        offchainVotingPower = p.offchainVotingPower;
        deadlines = p.deadlines;
        action = p.action;
        actionPayload = p.actionPayload;
    }

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
            )
    {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);

        s = uint8(p.state);
        token = p.token;
        snapshotId = p.snapshotId;
        enableObserver = p.observing;
        campaignQuorumTokenAmount = p.campaignQuorumTokenAmount;
        initiator = p.initiator;
        votingLegalRep = p.votingLegalRep;
        offchainVotingPower = p.offchainVotingPower;
        deadlines = p.deadlines;
        action = p.action;
        actionPayload = p.actionPayload;
    }

    function getVote(bytes32 proposalId, address voter)
        public
        constant
        returns (uint8)
    {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);
        return uint8(p.hasVoted[voter]);
    }

    function hasProposal(bytes32 proposalId)
        public
        constant
        returns (bool)
    {
        VotingProposal.Proposal storage p = _proposals[proposalId];
        return p.token != address(0);
    }

    function getVotingPower(bytes32 proposalId, address voter)
        public
        constant
        returns (uint256)
    {
        VotingProposal.Proposal storage p = ensureExistingProposal(proposalId);
        return p.token.balanceOfAt(voter, p.snapshotId);
    }

    //
    // IContractId Implementation
    //

    function contractId()
        public
        pure
        returns (bytes32 id, uint256 version)
    {
        return (0xbbf540c4111754f6dbce914d5e55e1c0cb26515adbc288b5ea8baa544adfbfa4, 0);
    }

    //
    // IVotingController hook
    //

    /// @notice get current controller
    function votingController()
        public
        constant
        returns (IVotingController)
    {
        return _votingController;
    }

    /// @notice update current controller
    function changeVotingController(IVotingController newController)
        public
    {
        require(_votingController.onChangeVotingController(msg.sender, newController), "NF_VC_CHANGING_CTR_REJECTED");
        address oldController = address(_votingController);
        _votingController = newController;
        emit LogChangeVotingController(oldController, address(newController), msg.sender);
    }

    //
    // Other methods
    //

    /// @dev same as vote, only for a relayed vote. Will throw if provided signature (v,r,s) does not match
    ///  the address of the voter
    /// @param voter address whose token balance should be used as voting power
    function relayedVote(
        bytes32 proposalId,
        bool voteInFavor,
        address voter,
        bytes32 r,
        bytes32 s,
        uint8 v
    )
        public
        withStateTransition(proposalId)
        withRelayingOpen(proposalId)
    {
        // check that message signature matches the voter address
        assert(isValidSignature(proposalId, voteInFavor, voter, r, s, v));
        // solium-enable indentation
        VotingProposal.Proposal storage p = _proposals[proposalId];
        require(p.hasVoted[voter] == VotingProposal.TriState.Abstain, "NF_VC_ALREADY_VOTED");
        castVote(p, proposalId, voteInFavor, voter);
    }

    // batches should be grouped by proposal, that allows to tally in place and write to storage once
    function batchRelayedVotes(
        bytes32 proposalId,
        bool[] votePreferences,
        bytes32[] r,
        bytes32[] s,
        uint8[] v
    )
        public
        withStateTransition(proposalId)
        withRelayingOpen(proposalId)
    {
        assert(
            votePreferences.length == r.length && r.length == s.length && s.length == v.length
        );
        relayBatchInternal(
            proposalId,
            votePreferences,
            r, s, v
        );
    }

    function handleStateTransitions(bytes32 proposalId)
        public
        withTimedTransition(proposalId)
    {}

    //
    // Utility public functions
    //

    function isValidSignature(
        bytes32 proposalId,
        bool voteInFavor,
        address voter,
        bytes32 r,
        bytes32 s,
        uint8 v
    )
        public
        constant
        returns (bool)
    {
        // solium-disable indentation
        return ecrecoverVoterAddress(proposalId, voteInFavor, r, s, v) == voter;
    }

    function ecrecoverVoterAddress(
        bytes32 proposalId,
        bool voteInFavor,
        bytes32 r,
        bytes32 s,
        uint8 v
    )
        public
        constant
        returns (address)
    {
        // solium-disable indentation
        return ecrecover(
            keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(byte(0), address(this), proposalId, voteInFavor)))),
            v, r, s);
    }

    /////////////////////////
    // Private functions
    ////////////////////////

    /// @dev increase the votecount on a given proposal by the token balance of a given address,
    ///   throws if proposal does not exist or the vote on it has ended already. Votes are final,
    ///   changing the vote is not allowed
    /// @param p proposal storage pointer
    /// @param proposalId of the proposal to be voted on
    /// @param voteInFavor of the desired proposal
    /// @param voter address whose tokenBalance is to be used as voting-power
    function castVote(VotingProposal.Proposal storage p, bytes32 proposalId, bool voteInFavor, address voter)
        private
    {
        uint256 power = p.token.balanceOfAt(voter, p.snapshotId);
        if (voteInFavor) {
            p.inFavor = Math.add(p.inFavor, power);
        } else {
            p.against = Math.add(p.against, power);
        }
        markVoteCast(p, proposalId, voter, voteInFavor, power);
    }

    function ensureExistingProposal(bytes32 proposalId)
        private
        constant
        returns (VotingProposal.Proposal storage p)
    {
        p = _proposals[proposalId];
        require(p.token != address(0), "NF_VC_PROP_NOT_EXIST");
        return p;
    }

    function relayBatchInternal(
        bytes32 proposalId,
        bool[] votePreferences,
        bytes32[] r,
        bytes32[] s,
        uint8[] v
    )
        private
    {
        uint256 inFavor;
        uint256 against;
        VotingProposal.Proposal storage p = _proposals[proposalId];
        for (uint256 i = 0; i < votePreferences.length; i++) {
            uint256 power = relayBatchElement(
                p,
                proposalId,
                votePreferences[i],
                r[i], s[i], v[i]);
            if (votePreferences[i]) {
                inFavor = Math.add(inFavor, power);
            } else {
                against = Math.add(against, power);
            }
        }
        // write votes to storage
        p.inFavor = Math.add(p.inFavor, inFavor);
        p.against = Math.add(p.against, against);
    }

    function relayBatchElement(
        VotingProposal.Proposal storage p,
        bytes32 proposalId,
        bool voteInFavor,
        bytes32 r,
        bytes32 s,
        uint8 v
    )
        private
        returns (uint256 power)
    {
        // recover voter from signature, mangled data produces mangeld voter address, which will be
        // eliminated later
        address voter = ecrecoverVoterAddress(
            proposalId,
            voteInFavor,
            r, s, v
        );
        // cast vote if not cast before
        if (p.hasVoted[voter] == VotingProposal.TriState.Abstain) {
            power = p.token.balanceOfAt(voter, p.snapshotId);
            // if not holding token, power is 0
            markVoteCast(p, proposalId, voter, voteInFavor, power);
        }
        // returns voting power which is zero in case of failed vote
    }

    function markVoteCast(VotingProposal.Proposal storage p, bytes32 proposalId, address voter, bool voteInFavor, uint256 power)
        private
    {
        if (power > 0) {
            p.hasVoted[voter] = voteInFavor ? VotingProposal.TriState.InFavor : VotingProposal.TriState.Against;
            emit LogVoteCast(proposalId, p.initiator, p.token, voter, voteInFavor, power);
        }
    }
}
