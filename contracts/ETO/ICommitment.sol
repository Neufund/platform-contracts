pragma solidity 0.4.23;

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
    event LogFundsCommitted(
        address indexed investor,
        address indexed paymentToken,
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

    /// commit function happens via ERC223 callback that must happen from trusted payment token
    /// @param investor address of the investor
    /// @param amount amount commited
    /// @param data may have meaning in particular ETO implementation
    function tokenFallback(address investor, uint256 amount, bytes data)
        public;

}
