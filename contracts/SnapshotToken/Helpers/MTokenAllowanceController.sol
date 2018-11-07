pragma solidity 0.4.25;


/// @title controls spending approvals
/// @dev TokenAllowance observes this interface, Neumark contract implements it
contract MTokenAllowanceController {

    ////////////////////////
    // Internal functions
    ////////////////////////

    /// @notice Notifies the controller about an approval allowing the
    ///  controller to react if desired
    /// @param owner The address that calls `approve()`
    /// @param spender The spender in the `approve()` call
    /// @param amount The amount in the `approve()` call
    /// @return False if the controller does not authorize the approval
    function mOnApprove(
        address owner,
        address spender,
        uint256 amount
    )
        internal
        returns (bool allow);

    /// @notice Allows to override allowance approved by the owner
    ///         Primary role is to enable forced transfers, do not override if you do not like it
    ///         Following behavior is expected in the observer
    ///         approve() - should revert if mAllowanceOverride() > 0
    ///         allowance() - should return mAllowanceOverride() if set
    ///         transferFrom() - should override allowance if mAllowanceOverride() > 0
    /// @param owner An address giving allowance to spender
    /// @param spender An address getting  a right to transfer allowance amount from the owner
    /// @return current allowance amount
    function mAllowanceOverride(
        address owner,
        address spender
    )
        internal
        constant
        returns (uint256 allowance);
}
