pragma solidity 0.4.15;

import "./ETODurationTerms.sol";
import "./IETOCommitment.sol";


/// @title state machine for Commitment contract
/// @notice implements ETO state machine per documentation in README
/// @dev state switching via 'transitionTo' function
/// @dev inherited contract must implement mAfterTransition which will be called just after state transition happened
/// @title time induced state machine
/// @dev intended usage via 'withTimedTransitions' modifier which makes sure that state machine transitions into
///     correct state before executing function body. note that this is contract state changing modifier so use with care
/// @dev state change request is publicly accessible via 'handleTimedTransitions'
/// @dev time is based on block.timestamp
contract ETOTimedStateMachine is IETOCommitment {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // maps states to durations (index is State)
    uint32[] private ETO_STATE_DURATIONS;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // current state
    State private _state = State.Setup;

    // historical times of state transition (index is State)
    uint32[] private _pastStateTransitionTimes;

    ////////////////////////
    // Modifiers
    ////////////////////////

    // @dev This modifier needs to be applied to all external non-constant
    //     functions.
    // @dev This modifier goes _before_ other state modifiers like `onlyState`.
    modifier withStateTransition() {
        // switch state due to time
        advanceTimedState();
        // execute function body
        _;
        // switch state due to other ETO factors
        mAdvanceState(_state);
    }

    modifier onlyState(State state) {
        require(_state == state);
        _;
    }

    modifier onlyStates(State state0, State state1) {
        require(_state == state0 || _state == state1);
        _;
    }

    /// @dev Multiple states can be handled by adding more modifiers.
    /* modifier notInState(State state) {
        require(_state != state);
        _;
    }*/

    ////////////////////////
    // Constructor
    ////////////////////////

    function ETOTimedStateMachine(ETODurationTerms durationTerms)
        internal
    {
        // map terms to states
        ETO_STATE_DURATIONS[uint32(State.Whitelist)] = durationTerms.WHITELIST_DURATION();
        ETO_STATE_DURATIONS[uint32(State.Public)] = durationTerms.PUBLIC_DURATION();
        ETO_STATE_DURATIONS[uint32(State.Signing)] = durationTerms.SIGNING_DURATION();
        ETO_STATE_DURATIONS[uint32(State.Claim)] = durationTerms.CLAIM_DURATION();
        // set values to past timed transitions to reduce future gas cost
        _pastStateTransitionTimes = [1, 1, 1, 1, 1, 1, 1];
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    // @notice This function is public so that it can be called independently.
    function handleStateTransitions()
        public
    {
        advanceTimedState();
    }

    function state()
        public
        constant
        returns (State)
    {
        return _state;
    }

    function startOf(State s)
        public
        constant
        returns (uint256)
    {
        if (s == State.Setup) {
            return 0;
        }
        uint256 expiration = _pastStateTransitionTimes[uint32(s)];
        // if in setup state and time to end state not set we cannot calculate anything
        if (_state == State.Setup && expiration == 0) {
            return 0;
        }
        // get past state transition timestamp
        if (s < _state) {
            return _pastStateTransitionTimes[uint32(s)];
        }
        // beginning of the current state
        if (s == _state) {
            return expiration - ETO_STATE_DURATIONS[uint32(s)];
        }
        // this trick gets start of required state by adding all durations betweend current and required states
        // note that past and current state were handled above so required state is in the future
        for(uint256 stateIdx = uint32(_state) + 1; stateIdx <= uint32(s); stateIdx++) {
            expiration += ETO_STATE_DURATIONS[stateIdx];
        }
        return expiration;
    }

    // says if state is final
    function finalized()
        public
        constant
        returns (bool isFinal)
    {
        return (_state == State.Refund || _state == State.Payout);
    }

    // says if state is success
    function success()
        public
        constant
        returns (bool isSuccess)
    {
        return (_state == State.Claim || _state == State.Payout);
    }

    // says if state is filure
    function fail()
        public
        constant
        returns (bool failed)
    {
        return _state == State.Refund;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    /// @notice called to advance to next state
    /// @dev should advance state with transitionTo
    /// @dev advance due to time implemented in advanceTimedState, here implement other conditions like
    ///     max cap reached -> we go to signing
    function mAdvanceState(State oldState)
        internal;

    /// @notice gets called after every state transition.
    function mAfterTransition(State oldState, State newState)
        internal;

    /// @notice executes transition state function
    function transitionTo(State newState)
        internal
    {
        State oldState = _state;
        require(validTransition(oldState, newState));

        _state = newState;
        // we have 60+ years for 2^32 overflow on epoch so disregard
        _pastStateTransitionTimes[uint32(oldState)] = uint32(block.timestamp);
        _pastStateTransitionTimes[uint32(newState)] = uint32(block.timestamp) + ETO_STATE_DURATIONS[uint32(newState)];
        LogStateTransition(uint32(oldState), uint32(newState));

        // should not change state and it is required here.
        mAfterTransition(oldState, newState);
        require(_state == newState);
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    // @notice time induced state transitions.
    // @dev don't use `else if` and keep sorted by time and call `state()`
    //     or else multiple transitions won't cascade properly.
    function advanceTimedState()
        private
    {
        uint256 t = block.timestamp;

        // from setup to refund
        if (_state == State.Setup && t >= startOf(State.Whitelist)) {
            transitionTo(State.Whitelist);
        }
        if (_state == State.Whitelist && t >= startOf(State.Public)) {
            transitionTo(State.Public);
        }
        if (_state == State.Public && t >= startOf(State.Refund)) {
            transitionTo(State.Refund);
        }
        // signing to refund
        if (_state == State.Signing && t >= startOf(State.Refund)) {
            transitionTo(State.Refund);
        }
        // claim to payout
        if (_state == State.Claim && t >= startOf(State.Payout)) {
            transitionTo(State.Payout);
        }
    }

    function validTransition(State oldState, State newState)
        private
        constant
        returns (bool valid)
    {
        // TODO: think about disabling it before production deployment
        // (oldState == State.Setup && newState == State.Public) ||
        // (oldState == State.Setup && newState == State.Refund) ||
        return
            (oldState == State.Setup && newState == State.Whitelist) ||
            (oldState == State.Whitelist && newState == State.Public) ||
            (oldState == State.Whitelist && newState == State.Signing) ||
            (oldState == State.Public && newState == State.Signing) ||
            (oldState == State.Public && newState == State.Refund) ||
            (oldState == State.Signing && newState == State.Refund) ||
            (oldState == State.Signing && newState == State.Claim) ||
            (oldState == State.Claim && newState == State.Payout);
    }
}
