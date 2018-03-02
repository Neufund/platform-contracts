pragma solidity 0.4.15;

import "./ICommitment.sol";


/// @title default interface of commitment process
contract IETOCommitment is ICommitment {

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

    // process control

    /// refunds investor if ETO is a fail
    function refund() external;

    /// claims tokens if ETO is a success
    function claim() external;

}
