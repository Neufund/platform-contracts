pragma solidity 0.4.23;

import "./ShareholderRights.sol";
import "../Standards/ITokenController.sol";


contract IEquityTokenController is ITokenController {
    // TODO: create full interface

    enum ResolutionOnChainResult {
        RegisterETO, // launching new ETO
        StopToken,
        ContinueToken,
        CloseToken, // any liquidation: dissolution, tag, drag, exit
        Payout, // any dividend payout
        ChangeTokenController,
        ChangeTerms // for example off-chain fundraising
    }

    struct Terms {
        uint256 TOTAL_COMPANY_SHARES;
        uint256 COMAPNY_VALUATION_EUR_ULPS;
        string ISHA;

    }

    /// increases number of equity tokens
    /// @dev company contracts is the sole controller of token
    ///     msg.sender must be ETO, token contract is taken from ETO
    ///     should use distribute, not transfer to make `to` sign agreement
    // function issueTokens(address to, uint256 amount) public;

    /// decreases number of equity tokens
    /// @dev only token controller (company) can destroy tokens. owner has no right to decrease supply
    ///     msg.sender must be ETO, token contract is taken from ETO
    // function destroyTokens(address from, uint256 amount) public;

    /// controls if sender is allowed to close token
    /// @dev msg.sender must be a token known to controller
    function onCloseToken(address sender) public constant returns (bool);

    /// controls if sender can change controller to newController
    /// @dev for this to succeed current controller must be already migrated to a new one
    function onChangeTokenController(address sender, address newController) public constant returns (bool);

    // various actions

    /// add new equity token to company captable, add new successful ETO, sets new number of shares and SHA
    /// @dev msg.sender must be ETO which is the source of token, terms, SHA etc.
    function approveTokenOffering() public;

    // fails ongoing token offering
    /// @dev msg.sender must be ETO
    function failTokenOffering() public;

}
