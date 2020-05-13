pragma solidity 0.4.26;

/// @notice should be implemented by all contracts that initate the voting center procedure
///         must be implemented by all contracts that initate voting procedure AND request observer callbacks
contract IVotingObserver {
    /// @notice if requested, voting center will pass state transitions of proposal to observer
    /// @dev refer to VotingProposal for state variable values
    function onProposalStateTransition(
        bytes32 proposalId,
        uint8 oldState,
        uint8 newState)
        public;

    /// @notice only observer may tell if vote was in favor or not, voting center only carries on voting procedure
    ///         example is equity token controller as observer which will count outcome as passed depending on company bylaws
    /// @param votingCenter at which voting center to look for the results
    /// @param proposalId for which proposalId to deliver results
    /// @return true means inFavor, false means agains, revert means that procedure is not yet final or any other problem
    /// @dev please note the revert/false distinction above, do not returns false in case voting is unknown or not yet final
    function votingResult(address votingCenter, bytes32 proposalId)
        public
        constant
        returns (bool inFavor);
}
