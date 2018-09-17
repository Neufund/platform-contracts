pragma solidity 0.4.24;

import "../Standards/ITokenController.sol";


contract IEuroTokenController is ITokenController {
     /// @notice returns true to override spender allowance for declared amount
    ///   in that case allowance processing in token contract should be skipped
    ///   and transferFrom executed
    /// intended to be used by "service contracts" like gas exchange to always be able
    /// to broker token transfer (within amount)
    function hasPermanentAllowance(address spender, uint256 amount)
        public
        constant
        returns (bool yes);
}
