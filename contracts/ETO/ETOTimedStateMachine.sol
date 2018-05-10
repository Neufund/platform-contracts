pragma solidity 0.4.23;

import "./ETODurationTerms.sol";
import "./IETOCommitment.sol";


/// @title time induced state machine for Equity Token Offering
/// @notice implements ETO state machine with setup, whitelist, public, signing, claim, refund and payout phases
/// @dev inherited contract must implement internal interface, see comments
///  intended usage via 'withStateTransition' modifier which makes sure that state machine transitions into
///  correct state before executing function body. note that this is contract state changing modifier so use with care
/// @dev timed state change request is publicly accessible via 'handleTimedTransitions'
/// @dev time is based on block.timestamp
contract ETOTimedStateMachine is IETOCommitment {

    ////////////////////////
    // CONSTANTS
    ////////////////////////

    uint32 private constant TS_STATE_NOT_SET = 1;

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

    // @dev This modifier needs to be applied to all external non-constant functions.
    //  this modifier goes _before_ other state modifiers like `onlyState`.
    //  after function body execution state may transition again in `advanceLogicState`
    modifier withStateTransition() {
        // switch state due to time
        advanceTimedState();
        // execute function body
        _;
        // switch state due to business logic
        advanceLogicState();
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

    constructor()
        internal
    {
        // set values to past timed transitions to reduce future gas cost
        _pastStateTransitionTimes = [
            TS_STATE_NOT_SET, TS_STATE_NOT_SET, TS_STATE_NOT_SET, TS_STATE_NOT_SET, TS_STATE_NOT_SET, TS_STATE_NOT_SET, TS_STATE_NOT_SET
            ];
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

    //
    // Implements ICommitment
    //

    // says if state is final
    function finalized()
        public
        constant
        returns (bool)
    {
        return (_state == State.Refund || _state == State.Payout);
    }

    // says if state is success
    function success()
        public
        constant
        returns (bool)
    {
        return (_state == State.Claim || _state == State.Payout);
    }

    // says if state is filure
    function failed()
        public
        constant
        returns (bool)
    {
        return _state == State.Refund;
    }

    //
    // Implement IETOCommitment
    //

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
        return startOfInternal(s);
    }

    ////////////////////////
    // Internal Interface
    ////////////////////////

    /// @notice called before state transitions, allows override transition due to additional business logic
    /// @dev advance due to time implemented in advanceTimedState, here implement other conditions like
    ///     max cap reached -> we go to signing
    function mBeforeStateTransition(State oldState, State newState)
        internal
        constant
        returns (State newStateOverride);

    /// @notice gets called after every state transition.
    function mAfterTransition(State oldState, State newState)
        internal;

    /// @notice gets called after business logic, may induce state transition
    function mAdavanceLogicState(State oldState)
        internal
        constant
        returns (State);



    ////////////////////////
    // Internal functions
    ////////////////////////

    function setupDurations(ETODurationTerms durationTerms)
        internal
    {
        require(ETO_STATE_DURATIONS[uint32(State.Signing)] != 0, "DUR_SET_ONCE");

        ETO_STATE_DURATIONS[uint32(State.Whitelist)] = durationTerms.WHITELIST_DURATION();
        ETO_STATE_DURATIONS[uint32(State.Public)] = durationTerms.PUBLIC_DURATION();
        ETO_STATE_DURATIONS[uint32(State.Signing)] = durationTerms.SIGNING_DURATION();
        ETO_STATE_DURATIONS[uint32(State.Claim)] = durationTerms.CLAIM_DURATION();
    }

    function runTimedStateMachine(uint32 startDate)
        internal
    {
        // this sets expiration of setup state
        _pastStateTransitionTimes[uint32(State.Setup)] = startDate;
    }

    function startOfInternal(State s)
        internal
        constant
        returns (uint256)
    {
        // initial state does not have start time
        if (s == State.Setup) {
            return 0;
        }

        // if timed state machine was not run, the next state will never come
        // if (_pastStateTransitionTimes[uint32(State.Setup)] == 0) {
        //    return 0xFFFFFFFF;
        // }

        // special case for Refund
        if (s == State.Refund) {
            return _state == s ? _pastStateTransitionTimes[uint32(_state)] : 0;
        }
        // current and previous states: just take s - 1 which is the end of previous state
        if (uint32(s) - 1 <= uint32(_state)) {
            return _pastStateTransitionTimes[uint32(s) - 1];
        }
        // for future states
        uint256 currStateExpiration = _pastStateTransitionTimes[uint32(_state)];
        // this trick gets start of required state by adding all durations between current and required states
        // note that past and current state were handled above so required state is in the future
        // we also rely on terminal states having duration of 0
        for (uint256 stateIdx = uint32(_state) + 1; stateIdx <= uint32(s); stateIdx++) {
            currStateExpiration += ETO_STATE_DURATIONS[stateIdx];
        }
        return currStateExpiration;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    // @notice time induced state transitions, called before logic
    // @dev don't use `else if` and keep sorted by time and call `state()`
    //     or else multiple transitions won't cascade properly.
    function advanceTimedState()
        private
    {
        // if timed state machine was not run, the next state will never come
        if (_pastStateTransitionTimes[uint32(State.Setup)] == 0) {
            return;
        }

        uint256 t = block.timestamp;
        if (_state == State.Setup && t >= startOfInternal(State.Whitelist)) {
            transitionTo(State.Whitelist);
        }
        if (_state == State.Whitelist && t >= startOfInternal(State.Public)) {
            transitionTo(State.Public);
        }
        if (_state == State.Public && t >= startOfInternal(State.Claim)) {
            transitionTo(State.Claim);
        }
        // signing to refund
        if (_state == State.Signing && t >= startOfInternal(State.Refund)) {
            transitionTo(State.Refund);
        }
        // claim to payout
        if (_state == State.Claim && t >= startOfInternal(State.Payout)) {
            transitionTo(State.Payout);
        }
    }

    // @notice transitions due to business logic
    // @dev called after logic
    function advanceLogicState()
        private
    {
        State newState = mAdavanceLogicState(_state);
        if (_state != newState) {
            transitionTo(newState);
        }
    }

    /// @notice executes transition state function
    function transitionTo(State newState)
        private
    {
        State oldState = _state;
        State effectiveNewState = mBeforeStateTransition(oldState, newState);
        require(validTransition(oldState, effectiveNewState));

        _state = effectiveNewState;
        // we have 60+ years for 2^32 overflow on epoch so disregard
        _pastStateTransitionTimes[uint32(oldState)] = uint32(block.timestamp);
        _pastStateTransitionTimes[uint32(effectiveNewState)] = uint32(block.timestamp) + ETO_STATE_DURATIONS[uint32(effectiveNewState)];
        emit LogStateTransition(uint32(oldState), uint32(effectiveNewState));

        // should not change _state
        mAfterTransition(oldState, effectiveNewState);
        assert(_state == effectiveNewState);
    }

    function validTransition(State oldState, State newState)
        private
        pure
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
