pragma solidity 0.4.23;

import "./ShareholderRights.sol";


contract IControllerGovernance {

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
        ChangeTokenController, // (new token controller)
        AmendISHA, // for example off-chain investment (agreement url, new number of shares, new shareholder rights, new valuation eur)
        ChangeNominee
    }

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
}
