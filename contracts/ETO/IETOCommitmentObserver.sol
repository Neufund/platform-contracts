pragma solidity 0.4.25;

import "./IETOCommitmentStates.sol";


/// @title provides callback on state transitions
/// @dev observer called after the state() of commitment contract was set
contract IETOCommitmentObserver is IETOCommitmentStates {
    function commitmentObserver() public constant returns (address);
    function onStateTransition(ETOState oldState, ETOState newState) public;
}
