pragma solidity 0.4.24;

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

    // uint32 private constant TS_STATE_NOT_SET = 1;

    ////////////////////////
    // Immutable state
    ////////////////////////

    // maps states to durations (index is ETOState)
    uint32[] private ETO_STATE_DURATIONS;

    // observer receives notifications on all state changes
    IETOCommitmentObserver private COMMITMENT_OBSERVER;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // current state
    ETOState private _state = ETOState.Setup;

    // historical times of state transition (index is ETOState)
    // internal access used to allow mocking time
    uint32[7] internal _pastStateTransitionTimes;

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

    modifier onlyState(ETOState state) {
        require(_state == state);
        _;
    }

    modifier onlyStates(ETOState state0, ETOState state1) {
        require(_state == state0 || _state == state1);
        _;
    }

    /// @dev Multiple states can be handled by adding more modifiers.
    /* modifier notInState(ETOState state) {
        require(_state != state);
        _;
    }*/

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
        return (_state == ETOState.Refund || _state == ETOState.Payout);
    }

    // says if state is success
    function success()
        public
        constant
        returns (bool)
    {
        return (_state == ETOState.Claim || _state == ETOState.Payout);
    }

    // says if state is filure
    function failed()
        public
        constant
        returns (bool)
    {
        return _state == ETOState.Refund;
    }

    //
    // Implement IETOCommitment
    //

    function state()
        public
        constant
        returns (ETOState)
    {
        return _state;
    }

    function startOf(ETOState s)
        public
        constant
        returns (uint256)
    {
        return startOfInternal(s);
    }

    function startOfStates()
        public
        constant
        returns (uint256[7] startOfs)
    {
        // 7 is number of states
        for(uint256 ii=0;ii<ETO_STATES_COUNT;ii++) {
            startOfs[ii] = startOfInternal(ETOState(ii));
        }
    }

    function commitmentObserver() public constant returns (IETOCommitmentObserver) {
        return COMMITMENT_OBSERVER;
    }

    ////////////////////////
    // Internal Interface
    ////////////////////////

    /// @notice called before state transitions, allows override transition due to additional business logic
    /// @dev advance due to time implemented in advanceTimedState, here implement other conditions like
    ///     max cap reached -> we go to signing
    function mBeforeStateTransition(ETOState oldState, ETOState newState)
        internal
        constant
        returns (ETOState newStateOverride);

    /// @notice gets called after every state transition.
    function mAfterTransition(ETOState oldState, ETOState newState)
        internal;

    /// @notice gets called after business logic, may induce state transition
    function mAdavanceLogicState(ETOState oldState)
        internal
        constant
        returns (ETOState);



    ////////////////////////
    // Internal functions
    ////////////////////////

    function setupStateMachine(ETODurationTerms durationTerms, IETOCommitmentObserver observer)
        internal
    {
        require(COMMITMENT_OBSERVER == address(0), "STM_SET_ONCE");
        require(observer != address(0));

        COMMITMENT_OBSERVER = observer;
        ETO_STATE_DURATIONS = [
            0, durationTerms.WHITELIST_DURATION(), durationTerms.PUBLIC_DURATION(), durationTerms.SIGNING_DURATION(),
            durationTerms.CLAIM_DURATION(), 0, 0
            ];
    }

    function runStateMachine(uint32 startDate)
        internal
    {
        // this sets expiration of setup state
        _pastStateTransitionTimes[uint32(ETOState.Setup)] = startDate;
    }

    function startOfInternal(ETOState s)
        internal
        constant
        returns (uint256)
    {
        // initial state does not have start time
        if (s == ETOState.Setup) {
            return 0;
        }

        // if timed state machine was not run, the next state will never come
        // if (_pastStateTransitionTimes[uint32(ETOState.Setup)] == 0) {
        //    return 0xFFFFFFFF;
        // }

        // special case for Refund
        if (s == ETOState.Refund) {
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
        for (uint256 stateIdx = uint32(_state) + 1; stateIdx < uint32(s); stateIdx++) {
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
        if (_pastStateTransitionTimes[uint32(ETOState.Setup)] == 0) {
            return;
        }

        uint256 t = block.timestamp;
        if (_state == ETOState.Setup && t >= startOfInternal(ETOState.Whitelist)) {
            transitionTo(ETOState.Whitelist);
        }
        if (_state == ETOState.Whitelist && t >= startOfInternal(ETOState.Public)) {
            transitionTo(ETOState.Public);
        }
        if (_state == ETOState.Public && t >= startOfInternal(ETOState.Signing)) {
            transitionTo(ETOState.Signing);
        }
        // signing to refund: first we check if it's claim time and if it we go
        // for refund. to go to claim agreement MUST be signed, no time transition
        if (_state == ETOState.Signing && t >= startOfInternal(ETOState.Claim)) {
            transitionTo(ETOState.Refund);
        }
        // claim to payout
        if (_state == ETOState.Claim && t >= startOfInternal(ETOState.Payout)) {
            transitionTo(ETOState.Payout);
        }
    }

    // @notice transitions due to business logic
    // @dev called after logic
    function advanceLogicState()
        private
    {
        ETOState newState = mAdavanceLogicState(_state);
        if (_state != newState) {
            transitionTo(newState);
        }
    }

    /// @notice executes transition state function
    function transitionTo(ETOState newState)
        private
    {
        ETOState oldState = _state;
        ETOState effectiveNewState = mBeforeStateTransition(oldState, newState);
        // require(validTransition(oldState, effectiveNewState));

        _state = effectiveNewState;
        // we have 60+ years for 2^32 overflow on epoch so disregard
        _pastStateTransitionTimes[uint256(oldState)] = uint32(block.timestamp);
        _pastStateTransitionTimes[uint256(effectiveNewState)] = uint32(block.timestamp) + ETO_STATE_DURATIONS[uint256(effectiveNewState)];
        emit LogStateTransition(uint32(oldState), uint32(effectiveNewState), uint32(block.timestamp));

        // should not change _state
        mAfterTransition(oldState, effectiveNewState);
        assert(_state == effectiveNewState);
        // should notify observer
        COMMITMENT_OBSERVER.onStateTransition(oldState, newState);
    }

    /*function validTransition(ETOState oldState, ETOState newState)
        private
        pure
        returns (bool valid)
    {
        // TODO: think about disabling it before production deployment
        // (oldState == ETOState.Setup && newState == ETOState.Public) ||
        // (oldState == ETOState.Setup && newState == ETOState.Refund) ||
        return
            (oldState == ETOState.Setup && newState == ETOState.Whitelist) ||
            (oldState == ETOState.Whitelist && newState == ETOState.Public) ||
            (oldState == ETOState.Whitelist && newState == ETOState.Signing) ||
            (oldState == ETOState.Public && newState == ETOState.Signing) ||
            (oldState == ETOState.Public && newState == ETOState.Refund) ||
            (oldState == ETOState.Signing && newState == ETOState.Refund) ||
            (oldState == ETOState.Signing && newState == ETOState.Claim) ||
            (oldState == ETOState.Claim && newState == ETOState.Payout);
    }*/
}
