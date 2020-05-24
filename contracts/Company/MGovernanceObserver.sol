pragma solidity 0.4.26;

/// @title self observing interface for controller governance
/// @dev observed by final contract to bind various modules together
contract MGovernanceObserver {

    /// @notice called whenever share capital changes
    /// @dev called after state change is done
    function mAfterShareCapitalChange(uint256 newShareCapital)
        internal;

}
