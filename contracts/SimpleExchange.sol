pragma solidity 0.4.23;

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
    // Data types
    ////////////////////////

    struct TokenRate {
        // rate of numerator token to denominator token
        uint128 rateFraction;
        // timestamp of where rate was updated
        uint128 timestamp;
    }

    ////////////////////////
    // Events
    ////////////////////////

    /// @notice logged on eur-t to gas (ether) exchange
    /// gasRecipient obtained amountWei gas, there is additional fee of exchangeFeeEurUlps
    event LogGasExchange(
        address indexed gasRecipient,
        uint256 amountEurUlps,
        uint256 exchangeFeeFrac,
        uint256 amountWei,
        uint256 rate
    );

    event LogSetExchangeRate(
        address indexed numeratorToken,
        address indexed denominatorToken,
        uint256 rate
    );

    event LogReceivedEther(
        address sender,
        uint256 amount,
        uint256 balance
    );

    ////////////////////////
    // Immutable state
    ////////////////////////

    // ether token to store and transfer ether
    IERC223Token private ETHER_TOKEN;
    // euro token to store and transfer euro
    IERC223Token private EURO_TOKEN;
    // where to send euro token
    // address private PLATFORM_WALLET;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // rate from numerator to denominator
    mapping (address => mapping (address => TokenRate)) private _rates;

    // Euro to Ether rate decimal fraction
    // uint112 private _eurEthRateFraction;
    // Ether to Euro rate decimal fraction
    // uint112 private _ethEurRateFraction;
    // block timestamp of last update
    // uint32 private _rateLastUpdatedTimestamp;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        IAccessPolicy accessPolicy,
        IERC223Token euroToken,
        IERC223Token etherToken
    )
        AccessControlled(accessPolicy)
        Reclaimable()
        public
    {
        EURO_TOKEN = euroToken;
        ETHER_TOKEN = etherToken;
    }

    ////////////////////////
    // Public methods
    ////////////////////////

    /// @notice will exchange amountEurUlps of gasRecipient balance into ether
    /// @dev EuroTokenController has permanent allowance for gasExchange contract to make such exchange possible when gasRecipient has no Ether
    ///     (chicken and egg problem is solved). The rate from token rate oracle will be used
    ///     exchangeFeeFraction will be deduced before the exchange happens
    function gasExchange(address gasRecipient, uint256 amountEurUlps, uint256 exchangeFeeFraction)
        public
        only(ROLE_GAS_EXCHANGE)
    {
        // fee must be less than 100%
        assert(exchangeFeeFraction < 10**18);
        var (rate, rateTimestamp) = getExchangeRatePrivate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 1 hours
        require(block.timestamp - rateTimestamp < 1 hours);
        gasExchangePrivate(gasRecipient, amountEurUlps, exchangeFeeFraction, rate);
    }

    function gasExchangeMultiple(
        address[] gasRecipients,
        uint256[] amountsEurUlps,
        uint256 exchangeFeeFraction
    )
        public
        only(ROLE_GAS_EXCHANGE)
    {
        // fee must be less than 100%
        assert(exchangeFeeFraction < 10**18);
        require(gasRecipients.length == amountsEurUlps.length);
        var (rate, rateTimestamp) = getExchangeRatePrivate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 1 hours
        require(block.timestamp - rateTimestamp < 1 hours);
        uint256 idx;
        while(idx < gasRecipients.length) {
            gasExchangePrivate(gasRecipients[idx], amountsEurUlps[idx], exchangeFeeFraction, rate);
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
    function setExchangeRate(IERC223Token numeratorToken, IERC223Token denominatorToken, uint256 rateFraction)
        public
        only(ROLE_TOKEN_RATE_ORACLE)
    {
        setExchangeRatePrivate(numeratorToken, denominatorToken, rateFraction);
    }

    function setExchangeRates(IERC223Token[] numeratorTokens, IERC223Token[] denominatorTokens, uint256[] rateFractions)
        public
        only(ROLE_TOKEN_RATE_ORACLE)
    {
        require(numeratorTokens.length == denominatorTokens.length);
        require(numeratorTokens.length == rateFractions.length);
        for(uint256 idx = 0; idx < numeratorTokens.length; idx++) {
            setExchangeRatePrivate(numeratorTokens[idx], denominatorTokens[idx], rateFractions[idx]);
        }
    }

    //
    // Implements ITokenExchangeRateOracle
    //

    function getExchangeRate(address numeratorToken, address denominatorToken)
        public
        constant
        returns (uint256 rateFraction, uint256 timestamp)
    {
        return getExchangeRatePrivate(numeratorToken, denominatorToken);
    }

    function getExchangeRates(address[] numeratorTokens, address[] denominatorTokens)
        public
        constant
        returns (uint256[] rateFractions, uint256[] timestamps)
    {
        require(numeratorTokens.length == denominatorTokens.length);
        uint256 idx;
        rateFractions = new uint256[](numeratorTokens.length);
        timestamps = new uint256[](denominatorTokens.length);
        while(idx < numeratorTokens.length) {
            var(rate, timestamp) = getExchangeRatePrivate(numeratorTokens[idx], denominatorTokens[idx]);
            rateFractions[idx] = rate;
            timestamps[idx] = timestamp;
            idx += 1;
        }
    }

    //
    // Override default function
    //

    function () external payable {
        emit LogReceivedEther(msg.sender, msg.value, address(this).balance);
    }

    ////////////////////////
    // Private methods
    ////////////////////////

    function gasExchangePrivate(
        address gasRecipient,
        uint256 amountEurUlps,
        uint256 exchangeFeeFraction,
        uint256 rate
    )
        private
    {
        // exchange declared amount - the exchange fee, no overflow, fee < 0
        uint256 amountEthWei = decimalFraction(amountEurUlps - decimalFraction(amountEurUlps, exchangeFeeFraction), rate);
        // take all euro tokens
        assert(EURO_TOKEN.transferFrom(gasRecipient, this, amountEurUlps));
        // transfer ether to gasRecipient
        gasRecipient.transfer(amountEthWei);

        emit LogGasExchange(gasRecipient, amountEurUlps, exchangeFeeFraction, amountEthWei, rate);
    }

    function getExchangeRatePrivate(address numeratorToken, address denominatorToken)
        private
        constant
        returns (uint256 rateFraction, uint256 timestamp)
    {
        TokenRate storage rate = _rates[numeratorToken][denominatorToken];
        require(rate.timestamp > 0, "SEX_NO_RATE_INFO");
        return (rate.rateFraction, rate.timestamp);
    }

    function setExchangeRatePrivate(
        IERC223Token numeratorToken,
        IERC223Token denominatorToken,
        uint256 rateFraction
    )
        private
    {
        assert(rateFraction > 0);
        assert(rateFraction < 2**128);
        uint256 invRateFraction = proportion(10**18, 10**18, rateFraction);
        require(invRateFraction < 2**128, "SEX_OVR_INV");
        require(denominatorToken.decimals() == numeratorToken.decimals(), "SEX_DECIMALS");
        // TODO: protect against outliers
        _rates[numeratorToken][denominatorToken] = TokenRate({
            rateFraction: uint128(rateFraction),
            timestamp: uint128(block.timestamp)
        });
        // also store the invesrse
        _rates[denominatorToken][numeratorToken] = TokenRate({
            rateFraction: uint128(invRateFraction),
            timestamp: uint128(block.timestamp)
        });

        emit LogSetExchangeRate(numeratorToken, denominatorToken, rateFraction);
        emit LogSetExchangeRate(denominatorToken, numeratorToken, invRateFraction);
    }
}
