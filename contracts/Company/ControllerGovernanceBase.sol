pragma solidity 0.4.26;

import "../Universe.sol";
import "../Agreement.sol";
import "../Math.sol";
import "./IControllerGovernance.sol";
import "./IEquityToken.sol";


contract ControllerGovernanceBase is
    IControllerGovernance,
    Agreement,
    Math
{
    ////////////////////////
    // Immutable state
    ////////////////////////

    // a root of trust contract
    Universe internal UNIVERSE;

    // company representative address
    address internal COMPANY_LEGAL_REPRESENTATIVE;

    ////////////////////////
    // Mutable state
    ////////////////////////

     // set of shareholder rights that will be executed
    ShareholderRights internal _shareholderRights;

    // equity token from ETO
    IEquityToken internal _equityToken;

    // controller lifecycle state
    GovState internal _state;

    // resolutions being executed
    mapping (bytes32 => ResolutionExecution) internal _resolutions;
    bytes32[] internal _resolutionIds;

    // maps resolution to actions
    // mapping (uint256 => bytes32) private _exclusiveActions;

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyCompany() {
        require(msg.sender == COMPANY_LEGAL_REPRESENTATIVE, "NF_ONLY_COMPANY");
        _;
    }

    modifier onlyOperational() {
        require(_state == GovState.Offering || _state == GovState.Funded || _state == GovState.Closing, "NF_INV_STATE");
        _;
    }

    modifier onlyState(GovState state) {
        require(_state == state, "NF_INV_STATE");
        _;
    }

    modifier onlyStates(GovState state1, GovState state2) {
        require(_state == state1 || _state == state2, "NF_INV_STATE");
        _;
    }

    // starts new governance execution that can happen in multiple steps so no cleanup is preformed at the end
    // instead timeout will be watched
    modifier withNonAtomicExecution(
        bytes32 resolutionId,
        function (ResolutionExecution storage) constant returns (string memory) validator)
    {
        // validate resolution
        ResolutionExecution storage e = _resolutions[resolutionId];
        if(validateResolution(resolutionId, keccak256(msg.data), e, validator)) {
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
        function (ResolutionExecution storage) constant returns (string memory) validator)
    {
        // validate resolution
        ResolutionExecution storage e = _resolutions[resolutionId];
        if(validateResolution(resolutionId, keccak256(msg.data), e, validator)) {
            _;
            if (e.state == ExecutionState.Executing) {
                terminateResolution(resolutionId, e, ExecutionState.Completed);
            }
        }
    }

    modifier withGovernance(
        bytes32 resolutionId,
        Action action,
        function (ResolutionExecution storage) constant returns (ExecutionState) escalator)
    {
        if (withGovernancePrivate(resolutionId, action, escalator) == ExecutionState.Executing) {
            // inner modifiers and function body only in Executing state
            _;
        }
    }

    // continues non-atomic governance execution in Executing state on the same promise allowing
    // for the resolution to be continued in another Ethereum transaction
    modifier withNonAtomicContinuedExecution(
        bytes32 resolutionId,
        bytes32 promise,
        function (ResolutionExecution storage) constant returns (string memory) validator)
    {
        // validate resolution
        ResolutionExecution storage e = _resolutions[resolutionId];
        require(e.state == ExecutionState.Executing, "NF_GOV_NOT_EXECUTING");
        if(validateResolution(resolutionId, promise, e, validator)) {
            // validate timeout
            _;
        }
    }

    // continues non-atomic governance execution in Executing state on the same promise in single Ethereum tx
    modifier withAtomicContinuedExecution(
        bytes32 resolutionId,
        bytes32 promise,
        function (ResolutionExecution storage) constant returns (string memory) validator)
    {
        // validate resolution
        ResolutionExecution storage e = _resolutions[resolutionId];
        require(e.state == ExecutionState.Executing, "NF_GOV_NOT_EXECUTING");
        if(validateResolution(resolutionId, promise, e, validator)) {
            // validate timeout
            _;
            if (e.state == ExecutionState.Executing) {
                terminateResolution(resolutionId, e, ExecutionState.Completed);
            }
        }
    }

    /*modifier withExclusiveAction(bytes32 resolutionId, Action action) {
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
        UNIVERSE = universe;
        COMPANY_LEGAL_REPRESENTATIVE = companyLegalRep;
    }

    //
    // Implements IControllerGovernance
    //

    function state()
        public
        constant
        returns (GovState)
    {
        return _state;
    }

    function companyLegalRepresentative()
        public
        constant
        returns (address)
    {
        return COMPANY_LEGAL_REPRESENTATIVE;
    }

    //
    // Resolution storage access
    //

    function resolutionsList()
        public
        constant
        returns (bytes32[])
    {
        return _resolutionIds;
    }

    function resolution(bytes32 resolutionId)
        public
        constant
        returns (
            Action action,
            ExecutionState s,
            uint32 startedAt,
            uint32 finishedAt,
            bytes32 failedCode,
            bytes32 promise
        )
    {
        ResolutionExecution storage e = _resolutions[resolutionId];
        return (
            e.action,
            e.state,
            e.startedAt,
            e.finishedAt,
            e.failedCode,
            e.promise
        );
    }

    //
    // Migration storage access
    //

    function migrateGovernance(ShareholderRights shareholderRights, IEquityToken equityToken)
        public
        onlyState(GovState.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        _shareholderRights = shareholderRights;
        _equityToken = equityToken;
    }

    function migrateResolutions(
        bytes32[] resolutionId,
        Action[] action,
        ExecutionState[] s,
        uint32[] startedAt,
        uint32[] finishedAt,
        bytes32[] failedCode,
        bytes32[] promise
    )
        public
        onlyState(GovState.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        // assert(resolutionId.length == action.length == state.length == startedAt.length == finishedAt.length == failedCode.length == promise.length);
        for(uint256 ii = 0; ii < resolutionId.length; ii++) {
            bytes32 rId = resolutionId[ii];
            _resolutions[rId] = ResolutionExecution({
                action: action[ii],
                state: s[ii],
                startedAt: startedAt[ii],
                finishedAt: finishedAt[ii],
                failedCode: failedCode[ii],
                promise: promise[ii]
            });
            _resolutionIds.push(rId);
        }
    }


    ////////////////////////
    // Internal functions
    ////////////////////////

    function transitionTo(GovState newState)
        internal
    {
        emit LogGovStateTransition(uint32(_state), uint32(newState), uint32(block.timestamp));
        _state = newState;
    }

    // defines validator function that will be called before resolution execution is started or continued
    // returns revert code on error or string of length zero when passing
    function defaultValidator(ResolutionExecution storage /*e*/)
        internal
        constant
        returns (string memory /*code*/)
    {
        // it's possible to decode msg.data to recover call parameters
    }


    // defines permission escalation for resolution. based on resolution state, action and current shareholder rights
    // allows, escalates or denies execution.
    function defaultPermissionEscalator(ResolutionExecution storage e)
        internal
        constant
        returns (ExecutionState s)
    {
        if (e.state == ExecutionState.New) {
            if (_state == GovState.Setup) {
                // constructor can start any action, same for company in Setup state
                // constructor methodId is bytes(4) 0x0
                if (msg.sig != 0x0 && msg.sender != COMPANY_LEGAL_REPRESENTATIVE) {
                    s = ExecutionState.Rejected;
                } else {
                    s = ExecutionState.Executing;
                }
            } else {
                // TODO: check if voting in voting center -> this may happen in New state if there was
                // permission escalation into campaign state of voting so voting is not yet official

                // if no voting rights permission escalation is not possible and legal rep can trigger any action
                if (_shareholderRights.GENERAL_VOTING_RULE() == VotingRule.NoVotingRights) {
                    s = msg.sender == COMPANY_LEGAL_REPRESENTATIVE ? ExecutionState.Executing : ExecutionState.Rejected;
                } else {
                    // 1. start voting is campaign mode if msg.sender is equity token holder
                    // 2. start voting offically if msg.sender is company or token holder with N% stake
                    // 3. for some action legal rep can start without escalation
                    s = ExecutionState.Escalating;
                }
            }

        }
    }

    function isResolutionTerminated(ExecutionState s)
        internal
        pure
        returns (bool)
    {
        return !(s == ExecutionState.New || s == ExecutionState.Escalating || s == ExecutionState.Executing);
    }

    function terminateResolution(bytes32 resolutionId, ResolutionExecution storage e, ExecutionState s)
        internal
    {
        e.state = s;
        e.finishedAt = uint32(now);
        emit LogResolutionExecuted(resolutionId, Action.RegisterOffer, s);
        // cleanup action
        // delete _exclusiveActions[uint256(e.action)];
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    // guard method for atomic and non atomic executions that will revert or fail resolution that cannot execute further
    function validateResolution(
        bytes32 resolutionId,
        bytes32 promise,
        ResolutionExecution storage e,
        function (ResolutionExecution storage) constant returns (string memory) validator
    )
        private
        returns (bool)
    {
        // if resolution is already terminated always revert
        require(!isResolutionTerminated(e.state), "NF_GOV_RESOLUTION_TERMINATED");
        // TODO: revert on cancellation

        bool isNew = e.state == ExecutionState.New;
        // we must call executing function with same params
        require(isNew || e.promise == promise, "NF_GOV_UNKEPT_PROMISE");
        // if resolution is executing then set resolution to fail and continue for cleanup
        string memory code;
        if (_state == GovState.Closed || _state == GovState.Migrated ) {
            code = "NF_GOV_COMPANY_CLOSED";
        } else {
            // curried functions are not available in Solidity so we cannot pass any custom parameters
            // however msg.data is available and contains all call parameters
            code = validator(e);
        }
        // no problems reported
        if (bytes(code).length == 0) {
            return true;
        }
        // revert if new
        require(!isNew, code);
        // fail if executing
        bytes32 failedCode = keccak256(abi.encodePacked(code));
        terminateResolution(resolutionId, e, ExecutionState.Failed);
        e.failedCode = failedCode;

        return false;
    }

    function withGovernancePrivate(
        bytes32 resolutionId,
        Action action,
        function (ResolutionExecution storage) constant returns (ExecutionState) escalator
    )
        private
        returns (ExecutionState)
    {
        // executor checks resolutionId state
        ResolutionExecution storage e = _resolutions[resolutionId];
        // if new evaluates permissions and starts new voting if required
        if (e.state == ExecutionState.New) {
            ExecutionState s = escalator(e);
            require(s != ExecutionState.Rejected, "NF_GOV_EXEC_ACCESS_DENIED");
            // save new execution
            e.action = action;
            e.state = s;
            e.startedAt = uint32(now);
            // use calldata as promise
            e.promise = keccak256(msg.data);
            _resolutionIds.push(resolutionId);
            emit LogResolutionStarted(resolutionId, action, s);
        } else if (e.state == ExecutionState.Escalating) {
            // check voting results in voting center
            // if voting still there
            return;
            // if passed then execute
            // if failed then reject
        }
        return e.state;
    }

    /*function withExclusiveActionPrivate(bytes32 resolutionId, Action action)
        internal
        returns (bool)
    {
        // makes sure there's no other action of this kind being executed
        bytes32 existingResolutionId = _exclusiveActions[uint256(action)];
        bool notExecuting = (existingResolutionId == bytes32(0) || existingResolutionId == resolutionId);
        if (!notExecuting) {
            // ResolutionExecution storage e = _resolutions[existingResolutionId];
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
