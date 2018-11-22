pragma solidity 0.4.25;

import "../Standards/IAgreement.sol";
import "./ShareholderRights.sol";


contract IControllerGovernance is
    IAgreement
{

    ////////////////////////
    // Types
    ////////////////////////

    // defines state machine of the token controller which goes from I to T without loops
    enum GovState {
        Setup, // Initial state
        Offering, // primary token offering in progress
        Funded, // token offering succeeded, execution of shareholder rights possible
        Closing, // company is being closed
        Closed, // terminal state, company closed
        Migrated // terminal state, contract migrated
    }

    enum Action {
        None, // no on-chain action on resolution
        StopToken, // blocks transfers
        ContinueToken, // enables transfers
        CloseToken, // any liquidation: dissolution, tag, drag, exit (settlement time, amount eur, amount eth)
        Payout, // any dividend payout (amount eur, amount eth)
        RegisterOffer, // start new token offering
        ChangeTokenController, // (new token controller)
        AmendISHA, // for example off-chain investment (agreement url, new number of shares, new shareholder rights, new valuation eur)
        IssueTokensForExistingShares, // (number of converted shares, allocation (address => balance))
        ChangeNominee,
        Downround // results in issuance of new equity token and disbursing it to current token holders
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

    // logged on action that is a result of shareholder resolution (on-chain, off-chain), or should be shareholder resolution
    event LogResolutionExecuted(
        bytes32 resolutionId,
        Action action
    );

    // logged when transferability of given token was changed
    event LogTransfersStateChanged(
        bytes32 resolutionId,
        address equityToken,
        bool transfersEnabled
    );

    // logged when ISHA was amended (new text, new shareholders, new cap table, offline round etc.)
    event LogISHAAmended(
        bytes32 resolutionId,
        string ISHAUrl,
        uint256 totalShares,
        uint256 companyValuationEurUlps,
        address newShareholderRights
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

    // logs when company issues official information to shareholders
    event LogGeneralInformation(
        address companyLegalRep,
        string informationType,
        string informationUrl
    );

    //
    event LogOfferingRegistered(
        bytes32 resolutionId,
        address etoCommitment,
        address equityToken
    );

    event LogMigratedTokenController(
        bytes32 resolutionId,
        address newController
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
            uint256 totalCompanyShares,
            uint256 companyValuationEurUlps,
            ShareholderRights shareholderRights
        );

    // returns cap table
    function capTable()
        public
        constant
        returns (
            address[] equityTokens,
            uint256[] shares
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
        string informationType,
        string informationUrl
    )
        public;

    // start new resolution vs shareholders. required due to General Information Rights even in case of no voting right
    // @dev payload in RLP encoded and will be parsed in the implementation
    // @dev this can be called only by company wallet
    function startResolution(string title, string resolutionUri, Action action, bytes payload)
        public
        returns (bytes32 resolutionId);

    // execute on-chain action of the given resolution if it has passed accordint to implemented governance
    function executeResolution(bytes32 resolutionId) public;

    // this will close company (transition to terminal state) and close all associated tokens
    // requires decision to be made before according to implemented governance
    // also requires that certain obligations are met like proceeds were distributed
    // so anyone should be able to call this function
    function closeCompany() public;

    // this will cancel closing of the company due to obligations not met in time
    // being able to cancel closing should not depend on who is calling the function.
    function cancelCompanyClosing() public;

    /// @notice replace current token controller
    /// @dev please note that this process is also controlled by existing controller so for example resolution may be required
    function changeTokenController(address newController) public;

    // in Migrated state - an address of actual token controller
    /// @dev should return zero address on other states
    function newTokenController() public constant returns (address);

    // an address of previous controller (in Migrated state)
    /// @dev should return zero address if is the first controller
    function oldTokenController() public constant returns (address);
}
