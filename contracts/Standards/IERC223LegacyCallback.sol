pragma solidity 0.4.25;


/// @title old ERC223 callback function
/// @dev as used in Neumark and ICBMEtherToken
contract IERC223LegacyCallback {

    ////////////////////////
    // Public functions
    ////////////////////////

    function onTokenTransfer(address from, uint256 amount, bytes data)
        public;

}
