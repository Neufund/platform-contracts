pragma solidity 0.4.25;


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

    // number of states in enum
    uint256 constant internal ETO_STATES_COUNT = 7;
}
