pragma solidity 0.4.26;


contract IWithdrawableToken {

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice withdraws from a token holding assets
    /// @dev amount of asset should be returned to msg.sender and corresponding balance burned
    function withdraw(uint256 amount)
        public;
}
