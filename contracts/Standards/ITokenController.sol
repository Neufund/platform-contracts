pragma solidity 0.4.25;


/// @title granular token controller based on MSnapshotToken observer pattern
contract ITokenController {

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice see MTokenTransferController
    function onTransfer(address from, address to, uint256 amount)
        public
        constant
        returns (bool allow);

    /// @notice additionally checks broker that is executing transaction between from and to
    function onTransferFrom(address broker, address from, address to, uint256 amount)
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
}
