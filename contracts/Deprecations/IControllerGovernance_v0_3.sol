pragma solidity 0.4.26;

import "../Standards/IAgreement.sol";
import "../Standards/IContractId.sol";


/// @title deprecated version implemented by PlaceholderEquityTokenControler:v0 (FF ETO)
/// @dev preserving only properties required for migration
contract IControllerGovernance_v0_3 is
    IAgreement,
    IContractId
{

    function state()
        public
        constant
        returns (uint256);

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
            // v0 returns shares, not share capital
            uint256 shareCapital,
            uint256 companyValuationEurUlps,
            address shareholderRights
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
}
