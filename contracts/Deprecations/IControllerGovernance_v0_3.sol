pragma solidity 0.4.26;

import "../Standards/IAgreement.sol";
import "../Standards/IContractId.sol";


/// @title deprecated version implemented by PlaceholderEquityTokenControler:v0 (FF ETO and Greyp)
/// @dev preserving only properties required for migration
// version history as per contract id (0xf7e00d1a4168be33cbf27d32a37a5bc694b3a839684a8c2bef236e3594345d70)
// 0 - initial version
// 1 - standardizes migration function to require two side commitment
// 2 - migration management shifted from company to UPGRADE ADMIN
// 3 - company shares replaced by share capital
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
