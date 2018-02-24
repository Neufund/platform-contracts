pragma solidity 0.4.15;

import "../Standards/IERC223Callback.sol";


/// @title default interface of ETO processes
contract IETOCommitment is IERC223Callback {

    ////////////////////////
    // Types
    ////////////////////////

    // order must reflect time precedence, do not change order below
    enum State {
        Setup,
        Whitelist,
        Public,
        Refund,
        Signing,
        Claim,
        Payout
    }

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

    // on every state transition
    event LogStateTransition(
        uint32 oldState,
        uint32 newState
    );

    /// on a claim by invester
    ///   `investor` claimed `amount` of `assetToken` obtained for
    ///   `eurEquivalent` and claimed `nmkReward` amount of NEU
    event LogClaimed(
        address indexed investor,
        address indexed assetToken,
        uint256 amount,
        uint256 eurEquivalent,
        uint256 nmkReward
    );

    /// on a refund to investor
    ///   `investor` was refunded `amount` of `paymentToken`
    /// @dev may be raised multiple times per refund operation
    event LogReund(
        address indexed investor,
        address indexed paymentToken,
        uint256 amount
    );


    ////////////////////////
    // Public functions
    ////////////////////////

    // state control

    // returns current ETO state
    function state() public constant returns (State);

    // says if state is final
    function finalized() public constant returns (bool isFinal);

    // says if state is success
    function success() public constant returns (bool isSuccess);

    // says if state is filure
    function fail() public constant returns (bool failed);

    // process control

    /// commit function happens via ERC223 callback that must happen from trusted payment token
    /// @param investor address of the investor
    /// @param amount amount commited
    /// @param data may have meaning in particular ETO implementation
    function onTokenTransfer(address investor, uint256 amount, bytes data)
        public;

    /// refunds investor if ETO is a fail
    function refund() external;

    /// claims tokens if ETO is a success
    function claim() external;

}
