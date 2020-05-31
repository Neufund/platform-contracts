pragma solidity 0.4.26;

import "./Gov.sol";
import "../Standards/IAgreement.sol";


contract IControllerGovernance is
    IAgreement
{
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

    // return basic shareholder information
    function shareholderInformation()
        public
        constant
        returns (
            uint256 shareCapital,
            uint256 companyValuationEurUlps,
            uint256 authorizedCapital,
            string shaUrl,
            ITokenholderRights tokenholderRights
        );

    // returns list of tokens and associated holder rights
    function governanceToken()
        public
        constant
        returns (
            IControlledToken token,
            Gov.TokenType tokenType,
            Gov.TokenState tokenState,
            ITokenholderRights holderRights,
            bool tokenTransferable
        );

    // returns all started offerings
    function tokenOfferings()
        public
        constant
        returns (
            address[] offerings
        );

    // officially inform shareholders, can be quarterly report, yearly closing
    // @dev this can be called only by company wallet
    /*function issueGeneralInformation(
        bytes32 resolutionId,
        string title,
        string informationUrl
    )
        public;*/

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
    // function moduleId() public pure returns (bytes32[6] ids, uint256[6] versions);
}
