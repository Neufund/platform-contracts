pragma solidity 0.4.15;


/// @title old ERC223 callback function
/// @dev as used in Neumark and ICBMEtherToken and ICBMEuroToken
contract IERC223Callback {

    ////////////////////////
    // Public functions
    ////////////////////////

    function onTokenTransfer(
        address from,
        uint256 amount,
        bytes data
    )
        public;

}
