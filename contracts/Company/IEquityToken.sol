pragma solidity 0.4.24;

import "../Standards/IAgreement.sol";
import "../Standards/IERC677Token.sol";
import "../Standards/IERC223Token.sol";
import "../Standards/IClonedTokenParent.sol";
import "./IEquityTokenController.sol";


contract IEquityToken is
    IAgreement,
    IClonedTokenParent,
    IERC223Token
{
    /// @dev equity token is not divisible (Decimals == 0) but single share is represented by
    ///  tokensPerShare tokens
    function tokensPerShare() public constant returns (uint256);

    /// nominal value of a share in EUR decimal(18) precision
    function shareNominalValueEurUlps() public constant returns (uint256);

    // returns company legal representative account that never changes
    function companyLegalRepresentative() public constant returns (address);

    /// @notice returns associated token controller
    function equityTokenController() public constant returns (IEquityTokenController);

    /// @dev only by previous token controller
    function changeEquityTokenController(address newController) public;

    /// returns current nominee which is contract legal rep
    function nominee() public constant returns (address);

    /// only by previous nominee
    function changeNominee(address newNominee) public;

    /// controlled, always issues to self
    function issueTokens(uint256 amount) public;

    /// controlled, may send tokens even when transfer are disabled: to active ETO only
    function distributeTokens(address to, uint256 amount) public;

    // controlled, msg.sender is typically failed ETO
    function destroyTokens(uint256 amount) public;

    /// controlled, irreversibly blocks transferable rights
    function closeToken() public;

    function isTokenClosed() public constant returns (bool);
}
