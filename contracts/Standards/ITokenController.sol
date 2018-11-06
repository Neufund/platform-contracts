pragma solidity 0.4.25;


/// @title granular token controller based on MSnapshotToken observer pattern
contract ITokenController {

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice see MTokenTransferController
    /// @dev additionally passes broker that is executing transaction between from and to
    ///      for unbrokered transfer, broker == from
    function onTransfer(address broker, address from, address to, uint256 amount)
        public
        constant
        returns (bool allow);

    /// @notice see MTokenAllowanceController
    function onApprove(address owner, address spender, uint256 amount)
        public
        constant
        returns (bool allow);

    /// @notice see MTokenMint
    function onGenerateTokens(address sender, address owner, uint256 amount)
        public
        constant
        returns (bool allow);

    /// @notice see MTokenMint
    function onDestroyTokens(address sender, address owner, uint256 amount)
        public
        constant
        returns (bool allow);

    /// @notice controls if sender can change controller to newController
    /// @dev for this to succeed TYPICALLY current controller must be already migrated to a new one
    function onChangeTokenController(address sender, address newController)
        public
        constant
        returns (bool);

    /// @notice overrides spender allowance
    /// @dev may be used to implemented forced transfers in which token controller may override approved allowance
    ///      with any > 0 value and then use transferFrom to execute such transfer
    ///      This by definition creates non-trustless token so do not implement this call if you do not need trustless transfers!
    ///      Implementer should not allow approve() to be executed if there is an overrride
    //       Implemented should return allowance() taking into account override
    function onAllowance(address owner, address spender)
        public
        constant
        returns (uint256 allowanceOverride);
}
