pragma solidity 0.4.26;

import "../Universe.sol";
import "../Agreement.sol";
import "./GovernanceTypes.sol";
import "./IEquityToken.sol";
import "./EquityTokenholderRights.sol";
import "../Standards/IContractId.sol";


contract ControllerGovernanceEngine is
    GovernanceTypes,
    Agreement,
    IContractId
{
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
        Action action,
        ExecutionState state
    );

    // logged on action that is a result of shareholder resolution (on-chain, off-chain), or should be shareholder resolution
    event LogResolutionExecuted(
        bytes32 indexed resolutionId,
        Action action,
        ExecutionState state
    );

    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NF_GOV_NOT_EXECUTING = "NF_GOV_NOT_EXECUTING";
    string private constant NF_GOV_INVALID_NEXT_STEP = "NF_GOV_INVALID_NEXT_STEP";
    string private constant NF_GOV_UNKEPT_PROMISE = "NF_GOV_UNKEPT_PROMISE";

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

    // set of shareholder rights, typically of Nominee
    ShareholderRights internal _shareholderRights;

     // set of equity token rights associated with the token
    EquityTokenholderRights internal _tokenholderRights;

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
        ResolutionExecution storage e = _resolutions[resolutionId];
        // prevent to execute twice
        require(e.state != ExecutionState.Executing, "NF_GOV_ALREADY_EXECUTED");
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
        function (ResolutionExecution storage) constant returns (string memory) validator)
    {
        // validate resolution
        ResolutionExecution storage e = _resolutions[resolutionId];
        if(validateResolution(resolutionId, e, validator)) {
            _;
            if (e.state == ExecutionState.Executing) {
                terminateResolution(resolutionId, e, ExecutionState.Completed);
            }
        }
    }

    modifier withGovernance(
        bytes32 resolutionId,
        Action action,
        string documentUrl,
        function (Action) constant returns (ExecutionState) escalator)
    {
        if (withGovernancePrivate(resolutionId, action, documentUrl, escalator) == ExecutionState.Executing) {
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
        ResolutionExecution storage e = _resolutions[resolutionId];
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
        ResolutionExecution storage e = _resolutions[resolutionId];
        if(validateResolutionContinuation(e, promise, nextStep)) {
            // validate timeout
            _;
            if (e.state == ExecutionState.Executing) {
                // no need to write final step as execution ends here
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
            bytes32 promise,
            bytes32 payload,
            uint32 cancelAt,
            uint8 nextStep
        )
    {
        ResolutionExecution storage e = _resolutions[resolutionId];
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
        onlyState(GovState.Setup)
        only(ROLE_COMPANY_UPGRADE_ADMIN)
    {
        _shareholderRights = tokenholderRights;
        _tokenholderRights = tokenholderRights;
        _equityToken = equityToken;
    }

    function migrateResolutions(
        bytes32[] resolutionId,
        Action[] action,
        ExecutionState[] s,
        uint32[] startedAt,
        uint32[] finishedAt,
        bytes32[] failedCode,
        bytes32[] promise,
        bytes32[] payload,
        uint32[] cancelAt,
        uint8[] nextStep
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
                promise: promise[ii],
                payload: payload[ii],
                cancelAt: cancelAt[ii],
                nextStep: nextStep[ii]
            });
            _resolutionIds.push(rId);
        }
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0xd8b228c791b70f75338df4d4d644c638f1a58faec0b2f187daf42fb3722af438, 0);
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

    function isTokenHolder(address owner)
        internal
        constant
        returns (bool)
    {
        return _equityToken.balanceOf(owner) > 0;
    }

    function getNominee()
        internal
        constant
        returns (address)
    {
        return _equityToken.nominee();
    }

    function getActionLegalRep(ActionLegalRep rep)
        internal
        constant
        returns (address)
    {
        if (rep == ActionLegalRep.CompanyLegalRep) {
            return COMPANY_LEGAL_REPRESENTATIVE;
        } else if (rep == ActionLegalRep.Nominee) {
            return getNominee();
        }
        revert();
    }

    // figure out what right initator has for given escalation level in bylaw of particular action
    function getBylawEscalation(ActionEscalation escalationLevel, ActionLegalRep rep, address initiator)
        internal
        constant
        returns (ExecutionState s)
    {
        if (escalationLevel == ActionEscalation.Anyone) {
            s = ExecutionState.Executing;
        } else if (escalationLevel == ActionEscalation.TokenHolder) {
            // must be a relevant token holder
            s = isTokenHolder(initiator) ? ExecutionState.Executing : ExecutionState.Rejected;
        } else if (escalationLevel == ActionEscalation.CompanyLegalRep) {
            s = initiator == COMPANY_LEGAL_REPRESENTATIVE ? ExecutionState.Executing : ExecutionState.Rejected;
        } else if (escalationLevel == ActionEscalation.Nominee) {
            s = initiator == getNominee() ? ExecutionState.Executing : ExecutionState.Rejected;
        } else if (escalationLevel == ActionEscalation.CompanyOrNominee) {
            s = initiator == COMPANY_LEGAL_REPRESENTATIVE ? ExecutionState.Executing : ExecutionState.Rejected;
            if (s == ExecutionState.Rejected) {
                s = initiator == getNominee() ? ExecutionState.Executing : ExecutionState.Rejected;
            }
        } else {
            // for THR or SHR only legal rep can put into escalation mode
            // for generic resolutions (None) - there's special escalator where token holders can execute
            s = initiator == getActionLegalRep(rep) ? ExecutionState.Escalating : ExecutionState.Rejected;
        }
    }


    // defines permission escalation for resolution. based on resolution state, action and current shareholder rights
    // allows, escalates or denies execution.
    function defaultPermissionEscalator(Action action)
        internal
        constant
        returns (ExecutionState s)
    {
        // may be called only in New state
        if (_state == GovState.Setup) {
            // anyone can register a legitimate offering in setup state
            s = action == Action.RegisterOffer ? ExecutionState.Executing : ExecutionState.Rejected;
        } else {
            // check if voting in voting center even if New state to handle voting in Campaign state
            // if voting is finalized evaluate results against ActionGovernance for action
            // return Rejected if failed, executed if passed, Escalation if ongoing
            ActionBylaw memory bylaw = deserializeBylaw(_tokenholderRights.getBylaw(action));
            s = getBylawEscalation(bylaw.escalationLevel, bylaw.votingLegalRepresentative, msg.sender);
            if (s == ExecutionState.Escalating) {
                // 1. start voting is campaign mode if msg.sender is equity token holder
                //   (permission escalation into campaign state of voting so voting is not yet official)
                // 2. start voting offically if msg.sender is company or token holder with N% stake
                // 3. for some action legal rep can start without escalation
                return;
            }
        }
    }

    /*function isResolutionTerminated(ExecutionState s)
        internal
        pure
        returns (bool)
    {
        return !(s == ExecutionState.New || s == ExecutionState.Escalating || s == ExecutionState.Executing);
    }*/

    function terminateResolution(bytes32 resolutionId, ResolutionExecution storage e, ExecutionState s)
        internal
    {
        e.state = s;
        e.finishedAt = uint32(now);
        emit LogResolutionExecuted(resolutionId, e.action, s);
        // cleanup action
        // delete _exclusiveActions[uint256(e.action)];
    }

    function terminateResolutionWithCode(bytes32 resolutionId, ResolutionExecution storage e, string memory code)
        internal
    {
        bytes32 failedCode = keccak256(abi.encodePacked(code));
        terminateResolution(resolutionId, e, ExecutionState.Failed);
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

    // guard method for atomic and non atomic executions that will revert or fail resolution that cannot execute further
    function validateResolution(
        bytes32 resolutionId,
        ResolutionExecution storage e,
        function (ResolutionExecution storage) constant returns (string memory) validator
    )
        private
        returns (bool)
    {
        // if resolution is already terminated always revert
        ExecutionState s = e.state;
        require(s == ExecutionState.New || s == ExecutionState.Escalating, "NF_GOV_RESOLUTION_TERMINATED");
        // curried functions are not available in Solidity so we cannot pass any custom parameters
        // however msg.data is available and contains all call parameters
        string memory code = validator(e);
        // no problems reported
        if (bytes(code).length == 0) {
            return true;
        }
        // revert if new
        require(s != ExecutionState.New, code);
        // if resolution is executing then set resolution to fail and continue for cleanup
        terminateResolutionWithCode(resolutionId, e, code);
        return false;
    }

    function validateResolutionContinuation(ResolutionExecution storage e, bytes32 promise, uint8 nextStep)
        private
        constant
        returns (bool)
    {
        require(e.state == ExecutionState.Executing, NF_GOV_NOT_EXECUTING);
        require(nextStep == 0 || e.nextStep == nextStep - 1, NF_GOV_INVALID_NEXT_STEP);
        // we must call executing function with same params
        require(e.promise == promise, NF_GOV_UNKEPT_PROMISE);
        // TODO: validate timeout
        return true;
    }

    function withGovernancePrivate(
        bytes32 resolutionId,
        Action action,
        string documentUrl,
        function (Action) constant returns (ExecutionState) escalator
    )
        private
        returns (ExecutionState s)
    {
        // executor checks resolutionId state
        ResolutionExecution storage e = _resolutions[resolutionId];
        require(e.state == ExecutionState.New || e.state == ExecutionState.Escalating);

        // save new state which may be Executing or Escalating
        if (e.state == ExecutionState.New) {
            // try to escalate to execution state
            s = escalator(action);
            // if New is returned, voting will be in campaign state and must be escalated further
            // for resolution to be created
            // TODO: implement special escalator to test this
            if (s == ExecutionState.New) {
                return s;
            }
            // escalator may deny access to action
            require(s != ExecutionState.Rejected, "NF_GOV_EXEC_ACCESS_DENIED");
            // save new execution
            e.action = action;
            e.state = s;
            e.startedAt = uint32(now);
            // use calldata as promise
            e.promise = keccak256(msg.data);
            // we should use tx.hash as resolutionId, it's however not available in EVM
            // that could give us access to msg.data at all times making subsequenct calls to
            // push execution forward easier
            _resolutionIds.push(resolutionId);
            emit LogResolutionStarted(resolutionId, "", documentUrl, action, s);
        } else if (e.state == ExecutionState.Escalating) {} // TODO: check voting center and check voting result

        return s;
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
