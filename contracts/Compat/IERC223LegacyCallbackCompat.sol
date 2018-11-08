pragma solidity 0.4.25;


/// @title makes modern ERC223 contracts compatible with the legacy implementation
/// @dev should be used for all receivers of tokens sent by ICBMEtherToken and NEU
contract IERC223LegacyCallbackCompat {

    ////////////////////////
    // Public functions
    ////////////////////////

    function onTokenTransfer(address wallet, uint256 amount, bytes data)
        public
    {
        tokenFallback(wallet, amount, data);
    }

    function tokenFallback(address wallet, uint256 amount, bytes data)
        public;

}
