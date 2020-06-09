pragma solidity 0.4.26;

import "./Gov.sol";
import "../VotingCenter/IVotingCenter.sol";


/// @title interface of governance module providing resolution execution engine and binding to voting center
contract IControllerGovernanceEngine is IVotingObserver {

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
        IControlledToken token,
        string resolutionTitle,
        string documentUrl,
        uint8 action,
        Gov.ExecutionState state,
        bytes promise
    );

    // logged on action that is a result of shareholder resolution (on-chain, off-chain), or should be shareholder resolution
    event LogResolutionExecuted(
        bytes32 indexed resolutionId,
        uint8 action,
        Gov.ExecutionState state
    );

    // logged when company bylaws are amended
    event LogTokenholderRightsAmended(
        bytes32 indexed resolutionId,
        Gov.TokenType tokenType,
        IControlledToken token,
        ITokenholderRights tokenholderRights
    );

    ////////////////////////
    // Interface methods
    ////////////////////////

    // returns current state of the controller
    function state()
        public
        constant
        returns (Gov.State);

    // address of company legal representative able to sign agreements
    function companyLegalRepresentative()
        public
        constant
        returns (address);

    // returns list of resolutions
    function resolutionsList()
        public
        constant
        returns (bytes32[]);

    // returns single resolution state
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
        );
}
