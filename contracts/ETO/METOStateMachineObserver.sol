pragma solidity 0.4.26;

import "./IETOCommitmentStates.sol";


contract METOStateMachineObserver is IETOCommitmentStates {
    /// @notice called before state transitions, allows override transition due to additional business logic
    /// @dev advance due to time implemented in advanceTimedState, here implement other conditions like
    ///     max cap reached -> we go to signing
    function mBeforeStateTransition(ETOState oldState, ETOState newState)
        internal
        constant
        returns (ETOState newStateOverride);

    /// @notice gets called after every state transition.
    function mAfterTransition(ETOState oldState, ETOState newState)
        internal;

    /// @notice gets called after business logic, may induce state transition
    function mAdavanceLogicState(ETOState oldState)
        internal
        constant
        returns (ETOState);
}
