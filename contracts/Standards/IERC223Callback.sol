pragma solidity 0.4.24;


/// @title current ERC223 fallback function
/// @dev to be used in all future token contract
/// @dev NEU and ICBMEtherToken (obsolete) are the only contracts that still uses IERC223LegacyCallback
contract IERC223Callback {

    ////////////////////////
    // Public functions
    ////////////////////////

    function tokenFallback(address from, uint256 amount, bytes data)
        public;

}
