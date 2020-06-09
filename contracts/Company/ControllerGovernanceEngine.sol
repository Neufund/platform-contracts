pragma solidity 0.4.26;

import "../Agreement.sol";
import "./IControllerGovernanceEngine.sol";
import "./MGovernanceObserver.sol";


contract ControllerGovernanceEngine is
    Agreement,
    IControllerGovernanceEngine,
    MGovernanceObserver
{

    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NF_GOV_NOT_EXECUTING = "NF_GOV_NOT_EXECUTING";
    string private constant NF_GOV_INVALID_NEXT_STEP = "NF_GOV_INVALID_NEXT_STEP";
    string private constant NF_GOV_UNKEPT_PROMISE = "NF_GOV_UNKEPT_PROMISE";

    ////////////////////////
    // Mutable state
    ////////////////////////

    Gov.GovernanceStorage internal _g;
    Gov.TokenStorage internal _t;

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
            terminateIfExecuting(resolutionId, e);
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

    modifier withGovernanceTitle(
        bytes32 resolutionId,
        Gov.Action action,
        string title,
        string documentUrl)
    {
        if (withGovernancePrivate(resolutionId, action, title, documentUrl) == Gov.ExecutionState.Executing) {
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
            // no need to write final step as execution ends here
            terminateIfExecuting(resolutionId, e);
        }
    }

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
    // Implements IVotingObserver
    //

    function onProposalStateTransition(
        bytes32 /*proposalId*/,
        uint8 /*oldState*/,
        uint8 /*newState*/)
        public
    {}

    function votingResult(address votingCenter, bytes32 proposalId)
        public
        constant
        returns (bool inFavor)
    {
        // delegatecall
        return Gov.hasProposalPassed(_t, IVotingCenter(votingCenter), proposalId) == Gov.ExecutionState.Executing;
    }

    //
    // Implements IControllerGovernanceEngine
    //

    function state()
        public
        constant
        returns (
            Gov.State s
            )
    {
        return
            _g._state;
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
            uint8 action,
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

    function migrateResolutions(
        bytes32[] resolutionId,
        uint8[] action,
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

    // amends bylaws for the governance (main) token - typically equity token
    function amendGovernance(bytes32 resolutionId, ITokenholderRights newTokenholderRights)
        internal
    {
        // for controller without governance token this will fall back to None which excludes THR/SHR escalation
        // but supports all other bylaws
        _t._tokenholderRights = newTokenholderRights;
        emit LogTokenholderRightsAmended(resolutionId, _t._type, _t._token, _t._tokenholderRights);
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

    function terminateResolution(bytes32 resolutionId, Gov.ResolutionExecution storage e, Gov.ExecutionState s)
        internal
    {
        e.state = s;
        e.finishedAt = uint32(now);
        emit LogResolutionExecuted(resolutionId, e.action, s);
    }

    function terminateResolutionWithCode(bytes32 resolutionId, Gov.ResolutionExecution storage e, string memory code)
        internal
    {
        bytes32 failedCode = keccak256(abi.encodePacked(code));
        terminateResolution(resolutionId, e, Gov.ExecutionState.Failed);
        // no point of merging storage write, failed code occupies the whole slot
        e.failedCode = failedCode;
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function withGovernancePrivate(bytes32 resolutionId, Gov.Action action, string documentUrl)
        private
        returns (Gov.ExecutionState)
    {
        return withGovernancePrivate(resolutionId, action, "", documentUrl);
    }

    function withGovernancePrivate(bytes32 resolutionId, Gov.Action action, string title, string documentUrl)
        private
        returns (Gov.ExecutionState)
    {
        // call library with delegate call
        bytes memory cdata = msg.data;
        (Gov.ExecutionState prevState, Gov.ExecutionState nextState) = Gov.startResolutionExecution(
            _g,
            _t,
            resolutionId,
            uint8(action),
            cdata
        );
        // emit event only when transitioning from new to !new
        if (prevState == Gov.ExecutionState.New && nextState != Gov.ExecutionState.New) {
            emit LogResolutionStarted(resolutionId, _t._token, title, documentUrl, uint8(action), nextState, cdata);
        }
        // if we get terminal state, emit event
        if (nextState == Gov.ExecutionState.Rejected) {
            emit LogResolutionExecuted(resolutionId, uint8(action), nextState);
        }
        return nextState;
    }

    function terminateIfExecuting(bytes32 resolutionId, Gov.ResolutionExecution storage e)
        private
    {
        if (e.state == Gov.ExecutionState.Executing) {
            terminateResolution(resolutionId, e, Gov.ExecutionState.Completed);
        }
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
        require(s == Gov.ExecutionState.New || s == Gov.ExecutionState.Escalating, "NF_GOV_ALREADY_EXECUTED");
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
}
