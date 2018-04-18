pragma solidity 0.4.15;

import "./AccessControl/AccessControlled.sol";
import "./Standards/ITokenExchangeRateOracle.sol";
import "./Standards/IERC223Token.sol";
import "./Reclaimable.sol";
import "./Math.sol";


/// @title simple exchange providing EUR to ETH exchange rate and gas exchange
/// see below discussion on oracle type used
contract SimpleExchange is
    ITokenExchangeRateOracle,
    Reclaimable,
    Math
{
    ////////////////////////
    // Events
    ////////////////////////

    /// @notice logged on eur-t to gas (ether) exchange
    /// gasRecipient obtained amountWei gas, there is additional fee of exchangeFeeEurUlps
    event LogGasExchange(
        address indexed gasRecipient,
        uint256 amountEurUlps,
        uint256 exchangeFeeEurUlps,
        uint256 amountWei,
        uint256 rate
    );

    event LogSetExchangeRate(
        address indexed numeratorToken,
        address indexed denominatorToken,
        uint256 rate
    );

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
    // Constructor
    ////////////////////////

    function SimpleExchange(
        IAccessPolicy accessPolicy,
        IERC223Token numeratorToken,
        IERC223Token denominatorToken
    )
        AccessControlled(accessPolicy)
        Reclaimable()
        public
    {
        require(denominatorToken.decimals() == numeratorToken.decimals());
        EURO_TOKEN = numeratorToken;
        ETHER_TOKEN = denominatorToken;
    }

    ////////////////////////
    // Public methods
    ////////////////////////

    /// gas
    function gasExchange(address gasRecipient, uint256 amountEurUlps, uint256 exchangeFeeEurUlps)
        public
        only(ROLE_GAS_EXCHANGE)
    {
        var (rate, rateTimestamp) = getExchangeRate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 4 hours
        require(block.timestamp - rateTimestamp < 6 hours);
        gasExchangePrivate(gasRecipient, amountEurUlps, exchangeFeeEurUlps, rate);
    }

    function gasExchangeMultiple(
        address[] gasRecipients,
        uint256[] amountsEurUlps,
        uint256[] exchangeFeesEurUlps
    )
        public
        only(ROLE_GAS_EXCHANGE)
    {
        require(gasRecipients.length == amountsEurUlps.length);
        require(gasRecipients.length == exchangeFeesEurUlps.length);
        var (rate, rateTimestamp) = getExchangeRate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 4 hours
        require(block.timestamp - rateTimestamp < 6 hours);
        uint256 idx;
        while(idx < gasRecipients.length) {
            gasExchangePrivate(gasRecipients[idx], amountsEurUlps[idx], exchangeFeesEurUlps[idx], rate);
            idx += 1;
        }
    }

    /// sets current euro to ether exchange rate, also sets inverse
    /// ROLE_TOKEN_RATE_ORACLE is allowed to provide rates. we do not implement decentralized oracle here
    /// there is no so actual working decentralized oracle ecosystem
    /// the closes is MakerDao Medianizer at https://etherscan.io/address/0x729D19f657BD0614b4985Cf1D82531c67569197B#code but it's still centralized and only USD/ETH
    /// Oraclize is centralized and you still need to pay fees.
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
        LogSetExchangeRate(numeratorToken, denominatorToken, rateFraction);
        LogSetExchangeRate(denominatorToken, numeratorToken, _ethEurRateFraction);
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

    ////////////////////////
    // Private methods
    ////////////////////////

    function gasExchangePrivate(
        address gasRecipient,
        uint256 amountEurUlps,
        uint256 exchangeFeeEurUlps,
        uint256 rate
    )
        private
    {
        // exchange declared amount
        uint256 amountEthWei = decimalFraction(amountEurUlps, rate);
        // transfer out amount + fee
        assert(EURO_TOKEN.transferFrom(gasRecipient, PLATFORM_WALLET, amountEurUlps + exchangeFeeEurUlps));
        // transfer ether to gasRecipient
        gasRecipient.transfer(amountEthWei);
        LogGasExchange(gasRecipient, amountEurUlps, exchangeFeeEurUlps, amountEthWei, rate);
    }
}
