pragma solidity 0.4.15;


/// @title default interface of ETO processes
contract IETOCommitment {

    ////////////////////////
    // Events
    ////////////////////////

    /// on every commitment transaction
    /// `investor` committed `amount` in `paymentToken` currency which was
    /// converted to `eurEquivalent` that generates `grantedAmount` of
    /// `ofToken`.
    event LogFundsCommitted(
        address indexed investor,
        address indexed paymentToken,
        uint256 amount,
        uint256 eurEquivalent,
        uint256 grantedAmount,
        address ofToken,
        uint256 nmkReward
    );

    // on every state transition
    event LogStateTransition(
        uint32 oldState,
        uint32 newState
    );


    ////////////////////////
    // Public functions
    ////////////////////////

    // state control

    // returns current ETO state
    function state() public constant returns (uint32);

    // says if state is final
    function finalized() public constant returns (bool isFinal);

    // says if state is success
    function success() public constant returns (bool isSuccess);

    // says if state is filure
    function fail() public constant returns (bool failed);

    // process control

}
