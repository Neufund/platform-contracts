pragma solidity 0.4.26;

import "../Agreement.sol";
import "./Gov.sol";
import "../Standards/IContractId.sol";


contract ControllerGovernanceEngine is
    Agreement
{
    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerGovernanceEngineId = 0xd8b228c791b70f75338df4d4d644c638f1a58faec0b2f187daf42fb3722af438;
    uint256 internal constant ControllerGovernanceEngineV = 0;

    ////////////////////////
    // Events
    ////////////////////////

    // logged on controller state transition
    event LogGovStateTransition(
        uint32 oldState,
        uint32 newState,
        uint32 timestamp
    );

    // logged when new resolution is registered for execution
    event LogResolutionStarted(
        bytes32 indexed resolutionId,
        string resolutionTitle,
        string documentUrl,
        Gov.Action action,
        Gov.ExecutionState state,
        bytes promise
    );

    // logged on action that is a result of shareholder resolution (on-chain, off-chain), or should be shareholder resolution
    event LogResolutionExecuted(
        bytes32 indexed resolutionId,
        Gov.Action action,
        Gov.ExecutionState state
    );

    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NF_GOV_NOT_EXECUTING = "NF_GOV_NOT_EXECUTING";
    string private constant NF_GOV_INVALID_NEXT_STEP = "NF_GOV_INVALID_NEXT_STEP";
    string private constant NF_GOV_UNKEPT_PROMISE = "NF_GOV_UNKEPT_PROMISE";

    ////////////////////////
    // Mutable state
    ////////////////////////

    Gov.GovernanceStorage _g;

    // maps resolution to actions
    // mapping (uint256 => bytes32) private _exclusiveActions;

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyCompany() {
        require(msg.sender == _g.COMPANY_LEGAL_REPRESENTATIVE, "NF_ONLY_COMPANY");
        _;
    }

    modifier onlyOperational() {
        Gov.State s = _g._state;
        require(s == Gov.State.Offering || s == Gov.State.Funded || s == Gov.State.Closing, "NF_INV_STATE");
        _;
    }

    modifier onlyState(Gov.State state) {
        require(_g._state == state, "NF_INV_STATE");
        _;
    }

    modifier onlyStates(Gov.State state1, Gov.State state2) {
        Gov.State s = _g._state;
        require(s == state1 || s == state2, "NF_INV_STATE");
        _;
    }

    // starts new governance execution that can happen in multiple steps so no cleanup is preformed at the end
    // instead timeout will be watched
    modifier withNonAtomicExecution(
        bytes32 resolutionId,
        function (Gov.ResolutionExecution storage) constant returns (string memory) validator)
    {
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        // prevent to execute twice
        require(e.state != Gov.ExecutionState.Executing, "NF_GOV_ALREADY_EXECUTED");
        // validate resolution
        if(validateResolution(resolutionId, e, validator)) {
            _;
            // does not set resolution as completed, registers timeout
        }
    }

    // TODO: cancels non-atomic execution that had a timeout
    modifier withNonAtomicExecutionCancellation(bytes32 resolutionId, bytes32 promise) {
        // if it's cancelation time then cancels execution and executes cancelation function
        _;
        // terminate
    }

    // starts new governance execution that must complete in single transaction once it enters Executing state
    modifier withAtomicExecution(
        bytes32 resolutionId,
        function (Gov.ResolutionExecution storage) constant returns (string memory) validator)
    {
        // validate resolution
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        if(validateResolution(resolutionId, e, validator)) {
            _;
            if (e.state == Gov.ExecutionState.Executing) {
                terminateResolution(resolutionId, e, Gov.ExecutionState.Completed);
            }
        }
    }

    modifier withGovernance(
        bytes32 resolutionId,
        Gov.Action action,
        string documentUrl)
    {
        if (withGovernancePrivate(resolutionId, action, documentUrl) == Gov.ExecutionState.Executing) {
            // inner modifiers and function body only in Executing state
            _;
        }
    }

    // continues non-atomic governance execution in Executing state on the same promise allowing
    // for the resolution to be continued in another Ethereum transaction
    modifier withNonAtomicContinuedExecution(
        bytes32 resolutionId,
        bytes32 promise,
        uint8 nextStep)
    {
        // validate resolution
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        if(validateResolutionContinuation(e, promise, nextStep)) {
            _;
            // if next step > 0 then store it
            if (nextStep > 0) {
                e.nextStep = nextStep;
            }
        }
    }

    // continues non-atomic governance execution in Executing state on the same promise in single Ethereum tx
    modifier withAtomicContinuedExecution(
        bytes32 resolutionId,
        bytes32 promise,
        uint8 nextStep)
    {
        // validate resolution
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        if(validateResolutionContinuation(e, promise, nextStep)) {
            // validate timeout
            _;
            if (e.state == Gov.ExecutionState.Executing) {
                // no need to write final step as execution ends here
                terminateResolution(resolutionId, e, Gov.ExecutionState.Completed);
            }
        }
    }

    /*modifier withExclusiveAction(bytes32 resolutionId, Gov.Action action) {
        if (withExclusiveActionPrivate(resolutionId, action)) {
            _;
        }
    }*/

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        Universe universe,
        address companyLegalRep
    )
        internal
        Agreement(universe.accessPolicy(), universe.forkArbiter())
    {
        _g.UNIVERSE = universe;
        _g.COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
    }

    //
    // Implements IControllerGovernance
    //

    function state()
        public
        constant
        returns (Gov.State)
    {
        return _g._state;
    }

    function companyLegalRepresentative()
        public
        constant
        returns (address)
    {
        return _g.COMPANY_LEGAL_REPRESENTATIVE;
    }

    //
    // Resolution storage access
    //

    function resolutionsList()
        public
        constant
        returns (bytes32[])
    {
        return _g._resolutionIds;
    }

    function resolution(bytes32 resolutionId)
        public
        constant
        returns (
            Gov.Action action,
            Gov.ExecutionState,
            uint32 startedAt,
            uint32 finishedAt,
            bytes32 failedCode,
            bytes32 promise,
            bytes32 payload,
            uint32 cancelAt,
            uint8 nextStep
        )
    {
        Gov.ResolutionExecution storage e = _g._resolutions[resolutionId];
        return (
            e.action,
            e.state,
            e.startedAt,
            e.finishedAt,
            e.failedCode,
            e.promise,
            e.payload,
            e.cancelAt,
            e.nextStep
        );
    }

    //
    // Migration storage access
    //

    function migrateGovernance(EquityTokenholderRights tokenholderRights, IEquityToken equityToken)
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        _g._tokenholderRights = tokenholderRights;
        _g._equityToken = equityToken;
    }

    function migrateResolutions(
        bytes32[] resolutionId,
        Gov.Action[] action,
        Gov.ExecutionState[] s,
        uint32[] startedAt,
        uint32[] finishedAt,
        bytes32[] failedCode,
        bytes32[] promise,
        bytes32[] payload,
        uint32[] cancelAt,
        uint8[] nextStep
    )
        public
        onlyState(Gov.State.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        // assert(resolutionId.length == action.length == state.length == startedAt.length == finishedAt.length == failedCode.length == promise.length);
        for(uint256 ii = 0; ii < resolutionId.length; ii++) {
            bytes32 rId = resolutionId[ii];
            _g._resolutions[rId] = Gov.ResolutionExecution({
                action: action[ii],
                state: s[ii],
                startedAt: startedAt[ii],
                finishedAt: finishedAt[ii],
                failedCode: failedCode[ii],
                promise: promise[ii],
                payload: payload[ii],
                cancelAt: cancelAt[ii],
                nextStep: nextStep[ii]
            });
            _g._resolutionIds.push(rId);
        }
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    function transitionTo(Gov.State newState)
        internal
    {
        emit LogGovStateTransition(uint32(_g._state), uint32(newState), uint32(block.timestamp));
        _g._state = newState;
    }

    // defines validator function that will be called before resolution execution is started or continued
    // returns revert code on error or string of length zero when passing
    function defaultValidator(Gov.ResolutionExecution storage /*e*/)
        internal
        constant
        returns (string memory /*code*/)
    {
        // it's possible to decode msg.data to recover call parameters
    }

    /*function isResolutionTerminated(Gov.ExecutionState s)
        internal
        pure
        returns (bool)
    {
        return !(s == Gov.ExecutionState.New || s == Gov.ExecutionState.Escalating || s == Gov.ExecutionState.Executing);
    }*/

    function terminateResolution(bytes32 resolutionId, Gov.ResolutionExecution storage e, Gov.ExecutionState s)
        internal
    {
        e.state = s;
        e.finishedAt = uint32(now);
        emit LogResolutionExecuted(resolutionId, e.action, s);
        // cleanup action
        // delete _exclusiveActions[uint256(e.action)];
    }

    function terminateResolutionWithCode(bytes32 resolutionId, Gov.ResolutionExecution storage e, string memory code)
        internal
    {
        bytes32 failedCode = keccak256(abi.encodePacked(code));
        terminateResolution(resolutionId, e, Gov.ExecutionState.Failed);
        // no point of merging storage write, failed code occupies the whole slot
        e.failedCode = failedCode;
    }

    function promiseForSelector(bytes4 selector)
        internal
        pure
        returns (bytes32)
    {
        // replace selector and return keccak
        bytes memory calldata = msg.data;
        assembly {
            // patch calldata with the selector
            mstore8(add(calldata, 32), byte(0, selector))
            mstore8(add(calldata, 33), byte(1, selector))
            mstore8(add(calldata, 34), byte(2, selector))
            mstore8(add(calldata, 35), byte(3, selector))
        }
        return keccak256(calldata);
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function withGovernancePrivate(bytes32 resolutionId, Gov.Action action, string documentUrl)
        public
        returns (Gov.ExecutionState)
    {
        // call library with delegate call
        bytes memory cdata = msg.data;
        (Gov.ExecutionState prevState, Gov.ExecutionState nextState) = Gov.startResolutionExecution(_g, resolutionId, action, keccak256(cdata));
        // emit event only when transitioning from new to !new
        if (prevState == Gov.ExecutionState.New && nextState != Gov.ExecutionState.New) {
            emit LogResolutionStarted(resolutionId, "", documentUrl, action, nextState, cdata);
        }
        return nextState;
    }

    // guard method for atomic and non atomic executions that will revert or fail resolution that cannot execute further
    function validateResolution(
        bytes32 resolutionId,
        Gov.ResolutionExecution storage e,
        function (Gov.ResolutionExecution storage) constant returns (string memory) validator
    )
        private
        returns (bool)
    {
        // if resolution is already terminated always revert
        Gov.ExecutionState s = e.state;
        require(s == Gov.ExecutionState.New || s == Gov.ExecutionState.Escalating, "NF_GOV_RESOLUTION_TERMINATED");
        // curried functions are not available in Solidity so we cannot pass any custom parameters
        // however msg.data is available and contains all call parameters
        string memory code = validator(e);
        // no problems reported
        if (bytes(code).length == 0) {
            return true;
        }
        // revert if new
        require(s != Gov.ExecutionState.New, code);
        // if resolution is executing then set resolution to fail and continue for cleanup
        terminateResolutionWithCode(resolutionId, e, code);
        return false;
    }

    function validateResolutionContinuation(Gov.ResolutionExecution storage e, bytes32 promise, uint8 nextStep)
        private
        constant
        returns (bool)
    {
        require(e.state == Gov.ExecutionState.Executing, NF_GOV_NOT_EXECUTING);
        require(nextStep == 0 || e.nextStep == nextStep - 1, NF_GOV_INVALID_NEXT_STEP);
        // we must call executing function with same params
        require(e.promise == promise, NF_GOV_UNKEPT_PROMISE);
        // TODO: validate timeout
        return true;
    }



    /*function withExclusiveActionPrivate(bytes32 resolutionId, Gov.Action action)
        internal
        returns (bool)
    {
        // makes sure there's no other action of this kind being executed
        bytes32 existingResolutionId = _exclusiveActions[uint256(action)];
        bool notExecuting = (existingResolutionId == bytes32(0) || existingResolutionId == resolutionId);
        if (!notExecuting) {
            // Gov.ResolutionExecution storage e = _resolutions[existingResolutionId];
            notExecuting = true; //e.state == Escalating || isExecutionTerminalState(e.state)
        }
        if (notExecuting) {
            // makes resolution exclusive
            if (existingResolutionId != resolutionId) {
                _exclusiveActions[uint256(action)] = resolutionId;
            }
            // execute inner modifiers and function body
            return true;
        } else {
            revert("NF_GOV_EXECUTOR_NOT_UNIQUE");
        }
    }*/
}
