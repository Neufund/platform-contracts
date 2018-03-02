pragma solidity 0.4.15;

import "./AccessControl/AccessControlled.sol";
import "./Standards/ITokenExchangeRateOracle.sol";
import "./Standards/IERC223Token.sol";
import "./AccessRoles.sol";
import "./Math.sol";


/// @title simple exchange providing EUR to ETH exchange rate and gas exchange
/// see below discussion on oracle type used
contract SimpleExchange is
    ITokenExchangeRateOracle,
    AccessControlled,
    AccessRoles,
    Math
{
    ////////////////////////
    // Immutable state
    ////////////////////////

    // ether token to store and transfer ether
    IERC223Token private ETHER_TOKEN;
    // euro token to store and transfer euro
    IERC223Token private EURO_TOKEN;
    // where to send euro token
    address private PLATFORM_WALLET;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // Euro to Ether rate decimal fraction
    uint112 private _eurEthRateFraction;
    // Ether to Euro rate decimal fraction
    uint112 private _ethEurRateFraction;
    // block timestamp of last update
    uint32 private _rateLastUpdatedTimestamp;

    ////////////////////////
    // Public methods
    ////////////////////////

    /// gas
    function gasExchange(address gasRecipient, uint256 amountEurUlps, uint256 exchangeFeeEurUlps)
        public
        only(ROLE_GAS_EXCHANGE)
    {
        // TODO: limit amount
        var (rate, rate_timestamp) = getExchangeRate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 4 hours
        require(block.timestamp - rate_timestamp < 6 hours);
        // exchange declared amount
        uint256 amountEthWei = decimalFraction(amountEurUlps, rate);
        // transfer out amount + fee
        assert(EURO_TOKEN.transferFrom(gasRecipient, PLATFORM_WALLET, amountEurUlps + exchangeFeeEurUlps));
        // transfer ether to gasRecipient
        gasRecipient.transfer(amountEthWei);
    }

    /// sets current euro to ether exchange rate, also sets inverse
    /// ROLE_TOKEN_RATE_ORACLE is allowed to provide rates. we do not implement decentralized oracle here
    /// there is no so actual working decentralized oracle ecosystem
    /// the closes is MakerDao Medianizer at https://etherscan.io/address/0x729D19f657BD0614b4985Cf1D82531c67569197B#code but it's still centralized and only USD/ETH
    /// Oraclize is centralized and you still need to trust fees.
    /// Gnosis does not seem to be working
    /// it seems that for Neufund investor it's best to trust Platform Operator to provide correct information, Platform is aligned via NEU and has no incentive to lie
    /// SimpleExchange is replaceable via Universe. when proper oracle is available we'll move to it
    function setExchangeRate(address numeratorToken, address denominatorToken, uint112 rateFraction)
        public
        only(ROLE_TOKEN_RATE_ORACLE)
    {
        require(numeratorToken == address(EURO_TOKEN) && denominatorToken == address(ETHER_TOKEN));
        // TODO: protect against outliers
        _eurEthRateFraction = rateFraction;
        _ethEurRateFraction = 10**18 / rateFraction;
        _rateLastUpdatedTimestamp = uint32(block.timestamp);
    }

    //
    // Implements ITokenExchangeRateOracle
    //

    function getExchangeRate(address numeratorToken, address denominatorToken)
        public
        constant
        returns (uint256 rateFraction, uint256 timestamp)
    {
        require(_rateLastUpdatedTimestamp > 0);
        if (numeratorToken == address(EURO_TOKEN) && denominatorToken == address(ETHER_TOKEN)) {
            return (_eurEthRateFraction, _rateLastUpdatedTimestamp);
        }
        if (numeratorToken == address(ETHER_TOKEN) && denominatorToken == address(EURO_TOKEN)) {
            return (_ethEurRateFraction, _rateLastUpdatedTimestamp);
        }
        // pair not supported
        revert();
    }
}
