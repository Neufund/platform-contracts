pragma solidity 0.4.26;

import "./AccessControl/AccessControlled.sol";
import "./Standards/ITokenExchangeRateOracle.sol";
import "./Standards/IGasExchange.sol";
import "./Reclaimable.sol";
import "./Math.sol";
import "./Standards/IContractId.sol";


/// @title simple exchange providing EUR to ETH exchange rate and gas exchange
/// see below discussion on oracle type used
contract SimpleExchange is
    ITokenExchangeRateOracle,
    IGasExchange,
    IContractId,
    Reclaimable
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
    // Immutable state
    ////////////////////////

    // ether token to store and transfer ether
    IERC223Token private ETHER_TOKEN;
    // euro token to store and transfer euro
    IERC223Token private EURO_TOKEN;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // rate from numerator to denominator
    mapping (address => mapping (address => TokenRate)) private _rates;

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

    //
    // Implements IGasExchange
    //

    function gasExchange(address gasRecipient, uint256 amountEurUlps, uint256 exchangeFeeFraction)
        public
        only(ROLE_GAS_EXCHANGE)
    {
        // fee must be less than 100%
        assert(exchangeFeeFraction < 10**18);
        (uint256 rate, uint256 rateTimestamp) = getExchangeRatePrivate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 1 hours
        require(block.timestamp - rateTimestamp < 1 hours, "NF_SEX_OLD_RATE");
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
        (uint256 rate, uint256 rateTimestamp) = getExchangeRatePrivate(EURO_TOKEN, ETHER_TOKEN);
        // require if rate older than 1 hours
        require(block.timestamp - rateTimestamp < 1 hours, "NF_SEX_OLD_RATE");
        uint256 idx;
        while(idx < gasRecipients.length) {
            gasExchangePrivate(gasRecipients[idx], amountsEurUlps[idx], exchangeFeeFraction, rate);
            idx += 1;
        }
    }

    /// @notice please read method description in the interface
    /// @dev we always set a rate and an inverse rate! so you call once with eur/eth and you also get eth/eur
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
            (uint256 rate, uint256 timestamp) = getExchangeRatePrivate(numeratorTokens[idx], denominatorTokens[idx]);
            rateFractions[idx] = rate;
            timestamps[idx] = timestamp;
            idx += 1;
        }
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x434a1a753d1d39381c462f37c155e520ae6f86ad79289abca9cde354a0cebd68, 0);
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
        uint256 amountEthWei = Math.decimalFraction(amountEurUlps - Math.decimalFraction(amountEurUlps, exchangeFeeFraction), rate);
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
        TokenRate storage requested_rate = _rates[numeratorToken][denominatorToken];
        TokenRate storage inversed_requested_rate = _rates[denominatorToken][numeratorToken];
        if (requested_rate.timestamp > 0) {
            return (requested_rate.rateFraction, requested_rate.timestamp);
        }
        else if (inversed_requested_rate.timestamp > 0) {
            uint256 invRateFraction = Math.proportion(10**18, 10**18, inversed_requested_rate.rateFraction);
            return (invRateFraction, inversed_requested_rate.timestamp);
        }
        // will return (0, 0) == (rateFraction, timestamp)
    }

    function setExchangeRatePrivate(
        IERC223Token numeratorToken,
        IERC223Token denominatorToken,
        uint256 rateFraction
    )
        private
    {
        require(numeratorToken != denominatorToken, "NF_SEX_SAME_N_D");
        assert(rateFraction > 0);
        assert(rateFraction < 2**128);
        uint256 invRateFraction = Math.proportion(10**18, 10**18, rateFraction);

        // Inversion of rate biger than 10**36 is not possible and it will always be 0.
        // require(invRateFraction < 2**128, "NF_SEX_OVR_INV");
        require(denominatorToken.decimals() == numeratorToken.decimals(), "NF_SEX_DECIMALS");
        // TODO: protect against outliers

        if (_rates[denominatorToken][numeratorToken].timestamp > 0) {
            _rates[denominatorToken][numeratorToken] = TokenRate({
                rateFraction: uint128(invRateFraction),
                timestamp: uint128(block.timestamp)
            });
        }
        else {
            _rates[numeratorToken][denominatorToken] = TokenRate({
                rateFraction: uint128(rateFraction),
                timestamp: uint128(block.timestamp)
            });
        }

        emit LogSetExchangeRate(numeratorToken, denominatorToken, rateFraction);
        emit LogSetExchangeRate(denominatorToken, numeratorToken, invRateFraction);
    }
}
