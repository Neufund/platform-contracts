pragma solidity 0.4.23;


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

    /// @notice see MTokenAllowanceController
    function onApprove(address owner, address spender, uint256 amount)
        public
        constant
        returns (bool allow);

    /// @notice returns true to override spender allowance for declared amount
    ///   in that case allowance processing in token contract should be skipped
    ///   and transferFrom executed
    /// intended to be used by "service contracts" like gas exchange to always be able
    /// to broker token transfer (within amount)
    function hasPermanentAllowance(address spender, uint256 amount)
        public
        constant
        returns (bool yes);

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
}
