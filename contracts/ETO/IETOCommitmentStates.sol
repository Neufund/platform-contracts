pragma solidity 0.4.23;


/// @title state space of ETOCommitment
contract IETOCommitmentStates {
    ////////////////////////
    // Types
    ////////////////////////

    // order must reflect time precedence, do not change order below
    enum ETOState {
        Setup, // Initial state
        Whitelist,
        Public,
        Signing,
        Claim,
        Payout, // Terminal state
        Refund // Terminal state
    }
}
