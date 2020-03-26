pragma solidity 0.4.26;

import "./ShareholderRights.sol";
import "../Standards/IAgreement.sol";


contract IControllerGovernance is
    GovernanceTypes,
    IAgreement
{

    ////////////////////////
    // Types
    ////////////////////////

    enum ExecutionState {
        New,
        // permissions are being escalated ie. voting in progress
        Escalating,
        // permission escalation failed
        Rejected,
        // resolution in progress
        Executing,
        // resolution was cancelled ie. due to timeout
        Cancelled,
        // resolution execution failed ie. ETO refunded
        Failed,
        // resolution execution OK
        Completed
    }

    struct ResolutionExecution {
        // payload promise
        bytes32 promise; // 256 bits
        // next WORD
        // failed code which is keccak of revert code from validator
        bytes32 failedCode;
        // next WORD
        // initial action being executed
        Action action; // 8-bit
        // state of the execution
        ExecutionState state; // 8-bit
        // resolution started
        uint32 startedAt; // 32-bit
        // resolution finished
        uint32 finishedAt; // 32-bit
        // reserved

        // resolution deadline
        // child executions
    }


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

    // logged when transferability of given token was changed
    event LogTransfersStateChanged(
        bytes32 indexed resolutionId,
        address equityToken,
        bool transfersEnabled
    );

    // logged when ISHA was amended (new text, new shareholders, new cap table, offline round etc.)
    event LogISHAAmended(
        bytes32 indexed resolutionId,
        string ISHAUrl,
        uint256 shareCapitalUlps,
        uint256 companyValuationEurUlps,
        address newShareholderRights
    );

    // logged when authorized share capital is established
    event LogAuthorizedCapitalEstablished(
        bytes32 indexed resolutionId,
        uint256 authorizedCapitalUlps
    );

    // offering of the token in ETO failed (Refund)
    event LogOfferingFailed(
        address etoCommitment,
        address equityToken
    );

    // offering of the token in ETO succeeded (with all on-chain consequences)
    event LogOfferingSucceeded(
        address etoCommitment,
        address equityToken,
        uint256 newShares
    );

    //
    event LogOfferingRegistered(
        bytes32 indexed resolutionId,
        address etoCommitment,
        address equityToken
    );

    ////////////////////////
    // Interface methods
    ////////////////////////

    // returns current state of the controller
    function state()
        public
        constant
        returns (GovState);

    // address of company legal representative able to sign agreements
    function companyLegalRepresentative()
        public
        constant
        returns (address);

    // return basic shareholder information
    function shareholderInformation()
        public
        constant
        returns (
            uint256 shareCapital,
            uint256 companyValuationEurUlps,
            ShareholderRights shareholderRights,
            uint256 authorizedCapital
        );

    // returns list of tokens and shares (as fraction) that given token represents
    function tokens()
        public
        constant
        returns (
            address[] token,
            // we return shares as fractions so partial shares can be represented
            uint256[] sharesFraction
        );

    // returns all started offerings
    function tokenOfferings()
        public
        constant
        returns (
            address[] offerings,
            address[] equityTokens
        );

    // officially inform shareholders, can be quarterly report, yearly closing
    // @dev this can be called only by company wallet
    function issueGeneralInformation(
        bytes32 resolutionId,
        string title,
        string informationUrl
    )
        public;

    // this will close company (transition to terminal state) and close all associated tokens
    // requires decision to be made before according to implemented governance
    // also requires that certain obligations are met like proceeds were distributed
    // so anyone should be able to call this function
    function closeCompany() public;

    // this will cancel closing of the company due to obligations not met in time
    // being able to cancel closing should not depend on who is calling the function.
    function cancelCompanyClosing() public;

    // list of governance modules in controller, same scheme as IContractId
    /// @dev includes contractId as last one
    function moduleId() public pure returns (bytes32[] ids, uint256[] versions);
}
