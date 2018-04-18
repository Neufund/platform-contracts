pragma solidity 0.4.15;

import "./ShareholderRights.sol";


contract ICompanyManagement {
    // TODO: create full interface

    /// increases number of equity tokens
    /// @dev company contracts is the sole controller of token
    ///     msg.sender must be ETO, token contract is taken from ETO
    function issueTokens(address to, uint256 amount) public;

    /// decreases number of equity tokens
    /// @dev only token controller (company) can destroy tokens. owner has no right to decrease supply
    ///     msg.sender must be ETO, token contract is taken from ETO
    function destroyTokens(address from, uint256 amount) public;

    /// add new equity token to company captable, add new successful ETO, sets new number of shares and SHA
    /// @dev msg.sender must be ETO which is the source of token, terms, SHA etc.
    function registerEquityToken(
        uint256 issuedEquityTokensUlps,
        bool enableTransfers
    )
        public;
}
