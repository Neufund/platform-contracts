pragma solidity 0.4.26;

import "../Standards/IAgreement.sol";
import "../Standards/IERC223Callback.sol";


/// @title default interface of commitment process
/// @notice we assume that every commitment contract supports the following
///     1. a snapshot token (assetToken) that is being offered
///     2. EUR as base currency, other currencies are converted on spot prices and equivalent in base currency is available
///     3. there's always reservation agreement attached
///     4. simple state machine with final success/failed state
///     5. start and stop timestamps
///     6. contract id information
contract ICommitment is
    IAgreement,
    IERC223Callback
{

    ////////////////////////
    // Events
    ////////////////////////

    /// on every commitment transaction
    /// `investor` committed `amount` in `paymentToken` currency which was
    /// converted to `baseCurrencyEquivalent` that generates `grantedAmount` of
    /// `assetToken` and `neuReward` NEU
    /// for investment funds could be provided from `wallet` (like icbm wallet) controlled by investor
    event LogFundsCommitted(
        address indexed investor,
        address wallet,
        address paymentToken,
        uint256 amount,
        uint256 baseCurrencyEquivalent,
        uint256 grantedAmount,
        address assetToken,
        uint256 neuReward
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
