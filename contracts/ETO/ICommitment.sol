pragma solidity 0.4.24;

import "../Standards/IAgreement.sol";
import "../Standards/IERC223Callback.sol";


/// @title default interface of commitment process
///  investment always happens via payment token ERC223 callback
///  methods for checking finality and success/fail of the process are vailable
///  commitment event is standardized for tracking
contract ICommitment is
    IAgreement,
    IERC223Callback
{

    ////////////////////////
    // Events
    ////////////////////////

    /// on every commitment transaction
    /// `investor` committed `amount` in `paymentToken` currency which was
    /// converted to `eurEquivalent` that generates `grantedAmount` of
    /// `assetToken` and `nmkReward` NEU
    /// for investment funds could be provided from `wallet` (like icbm wallet) controlled by investor
    event LogFundsCommitted(
        address indexed investor,
        address wallet,
        address paymentToken,
        uint256 amount,
        uint256 eurEquivalent,
        uint256 grantedAmount,
        address assetToken,
        uint256 nmkReward
    );

    ////////////////////////
    // Public functions
    ////////////////////////

    // says if state is final
    function finalized() public constant returns (bool);

    // says if state is success
    function success() public constant returns (bool);

    // says if state is failure
    function failed() public constant returns (bool);

    // currently committed funds
    function totalInvestment()
        public
        constant
        returns (
            uint256 totalEquivEurUlps,
            uint256 totalTokensInt,
            uint256 totalInvestors
        );

    /// commit function happens via ERC223 callback that must happen from trusted payment token
    /// @param investor address of the investor
    /// @param amount amount commited
    /// @param data may have meaning in particular ETO implementation
    function tokenFallback(address investor, uint256 amount, bytes data)
        public;

}
